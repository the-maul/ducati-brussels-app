// Mission 03 — « Une vente sur le site crée la vente et la sortie de stock dans le DMS » (W-4, W-7).
//
// Trois façons d'arriver ici :
//   1. WEBHOOK Shopify (orders/create, orders/paid, orders/cancelled, refunds/create) : signature
//      X-Shopify-Hmac-Sha256 vérifiée (HMAC-SHA256 du corps brut avec SHOPIFY_CLIENT_SECRET), domaine de
//      la boutique vérifié. Le corps sert seulement à trouver l'id de la commande : la commande est
//      ensuite RELUE par l'API GraphQL (une seule forme de données, toujours à jour).
//   2. RATTRAPAGE planifié (pg_cron toutes les 15 min, en-tête x-cron-secret) : relit les commandes
//      modifiées depuis la dernière lecture, au cas où un webhook serait perdu.
//   3. ÉCRAN « Commandes du site » (utilisateur connecté) :
//        { action: 'retry', company_id, order_id }  → Réessayer une commande (admin ou vendeur) ;
//        { action: 'sync', company_id }             → Relire maintenant (admin) ;
//        { action: 'preview', company_id, limit? }  → aperçu du mappage SANS rien écrire (admin).
//
// Rien ne se fait tant que le réglage société « Import des commandes du site » est Arrêté (livré
// Arrêté) ; une fois Actif, seules les commandes passées APRÈS l'activation sont importées (les
// commandes plus anciennes ont été traitées hors DMS).
// Écritures : une seule fonction SQL transactionnelle, _shopify_order_apply (clé de service) :
// client retrouvé par e-mail ou créé (jamais fusionné), facture + lignes + sortie de stock par
// record_stock_move + règlement reçu, avoirs des remboursements, cloche « Nouvelle commande web »,
// traces events. Idempotent : id de commande Shopify unique, un avoir par remboursement Shopify.
// Aucune écriture vers Shopify. Aucun mail envoyé.
// deno-lint-ignore-file
import { identify, activeCompaniesOf, isUuid } from '../_shared/acces.ts';
import {
  ORDER_FIELDS, importDecision, mapOrderToSale, mapRefundToCredit, normalizeGraphqlOrder, refundsToApply,
  verifyShopifyHmac, customerFromOrder, zeroAmountRefunds, type InvoiceLine, type LinkedArticle, type ShopOrder,
} from '../_shared/shopify-order.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SHOP = Deno.env.get('SHOPIFY_STORE_DOMAIN');
const CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET');
const SB_URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const API_VERSION = '2026-07';
const TIME_BUDGET_MS = 100_000;
const TOPICS = new Set(['orders/create', 'orders/paid', 'orders/cancelled', 'orders/updated', 'refunds/create']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 400)}`);
  const txt = await r.text();
  return (txt ? JSON.parse(txt) : null) as T;
}
async function rows<T>(path: string): Promise<T[]> {
  const r = await db(path);
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T[];
}

async function hasRole(userId: string, companyId: string, roles: string[]): Promise<boolean> {
  if (!(await activeCompaniesOf(userId)).includes(companyId)) return false;
  const list = roles.map((r) => `"${r}"`).join(',');
  const x = await rows<{ role: string }>(`user_roles?select=role&user_id=eq.${userId}&company_id=eq.${companyId}&role=in.(${list})&limit=1`);
  return x.length > 0;
}

// ---------------------------------------------------------------- Shopify

let tokenCache: { token: string; at: number } | null = null;
async function shopToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 3600_000) return tokenCache.token;
  const tr = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID!, client_secret: CLIENT_SECRET! }).toString(),
  });
  if (!tr.ok) throw new Error(`token_failed ${tr.status}`);
  tokenCache = { token: (await tr.json()).access_token as string, at: Date.now() };
  return tokenCache.token;
}

async function gql(query: string, variables: Record<string, unknown>): Promise<any> {
  const token = await shopToken();
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    const g = await r.json().catch(() => null);
    const throttled = Array.isArray(g?.errors) && g.errors.some((e: any) => e?.extensions?.code === 'THROTTLED');
    if (throttled) { await sleep(2000 * (attempt + 1)); continue; }
    if (!r.ok || g?.errors) throw new Error(`graphql ${r.status}: ${JSON.stringify(g?.errors ?? '').slice(0, 400)}`);
    return g.data;
  }
  throw new Error('throttled');
}

async function fetchOrder(orderGid: string): Promise<ShopOrder | null> {
  const d = await gql(`query One($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id: orderGid });
  return d?.order ? normalizeGraphqlOrder(d.order) : null;
}

