// Mission 03 — Publier ou retirer un article du site depuis sa fiche dans le DMS (W-8),
// et basculer le site d'une reference remplacee vers la nouvelle (decision client 29-30/10/2026).
//
// Actions (administrateur actif de la société) :
//   publish   article NON relié : crée le produit Shopify (titre et description web du DMS, photos du
//             Storage du DMS par liens signés 24 h, prix TTC, stock à l'emplacement, SKU = référence),
//             puis le relie (shopify_links « valide »). Refus si un produit Shopify porte déjà cette
//             référence (à relier depuis l'écran Produits Shopify, jamais de doublon).
//             Article relié mais produit retiré (brouillon / archivé) : le remet en ligne.
//   unpublish met le produit en BROUILLON (jamais supprimé).
//   update    repousse titre, description et photos du DMS pas encore envoyées.
//   switch    article_id = l'ANCIENNE reference A (reliee a un produit du site), remplacee par B
//             (fin de chaine, article_final_replacement) :
//               1. si la fiche de B n'a ni photo ni texte web, reprise du contenu du produit de A
//                  (titre, description, images -> Storage du DMS, regle « ne jamais ecraser ») ;
//               2. B heritee de « Publiable », puis publiee / remise en ligne / mise a jour, avec la
//                  mention « Remplace aussi la reference … » (toute la chaine) dans la description ;
//               3. A passe en brouillon ; 4. redirection Shopify /products/<A> -> /products/<B>.
//             Chaque etape est journalisee (shopify_sync_log + events) ; simulate renvoie le plan.
// La description envoyee porte TOUJOURS la mention des anciennes references de l'article (idempotente).
// Soumis au mode « Synchronisation Shopify » : arrêtée → refus ; essai → articles de la liste d'essai
// (bascule : l'ancienne ET la nouvelle) ; tous → tout article publiable.
//
// Corps : { company_id, article_id, action, simulate? }
//   simulate: true → lit Shopify, renvoie la mutation (ou le plan) qui SERAIT envoyée, n'écrit RIEN (même en mode arrêtée).
// deno-lint-ignore-file
import { identify, activeCompaniesOf, isUuid } from '../_shared/acces.ts';
import {
  LOCATIONS_QUERY, PRODUCT_SET_MUTATION, SKU_LOOKUP_QUERY, pickLocation, skuSearch, normalizeMode, canPublish,
  shopifyTtc, availableQty, isStockManaged, publishTitle, photosToPush, buildProductSetInput, buildStatusMutation,
  buildContentUpdateMutation, writeAllowed, type PublishPhoto, type SyncMode,
} from '../_shared/shopify-push.ts';
import {
  planSwitch, applyReplacementNotice, stripReplacementNotice, redirectPath, redirectSearch, pickRedirect,
  buildRedirectCreate, buildRedirectUpdate, mediaIdsOf, summarizeSteps,
  REDIRECT_LOOKUP_QUERY, PRODUCT_HANDLES_QUERY, PRODUCT_CONTENT_QUERY, type SwitchArticle, type SwitchStepName,
} from '../_shared/shopify-switch.ts';
import { planContentImport } from '../_shared/shopify-content.ts';
import { copyShopifyImage, imagesOfProduct, inPool } from '../_shared/shopify-media.ts';
import { shopifyMissingSecrets, shopifyToken, gql } from '../_shared/shopify-client.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SB_URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'ged';
const MAX_PHOTOS = 20;
const SIGNED_URL_SECONDS = 24 * 3600;   // Shopify télécharge les images en différé
const PARALLEL_DOWNLOADS = 4;

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

type CtxPhoto = { attachment_id: string; storage_path: string; content_type: string | null; alt_text: string | null; external_id: string | null; pushed_to: string[] };
type Ctx = {
  article_id: string; reference: string; designation: string | null; web_title: string | null; web_description: string | null;
  publishable: boolean; is_active: boolean; mgmt_type: string | null;
  sale_price_ttc: number | null; sale_price_ht: number | null; vat_rate: number | null; round_up: boolean;
  real_qty: number; reserved_qty: number; mode: string; in_trial: boolean;
  superseded_by_id?: string | null;
  /** Anciennes references de la chaine qui mene a cet article (migration 20261030130000 ; absent avant). */
  old_references?: string[] | null;
  link: { variant_id: string; product_id: string | null; product_status: string | null; handle?: string | null; link_status: string } | null;
  photos: CtxPhoto[];
};

