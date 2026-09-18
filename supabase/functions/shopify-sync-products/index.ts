// Mission 03 — Lire tous les produits Shopify et les rapprocher des articles du DMS.
//
// LECTURE SEULE côté Shopify : aucune écriture vers la boutique.
// 1. Jeton par « client credentials grant » (comme shopify-ping ; secrets jamais renvoyés).
// 2. Parcourt toutes les variantes (GraphQL Admin API 2026-07, productVariants, pagination par curseur,
//    petites pages, pause quand le budget de coût est bas ou si Shopify répond THROTTLED).
// 3. Écrit l'instantané dans shopify_products (upsert par id de variante).
// 4. Lecture complète terminée : règle de liaison automatique exacte et unique (décision W-6,
//    _shared/shopify-match.ts), liaisons écrites par _shopify_apply_auto_links (tracées dans events),
//    variantes disparues marquées « retirées ».
//
// Si la lecture dépasse le budget de temps, la réponse contient done=false, next_cursor et
// run_started_at : rappeler la fonction avec ces valeurs pour continuer (l'écran le fait seul).
//
// Corps : { company_id, cursor?, run_started_at? }
// Appelable par la clé de service, pg_cron (x-cron-secret) ou un administrateur actif de la société.
// deno-lint-ignore-file
import { identify, activeCompaniesOf, isUuid } from '../_shared/acces.ts';
import { decideAutoLinks, type MatchCandidate, type VariantToMatch } from '../_shared/shopify-match.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SHOP = Deno.env.get('SHOPIFY_STORE_DOMAIN');
const CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET');
const SB_URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const API_VERSION = '2026-07';
const PAGE_SIZE = 50;              // petites pages : coût demandé ~ 250 points
const TIME_BUDGET_MS = 100_000;    // on rend la main avant la limite des fonctions serveur

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const QUERY = `query Variants($first: Int!, $after: String) {
  productVariants(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title sku barcode price inventoryQuantity
      product {
        id title handle status vendor productType updatedAt
        featuredMedia { preview { image { url } } }
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

/** Une page GraphQL, avec pause si le budget de coût est bas et nouvel essai si THROTTLED. */
async function fetchPage(token: string, after: string | null) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: QUERY, variables: { first: PAGE_SIZE, after } }),
    });
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    const g = await r.json().catch(() => null);
    const throttled = Array.isArray(g?.errors) && g.errors.some((e: any) => e?.extensions?.code === 'THROTTLED');
    const cost = g?.extensions?.cost;
    if (throttled) {
      const st = cost?.throttleStatus;
      const need = (cost?.requestedQueryCost ?? 300) - (st?.currentlyAvailable ?? 0);
      await sleep(Math.max(1000, Math.ceil((need / Math.max(st?.restoreRate ?? 50, 1)) * 1000)));
      continue;
    }
    if (!r.ok || g?.errors) throw new Error(`graphql ${r.status}: ${JSON.stringify(g?.errors ?? '').slice(0, 300)}`);
    // Budget bas : on attend qu'il se reconstitue pour la page suivante.
    const st = cost?.throttleStatus;
    if (st && typeof st.currentlyAvailable === 'number' && st.currentlyAvailable < (cost.requestedQueryCost ?? 300) * 1.5) {
      const need = (cost.requestedQueryCost ?? 300) * 1.5 - st.currentlyAvailable;
      await sleep(Math.ceil((need / Math.max(st.restoreRate ?? 50, 1)) * 1000));
    }
    return g.data.productVariants as { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: any[] };
  }
  throw new Error('throttled: Shopify limite les appels, réessayer dans une minute');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const caller = await identify(req);
  if (!caller) return J({ error: 'not_signed_in' }, 401);

  const body = await req.json().catch(() => ({}));
  const companyId = body?.company_id;
  if (!isUuid(companyId)) return J({ error: 'company_id_required' }, 400);
  if (caller.kind === 'user' && !(await isAdminOf(caller.id, companyId))) return J({ error: 'forbidden' }, 403);
  const actor = caller.kind === 'user' ? caller.id : null;

  const missing = [!SHOP && 'SHOPIFY_STORE_DOMAIN', !CLIENT_ID && 'SHOPIFY_CLIENT_ID', !CLIENT_SECRET && 'SHOPIFY_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) return J({ ok: false, error: 'not_configured', missing }, 501);

  const started = Date.now();
  const runStartedAt: string = typeof body?.run_started_at === 'string' && !Number.isNaN(Date.parse(body.run_started_at))
    ? body.run_started_at : new Date().toISOString();
  let cursor: string | null = typeof body?.cursor === 'string' ? body.cursor : null;

  try {
    const tr = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID!, client_secret: CLIENT_SECRET! }).toString(),
    });
    if (!tr.ok) return J({ ok: false, error: 'token_failed', status: tr.status }, 502);
    const token = (await tr.json()).access_token as string;

    let pages = 0;
    let written = 0;
    let hasNext = true;
    while (hasNext) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        return J({ ok: true, done: false, next_cursor: cursor, run_started_at: runStartedAt, pages, variants_written: written });
      }
      const page = await fetchPage(token, cursor);
      const now = new Date().toISOString();
      const rows = page.nodes.map((v) => ({
        company_id: companyId,
        shopify_product_id: String(v.product?.id ?? ''),
        shopify_variant_id: String(v.id),
        product_title: v.product?.title ?? null,
        variant_title: v.title ?? null,
        handle: v.product?.handle ?? null,
        status: v.product?.status ?? null,
        sku: v.sku ?? null,
        barcode: v.barcode ?? null,
        price: v.price != null && v.price !== '' ? Number(v.price) : null,
        inventory_quantity: typeof v.inventoryQuantity === 'number' ? v.inventoryQuantity : null,
        image_url: v.product?.featuredMedia?.preview?.image?.url ?? null,
        vendor: v.product?.vendor ?? null,
        product_type: v.product?.productType ?? null,
        shopify_updated_at: v.product?.updatedAt ?? null,
        synced_at: now,
        removed_at: null,
      }));
      if (rows.length) {
        const w = await db('shopify_products?on_conflict=company_id,shopify_variant_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows),
        });
        if (!w.ok) throw new Error(`upsert: ${w.status} ${(await w.text()).slice(0, 300)}`);
      }
      written += rows.length;
      pages++;
      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    }

    // Lecture complète : rapprochement automatique exact et unique.
    // L'API renvoie au plus 1 000 lignes par appel : on pagine.
    type CandRow = { variant_id: string; sku: string | null; barcode: string | null; candidates: MatchCandidate[] };
    const cands: CandRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await db(`rpc/_shopify_auto_candidates?order=variant_id&limit=1000&offset=${offset}`, {
        method: 'POST', body: JSON.stringify({ _company: companyId }),
      });
      if (!r.ok) throw new Error(`_shopify_auto_candidates: ${r.status} ${(await r.text()).slice(0, 300)}`);
      const part = (await r.json()) as CandRow[];
      cands.push(...part);
      if (part.length < 1000) break;
    }
    const variants: VariantToMatch[] = cands.map((c) => ({ variant_id: c.variant_id, sku: c.sku, barcode: c.barcode }));
    const flat: MatchCandidate[] = cands.flatMap((c) => (c.candidates ?? []).map((x) => ({ ...x, variant_id: c.variant_id })));
    const decisions = decideAutoLinks(variants, flat);
    const links = [...decisions].filter(([, d]) => d.kind === 'auto')
      .map(([variant_id, d]) => ({ variant_id, article_id: (d as any).article_id, via: (d as any).via }));
    const reasons: Record<string, number> = {};
    for (const d of decisions.values()) if (d.kind === 'review') reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
    const stats = {
      pages_last_call: pages,
      undecided_variants: variants.length,
      with_sku: variants.filter((v) => (v.sku ?? '').trim() !== '').length,
      sku_exact_found: new Set(flat.filter((c) => c.via === 'sku').map((c) => c.variant_id)).size,
      barcode_exact_found: new Set(flat.filter((c) => c.via === 'barcode').map((c) => c.variant_id)).size,
      auto_links: links.length,
      review_reasons: reasons,
    };
    const applied = await rpc<Record<string, number>>('_shopify_apply_auto_links', {
      _company: companyId, _links: links, _actor: actor, _run_started_at: runStartedAt, _stats: stats,
    });
    return J({ ok: true, done: true, run_started_at: runStartedAt, variants_written_last_call: written, ...stats, ...applied });
  } catch (e) {
    return J({ ok: false, error: 'sync_failed', detail: String((e as Error)?.message ?? e).slice(0, 400), next_cursor: cursor, run_started_at: runStartedAt }, 502);
  }
});
