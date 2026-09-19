// Mission 03 — Reprendre une fois les photos et textes de Shopify dans le DMS (décision W-4).
//
// LECTURE SEULE côté Shopify : aucune écriture vers la boutique.
// Pour chaque produit Shopify RELIÉ à un article (shopify_links auto_exact / valide) :
//   1. lit titre, description HTML et toutes les images du produit (Admin GraphQL 2026-07, par lots,
//      pause si Shopify limite) ;
//   2. règle « ne jamais écraser » (_shared/shopify-content.ts, redite en SQL) : textes écrits
//      seulement s'ils sont vides dans la fiche, sinon notés à côté ; images ajoutées seulement si
//      leur id Shopify n'est pas déjà repris ;
//   3. télécharge chaque image manquante depuis le CDN Shopify et la dépose dans le Storage du DMS
//      (bucket privé « ged », {société}/article/{article}/shopify_{id}.{ext}, même chemin à chaque
//      relance) ;
//   4. enregistre photos + textes + trace via _shopify_apply_content (clé de service).
//
// Corps : { company_id, product_id?, run_started_at? }
//   sans product_id : tous les produits reliés pas encore repris (rend la main avant la limite de
//   temps : done=false + run_started_at → rappeler avec la même valeur ; l'écran le fait seul) ;
//   avec product_id : ce produit seulement, même déjà repris (n'ajoute que ce qui manque).
// Appelable par la clé de service, pg_cron (x-cron-secret) ou un administrateur actif de la société.
// deno-lint-ignore-file
import { identify, activeCompaniesOf, isUuid } from '../_shared/acces.ts';
import { planContentImport, imageFileName, type ShopifyImage } from '../_shared/shopify-content.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SHOP = Deno.env.get('SHOPIFY_STORE_DOMAIN');
const CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET');
const SB_URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const API_VERSION = '2026-07';
const BUCKET = 'ged';
const BATCH = 8;                   // produits par requête GraphQL (coût ~ 8 × 42 points)
const MEDIA_MAX = 40;              // images lues par produit
const PARALLEL_DOWNLOADS = 4;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const TIME_BUDGET_MS = 70_000;     // on rend la main bien avant la limite des fonctions serveur (150 s)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const QUERY = `query Products($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id title descriptionHtml
      featuredMedia { id }
      media(first: ${MEDIA_MAX}) {
        nodes {
          id alt mediaContentType
          ... on MediaImage { image { url(transform: { maxWidth: 2048, maxHeight: 2048 }) altText } }
        }
      }
    }
  }
}`;

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T;
}

async function isAdminOf(userId: string, companyId: string): Promise<boolean> {
  if (!(await activeCompaniesOf(userId)).includes(companyId)) return false;
  const r = await db(`user_roles?select=role&user_id=eq.${userId}&company_id=eq.${companyId}&role=eq.admin&limit=1`);
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) && rows.length > 0;
}

type Product = { id: string; title: string | null; descriptionHtml: string | null; featuredMedia: { id: string } | null; media: { nodes: any[] } };

/** Un lot de produits, avec pause si le budget de coût est bas et nouvel essai si THROTTLED. */
async function fetchProducts(token: string, ids: string[]): Promise<Map<string, Product>> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: QUERY, variables: { ids } }),
    });
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    const g = await r.json().catch(() => null);
    const cost = g?.extensions?.cost;
    const throttled = Array.isArray(g?.errors) && g.errors.some((e: any) => e?.extensions?.code === 'THROTTLED');
    if (throttled) {
      const st = cost?.throttleStatus;
      const need = (cost?.requestedQueryCost ?? 400) - (st?.currentlyAvailable ?? 0);
      await sleep(Math.max(1000, Math.ceil((need / Math.max(st?.restoreRate ?? 50, 1)) * 1000)));
      continue;
    }
    if (!r.ok || g?.errors) throw new Error(`graphql ${r.status}: ${JSON.stringify(g?.errors ?? '').slice(0, 300)}`);
    const st = cost?.throttleStatus;
    if (st && typeof st.currentlyAvailable === 'number' && st.currentlyAvailable < (cost.requestedQueryCost ?? 400) * 1.5) {
      const need = (cost.requestedQueryCost ?? 400) * 1.5 - st.currentlyAvailable;
      await sleep(Math.ceil((need / Math.max(st.restoreRate ?? 50, 1)) * 1000));
    }
    const out = new Map<string, Product>();
    for (const n of g.data?.nodes ?? []) if (n?.id) out.set(String(n.id), n as Product);
    return out;
  }
  throw new Error('throttled: Shopify limite les appels, réessayer dans une minute');
}

function imagesOf(p: Product): ShopifyImage[] {
  return (p.media?.nodes ?? [])
    .filter((m: any) => m?.mediaContentType === 'IMAGE' && m?.image?.url)
    .map((m: any) => ({ media_id: String(m.id), url: String(m.image.url), alt: (m.alt ?? m.image.altText ?? null) || null }));
}

/** Télécharge une image du CDN Shopify et la dépose dans le Storage du DMS (même chemin à chaque fois). */
async function copyImage(companyId: string, articleId: string, im: { media_id: string; url: string }) {
  let resp: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    resp = await fetch(im.url, { signal: AbortSignal.timeout(20_000) });
    if (resp.ok) break;
    if (resp.status < 500 && resp.status !== 429) break;
    await sleep(1000 * (attempt + 1));
  }
  if (!resp || !resp.ok) throw new Error(`download ${resp?.status ?? 'ko'}`);
  const contentType = (resp.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
  if (!contentType.startsWith('image/')) throw new Error(`not_image ${contentType}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`size ${bytes.byteLength}`);
  const fileName = imageFileName(im.media_id, im.url, contentType);
  const path = `${companyId}/article/${articleId}/${fileName}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 120)}`);
  return { storage_path: path, file_name: fileName, content_type: contentType, size_bytes: bytes.byteLength };
}