/** Commandes modifiées depuis `sinceIso` (plus anciennes d'abord), au plus `max`. */
async function fetchRecentOrders(sinceIso: string, max = 100): Promise<ShopOrder[]> {
  const out: ShopOrder[] = [];
  let after: string | null = null;
  const q = `updated_at:>='${sinceIso}'`;
  while (out.length < max) {
    const d: any = await gql(
      `query Recent($q: String!, $after: String) { orders(first: 10, after: $after, query: $q, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor } nodes { ${ORDER_FIELDS} } } }`,
      { q, after },
    );
    const conn = d?.orders;
    for (const n of conn?.nodes ?? []) out.push(normalizeGraphqlOrder(n));
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out.slice(0, max);
}

const orderGidFrom = (id: unknown): string | null => {
  if (typeof id === 'string' && id.startsWith('gid://shopify/Order/')) return id;
  if ((typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && /^\d+$/.test(id))) return `gid://shopify/Order/${id}`;
  return null;
};

// ---------------------------------------------------------------- Traitement d'une commande

type Settings = { company_id: string; import_enabled: boolean; enabled_at: string | null; last_catchup_at: string | null };

async function linksFor(companyId: string, variantIds: string[]): Promise<Record<string, LinkedArticle>> {
  const out: Record<string, LinkedArticle> = {};
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const inList = ids.map((v) => `"${v.replace(/"/g, '')}"`).join(',');
  const links = await rows<{ shopify_variant_id: string; article_id: string | null }>(
    `shopify_links?select=shopify_variant_id,article_id&company_id=eq.${companyId}&status=in.(auto_exact,valide)&shopify_variant_id=in.(${encodeURIComponent(inList)})`,
  );
  const artIds = [...new Set(links.map((l) => l.article_id).filter(isUuid))];
  if (artIds.length === 0) return out;
  const arts = await rows<{ id: string; reference: string | null; designation: string | null; vat_rate: number | null }>(
    `articles?select=id,reference,designation,vat_rate&company_id=eq.${companyId}&id=in.(${artIds.join(',')})`,
  );
  const byId = new Map(arts.map((a) => [a.id, a]));
  for (const l of links) {
    const a = l.article_id ? byId.get(l.article_id) : undefined;
    if (a) out[l.shopify_variant_id] = { articleId: a.id, reference: a.reference, designation: a.designation, vatRate: a.vat_rate == null ? null : Number(a.vat_rate) };
  }
  return out;
}

/** Tout ce que _shopify_order_apply doit écrire, calculé ici (règles pures testées). */
async function buildPayload(companyId: string, o: ShopOrder, via: string) {
  const links = await linksFor(companyId, o.lines.map((l) => l.variantId ?? ''));
  const decision = importDecision(o);
  const sale = mapOrderToSale(o, links);
  // Lignes de la facture déjà enregistrée (pour les avoirs), relues en base.
  const existing = await rows<{ document_id: string | null; refund_ids: string[] | null }>(
    `shopify_orders?select=document_id,refund_ids:shopify_order_refunds(shopify_refund_id)&company_id=eq.${companyId}&shopify_order_id=eq.${encodeURIComponent(o.id)}&limit=1`,
  ).catch(() => []);
  const ex: any = existing[0];
  const applied: string[] = (ex?.refund_ids ?? []).map((x: any) => x?.shopify_refund_id).filter(Boolean);
  let invoiceLines: InvoiceLine[] | null = null;
  if (ex?.document_id) {
    const ol = await rows<any>(`shopify_order_lines?select=shopify_line_id,document_line:document_lines(article_id,designation,reference,quantity,unit_price_ht,vat_rate,discount_pct,line_ht,line_ttc)&company_id=eq.${companyId}&shopify_order_id=eq.${encodeURIComponent(o.id)}`);
    invoiceLines = ol.filter((x) => x.document_line).map((x) => ({
      shopifyLineId: x.shopify_line_id, articleId: x.document_line.article_id, designation: x.document_line.designation,
      reference: x.document_line.reference, quantity: Number(x.document_line.quantity), unitPriceHt: Number(x.document_line.unit_price_ht),
      vatRate: Number(x.document_line.vat_rate), discountPct: Number(x.document_line.discount_pct),
      lineHt: Number(x.document_line.line_ht), lineTtc: Number(x.document_line.line_ttc),
    }));
  } else {
    // Import dans la même transaction : l'avoir reprend les lignes calculées pour la facture.
    invoiceLines = sale.lines.filter((l) => l.kind === 'item' && l.shopifyLineId).map((l) => ({
      shopifyLineId: l.shopifyLineId!, articleId: l.articleId, designation: l.designation, reference: l.reference,
      quantity: l.quantity, unitPriceHt: l.unitPriceHt, vatRate: l.vatRate, discountPct: l.discountPct, lineHt: l.lineHt, lineTtc: l.lineTtc,
    }));
  }
  const credits = refundsToApply(o.refunds, applied).map((r) => ({ refund_id: r.id, created_at: r.createdAt, ...mapRefundToCredit(r, invoiceLines ?? []) }));
  return {
    order: {
      id: o.id, name: o.name, created_at: o.createdAt, updated_at: o.updatedAt, cancelled_at: o.cancelledAt,
      cancel_reason: o.cancelReason, financial_status: o.financialStatus, currency: o.currency, total: o.total,
      email: o.email, test: o.test,
    },
    decision, via,
    customer: customerFromOrder(o),
    sale,
    // Correspondance ligne Shopify ↔ variante, pour relier après coup (« à relier »).
    items: o.lines.filter((l) => l.quantity > 0).map((l) => ({ line_id: l.id, variant_id: l.variantId, sku: l.sku, title: l.title, quantity: l.quantity, article_id: links[l.variantId ?? '']?.articleId ?? null })),
    credits,
    // Remboursements à 0 € : pas d'avoir, commande signalée à vérifier (une seule fois).
    zero_refunds: zeroAmountRefunds(o.refunds).filter((r) => !applied.includes(r.id)).map((r) => r.id),
  };
}

async function processOrder(s: Settings, o: ShopOrder, via: string): Promise<{ order: string; status: string; detail?: string }> {
  // Commande passée avant l'activation : traitée hors DMS, on n'y touche pas.
  if (!s.enabled_at || o.createdAt < s.enabled_at) return { order: o.name, status: 'before_activation' };
  try {
    const payload = await buildPayload(s.company_id, o, via);
    const res = await rpc<{ status: string }>('_shopify_order_apply', { _company: s.company_id, _payload: payload });
    return { order: o.name, status: res?.status ?? 'ok' };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    await rpc('_shopify_order_mark_error', {
      _company: s.company_id, _order_id: o.id, _order_name: o.name, _created_at: o.createdAt || null,
      _total: o.total, _email: o.email, _via: via, _message: msg,
    }).catch(() => null);
    return { order: o.name, status: 'erreur', detail: msg };
  }
}

async function enabledSettings(): Promise<Settings[]> {
  return rows<Settings>('shopify_order_settings?select=company_id,import_enabled,enabled_at,last_catchup_at&import_enabled=is.true');
}

/** Rattrapage : commandes modifiées depuis la dernière lecture (marge de 10 min), au plus 3 jours. */
async function catchUp(s: Settings, started: number) {
  const floor = Date.now() - 3 * 24 * 3600_000;
  const last = s.last_catchup_at ? Date.parse(s.last_catchup_at) - 10 * 60_000 : 0;
  const en = s.enabled_at ? Date.parse(s.enabled_at) : Date.now();
  const since = new Date(Math.max(floor, last, en)).toISOString();
  const runAt = new Date().toISOString();
  const orders = await fetchRecentOrders(since);
  const results = [];
  let complete = true;
  for (const o of orders) {
    if (Date.now() - started > TIME_BUDGET_MS) { complete = false; break; }
    results.push(await processOrder(s, o, 'rattrapage'));
  }
  if (complete) await rpc('_shopify_orders_catchup_done', { _company: s.company_id, _at: runAt, _stats: { read: orders.length, since } });
  return { company_id: s.company_id, since, read: orders.length, complete, results };
}

// ---------------------------------------------------------------- Point d'entrée

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const missing = [!SHOP && 'SHOPIFY_STORE_DOMAIN', !CLIENT_ID && 'SHOPIFY_CLIENT_ID', !CLIENT_SECRET && 'SHOPIFY_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) return J({ ok: false, error: 'not_configured', missing }, 501);
  const started = Date.now();

  // 1. Webhook Shopify
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  if (hmac) {
    const raw = new Uint8Array(await req.arrayBuffer());
    if (!(await verifyShopifyHmac(raw, hmac, CLIENT_SECRET))) return J({ error: 'bad_signature' }, 401);
    const shop = (req.headers.get('x-shopify-shop-domain') ?? '').toLowerCase();
    if (shop !== SHOP!.toLowerCase()) return J({ error: 'unknown_shop' }, 401);
    const topic = (req.headers.get('x-shopify-topic') ?? '').toLowerCase();
    if (!TOPICS.has(topic)) return J({ ok: true, ignored: topic });
    const body = JSON.parse(new TextDecoder().decode(raw) || '{}');
    const gid = orderGidFrom(topic === 'refunds/create' ? body?.order_id : (body?.admin_graphql_api_id ?? body?.id));
    if (!gid) return J({ ok: true, ignored: 'no_order_id' });
    const settings = await enabledSettings();
    if (settings.length === 0) return J({ ok: true, ignored: 'import_stopped' }); // réglage Arrêté
    const o = await fetchOrder(gid);
    if (!o) return J({ ok: true, ignored: 'order_not_found' });
    const results = [];
    for (const s of settings) results.push(await processOrder(s, o, `webhook:${topic}`));
    // Toujours 200 une fois la signature valide : une erreur est enregistrée (statut « erreur »,
    // bouton Réessayer) et le rattrapage repassera ; inutile que Shopify réessaie en boucle.
    return J({ ok: true, results });
  }

  // 2. et 3. pg_cron ou écran
  const caller = await identify(req);
  if (!caller) return J({ error: 'not_signed_in' }, 401);
  const body = await req.json().catch(() => ({}));

  try {
    if (caller.kind !== 'user' && !body?.action) {
      const out = [];
      for (const s of await enabledSettings()) out.push(await catchUp(s, started));
      return J({ ok: true, companies: out });
    }

    const companyId = body?.company_id;
    if (!isUuid(companyId)) return J({ error: 'company_id_required' }, 400);
    const isAdmin = caller.kind !== 'user' || await hasRole(caller.id, companyId, ['admin']);
    const isSeller = isAdmin || (caller.kind === 'user' && await hasRole(caller.id, companyId, ['vendeur']));
    const s = (await rows<Settings>(`shopify_order_settings?select=company_id,import_enabled,enabled_at,last_catchup_at&company_id=eq.${companyId}&limit=1`).catch(() => [] as Settings[]))[0]
      ?? { company_id: companyId, import_enabled: false, enabled_at: null, last_catchup_at: null };

    if (body?.action === 'preview') {
      // Aperçu du mappage des commandes récentes : RIEN n'est écrit.
      if (!isAdmin) return J({ error: 'forbidden' }, 403);
      const limit = Math.min(Math.max(Number(body?.limit) || 5, 1), 20);
      const since = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
      const d: any = await gql(`query P($n: Int!, $q: String!) { orders(first: $n, reverse: true, sortKey: CREATED_AT, query: $q) { nodes { ${ORDER_FIELDS} } } }`, { n: limit, q: `created_at:>='${since}'` });
      const out = [];
      for (const n of d?.orders?.nodes ?? []) {
        const o = normalizeGraphqlOrder(n);
        const links = await linksFor(companyId, o.lines.map((l) => l.variantId ?? ''));
        const sale = mapOrderToSale(o, links);
        out.push({
          name: o.name, created_at: o.createdAt, financial_status: o.financialStatus, cancelled: !!o.cancelledAt,
          test: o.test, taxes_included: o.taxesIncluded, total: o.total, has_email: !!o.email, has_customer: !!o.customer,
          decision: importDecision(o), gateways: [...new Set(o.transactions.map((t) => t.gateway))],
          refunds: o.refunds.map((r) => ({ amount: r.amount, lines: r.lines.length, restock: r.lines.filter((l) => l.restock).length })),
          lines: sale.lines.map((l) => ({ kind: l.kind, linked: !!l.articleId, ref: l.reference, q: l.quantity, vat: l.vatRate, disc: l.discountPct, ht: l.lineHt, ttc: l.lineTtc })),
          total_ht: sale.totalHt, total_ttc: sale.totalTtc, forced: sale.forcedTtc, unlinked: sale.unlinked,
          payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount })), warnings: sale.warnings,
        });
      }
      return J({ ok: true, import_enabled: s.import_enabled, orders: out });
    }

    if (body?.action === 'retry') {
      if (!isSeller) return J({ error: 'forbidden' }, 403);
      if (!s.import_enabled) return J({ ok: false, error: 'import_stopped' }, 409);
      const gid = orderGidFrom(body?.order_id);
      if (!gid) return J({ error: 'order_id_required' }, 400);
      const o = await fetchOrder(gid);
      if (!o) return J({ ok: false, error: 'order_not_found' }, 404);
      return J({ ok: true, result: await processOrder(s, o, 'manuel') });
    }

    if (body?.action === 'sync') {
      if (!isAdmin) return J({ error: 'forbidden' }, 403);
      if (!s.import_enabled) return J({ ok: false, error: 'import_stopped' }, 409);
      return J({ ok: true, ...(await catchUp(s, started)) });
    }
    return J({ error: 'unknown_action' }, 400);
  } catch (e) {
    return J({ ok: false, error: 'failed', detail: String((e as Error)?.message ?? e).slice(0, 400) }, 502);
  }
});