type RecordFn = (a: string, ok: boolean, x: {
  product?: string | null; variant?: string | null; status?: string | null; title?: string | null; handle?: string | null;
  price?: number | null; qty?: number | null; media?: string[]; detail?: string | null;
}) => Promise<unknown>;

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 400);
const userErrText = (ue: any[]) => ue.map((u) => `${(u.field ?? []).join('.')}: ${u.message}`).join(' ; ').slice(0, 400);
const loadCtx = (companyId: string, articleId: string) => rpc<Ctx | null>('_shopify_publish_context', { _company: companyId, _article: articleId });

/** Description envoyee au site : texte web du DMS + mention des anciennes references (jamais dupliquee). */
const descriptionOf = (ctx: Ctx) => applyReplacementNotice(ctx.web_description ?? '', ctx.old_references ?? []);

function recorder(companyId: string, ctx: Ctx, actor: string | null): RecordFn {
  return (a, ok, x) => rpc('_shopify_publish_record', {
    _company: companyId, _article: ctx.article_id, _action: a, _ok: ok,
    _product: x.product ?? null, _variant: x.variant ?? null, _product_status: x.status ?? null, _title: x.title ?? null,
    _handle: x.handle ?? null, _price: x.price ?? null, _qty: x.qty ?? null, _sku: ctx.reference,
    _media: x.media ?? [], _actor: actor, _detail: x.detail ?? null,
  });
}

/** Photos du DMS à envoyer (liens signés), sans renvoyer celles déjà présentes sur le produit. */
async function preparePhotos(ctx: Ctx, productId: string | null, simulate: boolean, foreignMediaIds: string[] = []): Promise<PublishPhoto[]> {
  const toPush = photosToPush(ctx.photos ?? [], productId, foreignMediaIds).slice(0, MAX_PHOTOS);
  const photos: PublishPhoto[] = [];
  for (const p of toPush) {
    const url = simulate ? `(lien signé 24 h vers ${p.storage_path})` : await signedUrl(p.storage_path);
    if (url) photos.push({ attachment_id: p.attachment_id, url, alt: p.alt_text });
  }
  return photos;
}

type StepResult = { ok: boolean; simulate?: boolean; mutation?: unknown; status?: string; handle?: string | null; product_id?: string; photos?: number; error?: string; product_title?: string | null };

function throwOnErrors(g: { errors: any[] | null; data: any }, path: string) {
  const ue = g.data?.[path]?.userErrors ?? [];
  if (g.errors || ue.length) throw new Error(g.errors ? JSON.stringify(g.errors).slice(0, 300) : userErrText(ue));
}

// ── Retirer du site : brouillon, jamais supprimé
async function doUnpublish(token: string, ctx: Ctx, record: RecordFn, simulate: boolean, detail: string | null = null): Promise<StepResult> {
  const productId = ctx.link?.product_id ?? null;
  if (!productId) return { ok: false, error: 'not_linked' };
  const m = buildStatusMutation(productId, 'DRAFT');
  if (simulate) return { ok: true, simulate: true, mutation: m };
  const g = await gql(token, m.query, m.variables, 50);
  throwOnErrors(g, 'productUpdate');
  await record('retrait', true, { product: productId, status: 'DRAFT', handle: g.data?.productUpdate?.product?.handle ?? null, detail });
  return { ok: true, status: 'DRAFT', handle: g.data?.productUpdate?.product?.handle ?? null };
}

// ── Mettre à jour sur le site : titre, description (avec la mention), photos manquantes
async function doUpdate(token: string, ctx: Ctx, photos: PublishPhoto[], record: RecordFn, simulate: boolean, detail: string | null = null): Promise<StepResult> {
  const productId = ctx.link?.product_id ?? null;
  if (!productId) return { ok: false, error: 'not_linked' };
  const title = publishTitle(ctx);
  const m = buildContentUpdateMutation(productId, title, descriptionOf(ctx), photos);
  if (simulate) return { ok: true, simulate: true, mutation: m };
  const g = await gql(token, m.query, m.variables, 100);
  throwOnErrors(g, 'productUpdate');
  const p = g.data?.productUpdate?.product;
  await record('mise_a_jour', true, {
    product: productId, variant: ctx.link?.variant_id ?? null, status: p?.status ?? null, title, handle: p?.handle ?? null,
    media: photos.map((x) => x.attachment_id), detail: [`${photos.length} photo(s) ajoutée(s)`, detail].filter(Boolean).join(' ; '),
  });
  return { ok: true, photos: photos.length, handle: p?.handle ?? null, product_id: productId };
}

