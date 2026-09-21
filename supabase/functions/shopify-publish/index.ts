// Mission 03 — Publier ou retirer un article du site depuis sa fiche dans le DMS (W-8).
//
// Actions (administrateur actif de la société) :
//   publish   article NON relié : crée le produit Shopify (titre et description web du DMS, photos du
//             Storage du DMS par liens signés 24 h, prix TTC, stock à l'emplacement, SKU = référence),
//             puis le relie (shopify_links « valide »). Refus si un produit Shopify porte déjà cette
//             référence (à relier depuis l'écran Produits Shopify, jamais de doublon).
//             Article relié mais produit retiré (brouillon / archivé) : le remet en ligne.
//   unpublish met le produit en BROUILLON (jamais supprimé).
//   update    repousse titre, description et photos du DMS pas encore envoyées.
// Soumis au mode « Synchronisation Shopify » : arrêtée → refus ; essai → articles de la liste d'essai ;
// tous → tout article publiable. Chaque action est tracée (events + journal shopify_sync_log).
//
// Corps : { company_id, article_id, action, simulate? }
//   simulate: true → lit Shopify, renvoie la mutation qui SERAIT envoyée, n'écrit RIEN (même en mode arrêtée).
// deno-lint-ignore-file
import { identify, activeCompaniesOf, isUuid } from '../_shared/acces.ts';
import {
  LOCATIONS_QUERY, PRODUCT_SET_MUTATION, SKU_LOOKUP_QUERY, pickLocation, skuSearch, normalizeMode, canPublish,
  shopifyTtc, availableQty, isStockManaged, publishTitle, photosToPush, buildProductSetInput, buildStatusMutation,
  buildContentUpdateMutation, writeAllowed, type PublishPhoto,
} from '../_shared/shopify-push.ts';
import { shopifyMissingSecrets, shopifyToken, gql } from '../_shared/shopify-client.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SB_URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'ged';
const MAX_PHOTOS = 20;
const SIGNED_URL_SECONDS = 24 * 3600;   // Shopify télécharge les images en différé

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

async function signedUrl(path: string): Promise<string | null> {
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const s = j?.signedURL ?? j?.signedUrl;
  return s ? `${SB_URL}/storage/v1${s.startsWith('/') ? '' : '/'}${s}` : null;
}