async function inPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const res: PromiseSettledResult<R>[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { res[k] = { status: 'fulfilled', value: await fn(items[k]) }; } catch (e) { res[k] = { status: 'rejected', reason: e }; }
    }
  }));
  return res;
}

type Target = {
  shopify_product_id: string; article_id: string; article_reference: string; article_designation: string | null;
  web_title: string | null; web_description: string | null; imported_media_ids: string[]; existing_photo_count: number;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const caller = await identify(req);
  if (!caller) return J({ error: 'not_signed_in' }, 401);

  const body = await req.json().catch(() => ({}));
  const companyId = body?.company_id;
  if (!isUuid(companyId)) return J({ error: 'company_id_required' }, 400);
  if (caller.kind === 'user' && !(await isAdminOf(caller.id, companyId))) return J({ error: 'forbidden' }, 403);
  const actor = caller.kind === 'user' ? caller.id : null;
  const productId: string | null = typeof body?.product_id === 'string' && body.product_id.startsWith('gid://shopify/Product/')
    ? body.product_id : null;

  const missing = [!SHOP && 'SHOPIFY_STORE_DOMAIN', !CLIENT_ID && 'SHOPIFY_CLIENT_ID', !CLIENT_SECRET && 'SHOPIFY_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) return J({ ok: false, error: 'not_configured', missing }, 501);

  const started = Date.now();
  const runStartedAt: string = typeof body?.run_started_at === 'string' && !Number.isNaN(Date.parse(body.run_started_at))
    ? body.run_started_at : new Date().toISOString();

  const totals = {
    products: 0, articles_title_set: 0, articles_description_set: 0, articles_dms_text_kept: 0,
    images_found: 0, images_added: 0, images_already: 0, images_failed: 0, errors: 0,
  };
  const errors: { product: string; reference: string; error: string }[] = [];

  try {
    const tr = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID!, client_secret: CLIENT_SECRET! }).toString(),
    });
    if (!tr.ok) return J({ ok: false, error: 'token_failed', status: tr.status }, 502);
    const token = (await tr.json()).access_token as string;

    for (;;) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        return J({ ok: true, done: false, run_started_at: runStartedAt, ...totals, error_samples: errors.slice(0, 10) });
      }
      const targets = await rpc<Target[]>('_shopify_content_targets', {
        _company: companyId, _product: productId, _before: runStartedAt, _limit: BATCH,
      });
      if (!targets.length) break;

      const ids = [...new Set(targets.map((t) => t.shopify_product_id))];
      let products: Map<string, Product>;
      try {
        products = await fetchProducts(token, ids);
      } catch (e) {
        // Lot illisible : chaque produit est marqué en erreur pour ne pas boucler dans cette relance.
        for (const t of targets) {
          await rpc('_shopify_apply_content', { _company: companyId, _article: t.article_id, _product: t.shopify_product_id,
            _title: null, _description: null, _images: [], _images_found: 0, _actor: actor, _error: String((e as Error).message ?? e) });
          totals.errors++;
        }
        errors.push({ product: ids.join(','), reference: '', error: String((e as Error).message ?? e).slice(0, 200) });
        if (productId) break;
        continue;
      }

      for (const t of targets) {
        // Temps écoulé : les produits restants n'ont pas de ligne de reprise, l'appel suivant les reprend.
        if (Date.now() - started > TIME_BUDGET_MS) break;
        const p = products.get(t.shopify_product_id);
        if (!p) {
          await rpc('_shopify_apply_content', { _company: companyId, _article: t.article_id, _product: t.shopify_product_id,
            _title: null, _description: null, _images: [], _images_found: 0, _actor: actor, _error: 'product_not_found' });
          totals.errors++;
          errors.push({ product: t.shopify_product_id, reference: t.article_reference, error: 'product_not_found' });
          continue;
        }
        const images = imagesOf(p);
        const plan = planContentImport(
          { web_title: t.web_title, web_description: t.web_description, imported_media_ids: t.imported_media_ids ?? [], existing_photo_count: t.existing_photo_count ?? 0 },
          { title: p.title, description_html: p.descriptionHtml, featured_media_id: p.featuredMedia?.id ?? null, images },
          t.article_designation ?? t.article_reference,
        );
        const copied = await inPool(plan.images_to_add, PARALLEL_DOWNLOADS, (im) => copyImage(companyId, t.article_id, im));
        const ok = plan.images_to_add
          .map((im, k) => ({ im, r: copied[k] }))
          .filter((x) => x.r.status === 'fulfilled')
          .map(({ im, r }) => ({ media_id: im.media_id, alt_text: im.alt_text, position: im.position, ...(r as PromiseFulfilledResult<any>).value }));
        const failed = copied.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
        if (failed.length) {
          totals.images_failed += failed.length;
          errors.push({ product: t.shopify_product_id, reference: t.article_reference, error: String(failed[0].reason?.message ?? failed[0].reason).slice(0, 200) });
        }
        const res = await rpc<Record<string, any>>('_shopify_apply_content', {
          _company: companyId, _article: t.article_id, _product: t.shopify_product_id,
          _title: plan.shopify_title, _description: plan.shopify_description || null,
          _images: ok, _images_found: images.length, _actor: actor, _error: null,
        });
        totals.products++;
        totals.images_found += images.length;
        totals.images_already += plan.images_already;
        totals.images_added += Number(res?.images_added ?? 0);
        if (res?.title_applied) totals.articles_title_set++;
        if (res?.description_applied) totals.articles_description_set++;
        if (res?.dms_text_kept) totals.articles_dms_text_kept++;
      }
      if (productId) break;
    }
    return J({ ok: true, done: true, run_started_at: runStartedAt, ...totals, error_samples: errors.slice(0, 10) });
  } catch (e) {
    return J({ ok: false, error: 'import_failed', detail: String((e as Error)?.message ?? e).slice(0, 400), run_started_at: runStartedAt, ...totals }, 502);
  }
});