// ── Déjà relié, retiré du site : remise en ligne
async function doRepublish(token: string, ctx: Ctx, record: RecordFn, simulate: boolean, detail: string | null = null): Promise<StepResult> {
  const productId = ctx.link!.product_id!;
  const m = buildStatusMutation(productId, 'ACTIVE');
  if (simulate) return { ok: true, simulate: true, mutation: m };
  const g = await gql(token, m.query, m.variables, 50);
  throwOnErrors(g, 'productUpdate');
  await record('remise_en_ligne', true, { product: productId, status: 'ACTIVE', handle: g.data?.productUpdate?.product?.handle ?? null, detail });
  return { ok: true, status: 'ACTIVE', handle: g.data?.productUpdate?.product?.handle ?? null, product_id: productId };
}

// ── Publier : nouveau produit, SKU = référence, jamais de doublon
async function doPublish(token: string, ctx: Ctx, photos: PublishPhoto[], mode: SyncMode, record: RecordFn, simulate: boolean, detail: string | null = null): Promise<StepResult> {
  const ttc = shopifyTtc(ctx);
  const qty = isStockManaged(ctx.mgmt_type) ? availableQty(ctx.real_qty, ctx.reserved_qty) : null;
  const check = canPublish({
    mode: simulate && mode === 'arrete' ? 'tous' : mode, in_trial: ctx.in_trial, publishable: ctx.publishable,
    is_active: ctx.is_active !== false, has_link: !!ctx.link, ttc,
  });
  if (!check.ok) return { ok: false, error: check.reason };

  const dup = await gql(token, SKU_LOOKUP_QUERY, { q: skuSearch(ctx.reference) }, 50);
  const same = (dup.data?.productVariants?.nodes ?? []).filter((n: any) => String(n?.sku ?? '').trim().toUpperCase() === ctx.reference.trim().toUpperCase());
  if (same.length) return { ok: false, error: 'sku_exists', product_title: same[0]?.product?.title ?? null };

  const loc = await gql(token, LOCATIONS_QUERY, {}, 50);
  const locationId = pickLocation(loc.data?.locations?.nodes ?? []);
  if (!locationId && isStockManaged(ctx.mgmt_type)) throw new Error('emplacement « Chaussée de Bruxelles 688 » introuvable sur Shopify');
  const input = buildProductSetInput({ ...ctx, web_description: descriptionOf(ctx) }, photos, locationId);
  if (simulate) return { ok: true, simulate: true, mutation: { query: PRODUCT_SET_MUTATION, variables: { input } } };

  const g = await gql(token, PRODUCT_SET_MUTATION, { input }, 100);
  throwOnErrors(g, 'productSet');
  const p = g.data?.productSet?.product;
  const v = p?.variants?.nodes?.[0];
  if (!p?.id || !v?.id) throw new Error('réponse Shopify sans produit');
  await record('publication', true, {
    product: p.id, variant: v.id, status: p.status ?? 'ACTIVE', title: p.title ?? publishTitle(ctx), handle: p.handle ?? null,
    price: ttc, qty, media: photos.map((x) => x.attachment_id), detail: [`${photos.length} photo(s)`, detail].filter(Boolean).join(' ; '),
  });
  return { ok: true, product_id: p.id, handle: p.handle ?? null, photos: photos.length };
}

// ─── Bascule d'une reference remplacee ─────────────────────────────────────────────────

type SwitchResult = { step: SwitchStepName; ok: boolean; detail: string | null };

function toSwitchArticle(c: Ctx): SwitchArticle {
  return {
    article_id: c.article_id, reference: c.reference, is_active: c.is_active !== false, in_trial: c.in_trial,
    ttc: shopifyTtc(c), web_title: c.web_title, web_description: c.web_description, photo_count: (c.photos ?? []).length,
    link: c.link ? { product_id: c.link.product_id, product_status: c.link.product_status, handle: c.link.handle ?? null } : null,
  };
}