type Ctx = {
  article_id: string; reference: string; designation: string | null; web_title: string | null; web_description: string | null;
  publishable: boolean; is_active: boolean; mgmt_type: string | null;
  sale_price_ttc: number | null; sale_price_ht: number | null; vat_rate: number | null; round_up: boolean;
  real_qty: number; reserved_qty: number; mode: string; in_trial: boolean;
  link: { variant_id: string; product_id: string | null; product_status: string | null; link_status: string } | null;
  photos: { attachment_id: string; storage_path: string; content_type: string | null; alt_text: string | null; external_id: string | null; pushed_to: string[] }[];
};

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 400);
const userErrText = (ue: any[]) => ue.map((u) => `${(u.field ?? []).join('.')}: ${u.message}`).join(' ; ').slice(0, 400);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const caller = await identify(req);
  if (!caller) return J({ error: 'not_signed_in' }, 401);
  const body = await req.json().catch(() => ({}));
  const companyId = body?.company_id;
  const articleId = body?.article_id;
  const action = body?.action;
  const simulate = body?.simulate === true;
  if (!isUuid(companyId) || !isUuid(articleId)) return J({ error: 'company_and_article_required' }, 400);
  if (!['publish', 'unpublish', 'update'].includes(action)) return J({ error: 'unknown_action' }, 400);
  if (caller.kind === 'cron' && !simulate) return J({ error: 'forbidden' }, 403);   // la tâche planifiée ne publie jamais
  if (caller.kind === 'user' && !(await isAdminOf(caller.id, companyId))) return J({ error: 'forbidden' }, 403);
  const actor = caller.kind === 'user' ? caller.id : null;

  const ctx = await rpc<Ctx | null>('_shopify_publish_context', { _company: companyId, _article: articleId });
  if (!ctx) return J({ error: 'article_not_found' }, 404);
  const mode = normalizeMode(ctx.mode);
  if (!simulate && !writeAllowed(mode, ctx.in_trial)) {
    return J({ ok: false, error: mode === 'arrete' ? 'sync_stopped' : 'not_in_trial' }, 409);
  }

  const missing = shopifyMissingSecrets();
  if (missing.length) return J({ ok: false, error: 'not_configured', missing }, 501);

  const record = (a: string, ok: boolean, x: {
    product?: string | null; variant?: string | null; status?: string | null; title?: string | null; handle?: string | null;
    price?: number | null; qty?: number | null; media?: string[]; detail?: string | null;
  }) => rpc('_shopify_publish_record', {
    _company: companyId, _article: articleId, _action: a, _ok: ok,
    _product: x.product ?? null, _variant: x.variant ?? null, _product_status: x.status ?? null, _title: x.title ?? null,
    _handle: x.handle ?? null, _price: x.price ?? null, _qty: x.qty ?? null, _sku: ctx.reference,
    _media: x.media ?? [], _actor: actor, _detail: x.detail ?? null,
  });

  const title = publishTitle(ctx);
  const ttc = shopifyTtc(ctx);
  const qty = isStockManaged(ctx.mgmt_type) ? availableQty(ctx.real_qty, ctx.reserved_qty) : null;
  const productId = ctx.link?.product_id ?? null;

  try {
    const token = await shopifyToken();

    // ── Retirer du site : brouillon, jamais supprimé
    if (action === 'unpublish') {
      if (!productId) return J({ ok: false, error: 'not_linked' }, 409);
      const m = buildStatusMutation(productId, 'DRAFT');
      if (simulate) return J({ ok: true, simulate: true, mutation: m });
      const g = await gql(token, m.query, m.variables, 50);
      const ue = g.data?.productUpdate?.userErrors ?? [];
      if (g.errors || ue.length) throw new Error(g.errors ? JSON.stringify(g.errors).slice(0, 300) : userErrText(ue));
      await record('retrait', true, { product: productId, status: 'DRAFT' });
      return J({ ok: true, action, status: 'DRAFT' });
    }

    // Photos du DMS à envoyer (liens signés), sans renvoyer celles déjà présentes sur le produit.
    const toPush = photosToPush(ctx.photos ?? [], productId).slice(0, MAX_PHOTOS);
    const photos: PublishPhoto[] = [];
    for (const p of toPush) {
      const url = simulate ? `(lien signé 24 h vers ${p.storage_path})` : await signedUrl(p.storage_path);
      if (url) photos.push({ attachment_id: p.attachment_id, url, alt: p.alt_text });
    }

    // ── Mettre à jour sur le site : titre, description, photos manquantes
    if (action === 'update') {
      if (!productId) return J({ ok: false, error: 'not_linked' }, 409);
      const m = buildContentUpdateMutation(productId, title, ctx.web_description ?? '', photos);
      if (simulate) return J({ ok: true, simulate: true, mutation: m });
      const g = await gql(token, m.query, m.variables, 100);
      const ue = g.data?.productUpdate?.userErrors ?? [];
      if (g.errors || ue.length) throw new Error(g.errors ? JSON.stringify(g.errors).slice(0, 300) : userErrText(ue));
      const p = g.data?.productUpdate?.product;
      await record('mise_a_jour', true, {
        product: productId, variant: ctx.link?.variant_id ?? null, status: p?.status ?? null, title, handle: p?.handle ?? null,
        media: photos.map((x) => x.attachment_id), detail: `${photos.length} photo(s) ajoutée(s)`,
      });
      return J({ ok: true, action, photos_added: photos.length });
    }

    // ── Publier
    if (productId && ctx.link?.product_status && ctx.link.product_status !== 'ACTIVE') {
      // Déjà relié, retiré du site : remise en ligne.
      const m = buildStatusMutation(productId, 'ACTIVE');
      if (simulate) return J({ ok: true, simulate: true, mutation: m });
      const g = await gql(token, m.query, m.variables, 50);
      const ue = g.data?.productUpdate?.userErrors ?? [];
      if (g.errors || ue.length) throw new Error(g.errors ? JSON.stringify(g.errors).slice(0, 300) : userErrText(ue));
      await record('remise_en_ligne', true, { product: productId, status: 'ACTIVE' });
      return J({ ok: true, action, status: 'ACTIVE' });
    }

    const check = canPublish({
      mode: simulate && mode === 'arrete' ? 'tous' : mode, in_trial: ctx.in_trial, publishable: ctx.publishable,
      is_active: ctx.is_active !== false, has_link: !!ctx.link, ttc,
    });
    if (!check.ok) return J({ ok: false, error: check.reason }, 409);

    // Jamais de doublon : un produit porte-t-il déjà cette référence ?
    const dup = await gql(token, SKU_LOOKUP_QUERY, { q: skuSearch(ctx.reference) }, 50);
    const same = (dup.data?.productVariants?.nodes ?? []).filter((n: any) => String(n?.sku ?? '').trim().toUpperCase() === ctx.reference.trim().toUpperCase());
    if (same.length) {
      return J({ ok: false, error: 'sku_exists', product_title: same[0]?.product?.title ?? null }, 409);
    }

    const loc = await gql(token, LOCATIONS_QUERY, {}, 50);
    const locationId = pickLocation(loc.data?.locations?.nodes ?? []);
    if (!locationId && isStockManaged(ctx.mgmt_type)) throw new Error('emplacement « Chaussée de Bruxelles 688 » introuvable sur Shopify');
    const input = buildProductSetInput(ctx, photos, locationId);
    if (simulate) return J({ ok: true, simulate: true, mutation: { query: PRODUCT_SET_MUTATION, variables: { input } } });

    const g = await gql(token, PRODUCT_SET_MUTATION, { input }, 100);
    const ue = g.data?.productSet?.userErrors ?? [];
    if (g.errors || ue.length) throw new Error(g.errors ? JSON.stringify(g.errors).slice(0, 300) : userErrText(ue));
    const p = g.data?.productSet?.product;
    const v = p?.variants?.nodes?.[0];
    if (!p?.id || !v?.id) throw new Error('réponse Shopify sans produit');
    await record('publication', true, {
      product: p.id, variant: v.id, status: p.status ?? 'ACTIVE', title: p.title ?? title, handle: p.handle ?? null,
      price: ttc, qty, media: photos.map((x) => x.attachment_id), detail: `${photos.length} photo(s)`,
    });
    return J({ ok: true, action, product_id: p.id, handle: p.handle ?? null, photos: photos.length });
  } catch (e) {
    if (simulate) return J({ ok: false, simulate: true, error: errText(e) }, 502);
    const a = action === 'unpublish' ? 'retrait' : action === 'update' ? 'mise_a_jour' : 'publication';
    await record(a, false, { product: productId, detail: errText(e) }).catch(() => null);
    return J({ ok: false, error: 'shopify_failed', detail: errText(e) }, 502);
  }
});