async function runSwitch(companyId: string, articleId: string, simulate: boolean, actor: string | null): Promise<{ body: unknown; http: number }> {
  type SwitchCtx = { mode: string; old: Ctx; next: Ctx; redirect: { id: string; shopify_redirect_id: string | null; path_from: string; path_to: string } | null };
  const sc = await rpc<SwitchCtx | null>('_shopify_switch_context', { _company: companyId, _article: articleId });
  if (!sc?.old) return { body: { error: 'article_not_found' }, http: 404 };
  const mode = normalizeMode(sc.mode);
  let next = sc.next;
  const old = sc.old;
  const plan = planSwitch({
    mode, old: toSwitchArticle(old), next: toSwitchArticle(next),
    old_references: next.old_references ?? [], redirect_done: !!sc.redirect,
  });
  const head = { old: { article_id: old.article_id, reference: old.reference }, next: { article_id: next.article_id, reference: next.reference }, plan };
  if (simulate) return { body: { ok: plan.ok, simulate: true, error: plan.reason ?? undefined, ...head }, http: 200 };
  if (!plan.ok) return { body: { ok: false, error: plan.reason, ...head }, http: 409 };

  const missing = shopifyMissingSecrets();
  if (missing.length) return { body: { ok: false, error: 'not_configured', missing }, http: 501 };
  const token = await shopifyToken();
  const results: SwitchResult[] = [];
  const from = `Bascule depuis ${old.reference}`;
  const recordSwitch = (kind: 'redirection' | 'bascule', ok: boolean, x: { redirect_id?: string | null; path_from?: string | null; path_to?: string | null; detail?: string | null }) =>
    rpc('_shopify_switch_record', {
      _company: companyId, _from: old.article_id, _to: next.article_id, _kind: kind, _ok: ok,
      _redirect_id: x.redirect_id ?? null, _path_from: x.path_from ?? null, _path_to: x.path_to ?? null, _actor: actor, _detail: x.detail ?? null,
    });
  const finish = async (http: number) => {
    const ok = results.every((r) => r.ok);
    await recordSwitch('bascule', ok, { detail: summarizeSteps(plan.steps) + ' | ' + results.map((r) => `${r.step}:${r.ok ? 'ok' : 'erreur'}${r.detail ? ` (${r.detail})` : ''}`).join(' ; ') }).catch(() => null);
    return { body: { ok, ...head, results }, http };
  };

  const oldProductId = old.link!.product_id!;
  let foreignMediaIds: string[] = [];

  // 1. Contenu de B repris du produit de A (si la fiche de B est vide) — la regle « ne jamais ecraser » joue.
  if (plan.steps.some((s) => s.step === 'contenu' && s.status === 'a_faire')) {
    try {
      const g = await gql(token, PRODUCT_CONTENT_QUERY, { id: oldProductId }, 60);
      if (g.errors) throw new Error(JSON.stringify(g.errors).slice(0, 300));
      const product = g.data?.node;
      if (!product?.id) throw new Error('produit de l\'ancienne reference introuvable sur Shopify (relire Shopify)');
      const images = imagesOfProduct(product);
      foreignMediaIds = mediaIdsOf(product);
      const cplan = planContentImport(
        {
          web_title: next.web_title, web_description: next.web_description,
          imported_media_ids: (next.photos ?? []).map((p) => p.external_id).filter((x): x is string => !!x),
          existing_photo_count: (next.photos ?? []).length,
        },
        { title: product.title ?? null, description_html: stripReplacementNotice(product.descriptionHtml), featured_media_id: product.featuredMedia?.id ?? null, images },
        next.designation ?? next.reference,
      );
      const copied = await inPool(cplan.images_to_add, PARALLEL_DOWNLOADS, (im) => copyShopifyImage(SB_URL!, SVC!, companyId, next.article_id, im));
      const okImages = cplan.images_to_add
        .map((im, k) => ({ im, r: copied[k] }))
        .filter((x) => x.r.status === 'fulfilled')
        .map(({ im, r }) => ({ media_id: im.media_id, alt_text: im.alt_text, position: im.position, ...(r as PromiseFulfilledResult<any>).value }));
      const failed = copied.filter((r) => r.status === 'rejected').length;
      const res = await rpc<Record<string, any>>('_shopify_apply_content', {
        _company: companyId, _article: next.article_id, _product: oldProductId,
        _title: cplan.shopify_title, _description: cplan.shopify_description || null,
        _images: okImages, _images_found: images.length, _actor: actor, _error: null,
      });
      results.push({
        step: 'contenu', ok: failed === 0,
        detail: `titre ${res?.title_applied ? 'repris' : 'garde'}, description ${res?.description_applied ? 'reprise' : 'gardee'}, ${Number(res?.images_added ?? 0)} photo(s) reprise(s)${failed ? `, ${failed} en echec` : ''}`,
      });
      next = (await loadCtx(companyId, next.article_id)) ?? next;
    } catch (e) {
      results.push({ step: 'contenu', ok: false, detail: errText(e) });
      return finish(502);           // sans contenu, on ne publie pas une fiche vide : rien d'autre n'est touche
    }
  }

  // 2. B heritee de « Publiable », puis sur le site avec la mention.
  try {
    await rpc('_shopify_switch_prepare', { _company: companyId, _from: old.article_id, _to: next.article_id, _actor: actor });
    next = (await loadCtx(companyId, next.article_id)) ?? next;
    const recordNext = recorder(companyId, next, actor);
    let nextProductId = next.link?.product_id ?? null;
    let nextHandle = next.link?.handle ?? null;
    if (!nextProductId) {
      const photos = await preparePhotos(next, null, false);
      const r = await doPublish(token, next, photos, mode, recordNext, false, from);
      if (!r.ok) throw new Error(r.error === 'sku_exists' ? `un produit du site porte deja la reference ${next.reference} (${r.product_title ?? ''}) : le relier depuis Produits Shopify` : String(r.error));
      nextProductId = r.product_id ?? null;
      nextHandle = r.handle ?? null;
      results.push({ step: 'publication', ok: true, detail: `${r.photos ?? 0} photo(s)` });
    } else {
      if (next.link?.product_status !== 'ACTIVE') {
        const r = await doRepublish(token, next, recordNext, false, from);
        nextHandle = r.handle ?? nextHandle;
        results.push({ step: 'remise_en_ligne', ok: true, detail: null });
      }
      const photos = await preparePhotos(next, nextProductId, false, foreignMediaIds);
      const r = await doUpdate(token, next, photos, recordNext, false, from);
      nextHandle = r.handle ?? nextHandle;
      results.push({ step: 'mise_a_jour', ok: true, detail: `${r.photos ?? 0} photo(s) ajoutee(s) ; ${plan.notice}` });
    }

    // 3. A retiree (brouillon, jamais supprimee).
    const recordOld = recorder(companyId, old, actor);
    if (old.link?.product_status === 'ACTIVE') {
      try {
        await doUnpublish(token, old, recordOld, false, `Remplacee par ${next.reference}`);
        results.push({ step: 'retrait', ok: true, detail: null });
      } catch (e) {
        await recordOld('retrait', false, { product: oldProductId, detail: errText(e) }).catch(() => null);
        results.push({ step: 'retrait', ok: false, detail: errText(e) });
      }
    }

    // 4. Redirection /products/<A> -> /products/<B>.
    if (!sc.redirect) {
      try {
        const h = await gql(token, PRODUCT_HANDLES_QUERY, { ids: [oldProductId, nextProductId] }, 20);
        const handles = new Map<string, string>();
        for (const n of h.data?.nodes ?? []) if (n?.id && n?.handle) handles.set(String(n.id), String(n.handle));
        const fromHandle = handles.get(oldProductId) ?? old.link?.handle ?? null;
        const toHandle = handles.get(nextProductId!) ?? nextHandle ?? null;
        if (!fromHandle || !toHandle) throw new Error('adresse (handle) du produit introuvable sur Shopify');
        const pathFrom = redirectPath(fromHandle);
        const pathTo = redirectPath(toHandle);
        const look = await gql(token, REDIRECT_LOOKUP_QUERY, { q: redirectSearch(pathFrom) }, 20);
        if (look.errors) throw new Error(JSON.stringify(look.errors).slice(0, 300));
        const existing = pickRedirect(look.data?.urlRedirects?.nodes ?? [], pathFrom);
        let redirectId: string | null = existing?.id ?? null;
        let detail: string;
        if (existing && String(existing.target).replace(/\/+$/, '') === pathTo) {
          detail = 'deja presente sur Shopify';
        } else if (existing) {
          const m = buildRedirectUpdate(existing.id, toHandle);
          const g = await gql(token, m.query, m.variables, 20);
          throwOnErrors(g, 'urlRedirectUpdate');
          detail = 'cible mise a jour';
        } else {
          const m = buildRedirectCreate(fromHandle, toHandle);
          const g = await gql(token, m.query, m.variables, 20);
          throwOnErrors(g, 'urlRedirectCreate');
          redirectId = g.data?.urlRedirectCreate?.urlRedirect?.id ?? null;
          detail = 'creee';
        }
        await recordSwitch('redirection', true, { redirect_id: redirectId, path_from: pathFrom, path_to: pathTo, detail });
        results.push({ step: 'redirection', ok: true, detail: `${pathFrom} -> ${pathTo} (${detail})` });
      } catch (e) {
        const msg = errText(e);
        const hint = /access|scope|permission|denied/i.test(msg) ? ' — droit write_online_store_navigation manquant : publier la nouvelle version de l\'application Shopify (integrations/shopify-app)' : '';
        await recordSwitch('redirection', false, { detail: msg + hint }).catch(() => null);
        results.push({ step: 'redirection', ok: false, detail: msg + hint });
      }
    }
    return finish(200);
  } catch (e) {
    // La nouvelle reference n'a pas pu etre mise sur le site : l'ancienne reste telle quelle.
    const a = !next.link ? 'publication' : next.link.product_status !== 'ACTIVE' ? 'remise_en_ligne' : 'mise_a_jour';
    await recorder(companyId, next, actor)(a, false, { product: next.link?.product_id ?? null, detail: `${from} : ${errText(e)}` }).catch(() => null);
    results.push({ step: a as SwitchStepName, ok: false, detail: errText(e) });
    return finish(502);
  }
}

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
  if (!['publish', 'unpublish', 'update', 'switch'].includes(action)) return J({ error: 'unknown_action' }, 400);
  if (caller.kind === 'cron' && !simulate) return J({ error: 'forbidden' }, 403);   // la tâche planifiée ne publie jamais
  if (caller.kind === 'user' && !(await isAdminOf(caller.id, companyId))) return J({ error: 'forbidden' }, 403);
  const actor = caller.kind === 'user' ? caller.id : null;

  if (action === 'switch') {
    try {
      const r = await runSwitch(companyId, articleId, simulate, actor);
      return J(r.body, r.http);
    } catch (e) {
      return J({ ok: false, error: 'shopify_failed', detail: errText(e) }, 502);
    }
  }

  const ctx = await loadCtx(companyId, articleId);
  if (!ctx) return J({ error: 'article_not_found' }, 404);
  const mode = normalizeMode(ctx.mode);
  if (!simulate && !writeAllowed(mode, ctx.in_trial)) {
    return J({ ok: false, error: mode === 'arrete' ? 'sync_stopped' : 'not_in_trial' }, 409);
  }

  const missing = shopifyMissingSecrets();
  if (missing.length) return J({ ok: false, error: 'not_configured', missing }, 501);

  const record = recorder(companyId, ctx, actor);
  const productId = ctx.link?.product_id ?? null;

  try {
    const token = await shopifyToken();

    if (action === 'unpublish') {
      const r = await doUnpublish(token, ctx, record, simulate);
      return J(r.ok ? { ...r, action } : r, r.ok ? 200 : 409);
    }

    const photos = await preparePhotos(ctx, productId, simulate);

    if (action === 'update') {
      const r = await doUpdate(token, ctx, photos, record, simulate);
      return J(r.ok ? { ...r, action, photos_added: r.photos } : r, r.ok ? 200 : 409);
    }

    // ── Publier
    if (productId && ctx.link?.product_status && ctx.link.product_status !== 'ACTIVE') {
      const r = await doRepublish(token, ctx, record, simulate);
      return J({ ...r, action });
    }
    const r = await doPublish(token, ctx, photos, mode, record, simulate);
    return J(r.ok ? { ...r, action } : r, r.ok ? 200 : 409);
  } catch (e) {
    if (simulate) return J({ ok: false, simulate: true, error: errText(e) }, 502);
    const a = action === 'unpublish' ? 'retrait' : action === 'update' ? 'mise_a_jour' : 'publication';
    await record(a, false, { product: productId, detail: errText(e) }).catch(() => null);
    return J({ ok: false, error: 'shopify_failed', detail: errText(e) }, 502);
  }
});
