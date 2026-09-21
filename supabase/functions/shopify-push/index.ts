// Mission 03 — Le stock et le prix du DMS s'affichent en direct sur le site (W-4, W-7, W-8).
//
// Vide la file shopify_sync_queue par lots : pour chaque article RELIÉ et AUTORISÉ par le mode
// (réglage « Synchronisation Shopify » : arrêtée / essai / tous — contrôlé en SQL par _shopify_push_claim) :
//   1. lit l'état actuel des variantes sur Shopify (prix, article de stock, quantité à l'emplacement
//      « Chaussée de Bruxelles 688 ») ;
//   2. planPush (_shared/shopify-push.ts) : stock disponible (réel − réservé) et prix TTC du DMS ;
//      rien n'est écrit si Shopify est déjà à jour ;
//   3. écrit : productVariantsBulkUpdate (prix, 10 produits par requête), inventorySetQuantities
//      (quantités absolues, 100 par requête, @idempotent), inventoryActivate si besoin ;
//      pauses selon le coût de requête Shopify ;
//   4. _shopify_push_done : journal shopify_sync_log, file vidée ou nouvel essai plus tard.
//
// Corps : { company_id?, simulate?, article_ids? }
//   pg_cron (x-cron-secret) : sans corps → toutes les sociétés dont le mode n'est pas « arrêtée » ;
//   administrateur : { company_id } → traite la file maintenant ;
//   SIMULATION : { company_id, simulate: true, article_ids: [...] } → lit Shopify, renvoie le plan et
//   les mutations qui SERAIENT envoyées, n'écrit RIEN (ni sur Shopify, ni dans la file), quel que soit le mode.
// deno-lint-ignore-file
import { identify, activeCompaniesOf, isUuid } from '../_shared/acces.ts';
import {
  LOCATIONS_QUERY, VARIANT_STATE_QUERY, pickLocation, parseVariantStates, planPush, chunk,
  buildPriceMutation, buildInventoryMutation, buildActivateMutation, type PushTarget, type PlannedResult,
} from '../_shared/shopify-push.ts';
import { shopifyMissingSecrets, shopifyToken, gql } from '../_shared/shopify-client.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SB_URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BATCH = 50;                 // articles par lot (lecture nodes ≈ 50 × 4 points)
const PRICE_GROUP = 10;           // produits par requête productVariantsBulkUpdate
const QTY_GROUP = 100;            // quantités par inventorySetQuantities
const TIME_BUDGET_MS = 100_000;

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

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 400);
const userErrText = (ue: any[]) => ue.map((u) => `${(u.field ?? []).join('.')}: ${u.message}`).join(' ; ').slice(0, 400);

/** Écrit un plan sur Shopify ; renvoie les résultats définitifs (ok / erreur / déjà à jour). */
async function execute(token: string, plan: ReturnType<typeof planPush>): Promise<PlannedResult[]> {
  const results = plan.results.map((r) => ({ ...r }));
  const fail = (pred: (r: PlannedResult) => boolean, msg: string) => {
    for (const r of results) if (pred(r) && r.status !== 'erreur') { r.status = 'erreur'; r.detail = msg; }
  };
  for (const a of plan.activations) {
    try {
      const m = buildActivateMutation(a, crypto.randomUUID());
      const g = await gql(token, m.query, m.variables, 50);
      const ue = g.data?.inventoryActivate?.userErrors ?? [];
      if (g.errors || ue.length) throw new Error(g.errors ? JSON.stringify(g.errors).slice(0, 300) : userErrText(ue));
    } catch (e) {
      fail((r) => r.inventory_item_id === a.inventoryItemId, `stock : ${errText(e)}`);
    }
  }

  for (const group of chunk(plan.priceUpdates, PRICE_GROUP)) {
    try {
      const m = buildPriceMutation(group);
      const g = await gql(token, m.query, m.variables, 100);
      if (g.errors) throw new Error(JSON.stringify(g.errors).slice(0, 300));
      group.forEach((p, i) => {
        const ue = g.data?.[`u${i}`]?.userErrors ?? [];
        if (ue.length) fail((r) => r.product_id === p.productId && r.write_price, `prix : ${userErrText(ue)}`);
      });
    } catch (e) {
      const ids = new Set(group.map((p) => p.productId));
      fail((r) => ids.has(r.product_id) && r.write_price, `prix : ${errText(e)}`);
    }
  }

  for (const group of chunk(plan.quantities, QTY_GROUP)) {
    const items = new Set(group.map((q) => q.inventoryItemId));
    try {
      const m = buildInventoryMutation(group, crypto.randomUUID());
      const g = await gql(token, m.query, m.variables, 100);
      const ue = g.data?.inventorySetQuantities?.userErrors ?? [];
      if (g.errors || ue.length) throw new Error(g.errors ? JSON.stringify(g.errors).slice(0, 300) : userErrText(ue));
    } catch (e) {
      // on ne sait pas quelle ligne a échoué : tout le groupe repassera au prochain essai
      fail((r) => r.write_qty && r.inventory_item_id != null && items.has(r.inventory_item_id), `stock : ${errText(e)}`);
    }
  }
  return results.map((r): PlannedResult => (r.status === 'a_envoyer' ? { ...r, status: 'ok' } : r));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const caller = await identify(req);
  if (!caller) return J({ error: 'not_signed_in' }, 401);

  const body = await req.json().catch(() => ({}));
  const simulate = body?.simulate === true;
  const actor = caller.kind === 'user' ? caller.id : null;
  let companies: string[];
  if (caller.kind === 'user') {
    if (!isUuid(body?.company_id)) return J({ error: 'company_id_required' }, 400);
    if (!(await isAdminOf(caller.id, body.company_id))) return J({ error: 'forbidden' }, 403);
    companies = [body.company_id];
  } else if (isUuid(body?.company_id)) {
    companies = [body.company_id];
  } else {
    if (simulate) return J({ error: 'company_id_required' }, 400);
    companies = await rpc<string[]>('_shopify_push_companies', {});
  }
  const articleIds: string[] = Array.isArray(body?.article_ids) ? body.article_ids.filter(isUuid).slice(0, BATCH) : [];
  if (simulate && articleIds.length === 0) return J({ error: 'article_ids_required' }, 400);
  if (!companies.length) return J({ ok: true, companies: 0, message: 'rien à envoyer (synchronisation arrêtée ou file vide)' });

  const missing = shopifyMissingSecrets();
  if (missing.length) return J({ ok: false, error: 'not_configured', missing }, 501);

  const started = Date.now();
  const report: Record<string, unknown>[] = [];
  let token: string | null = null;
  let locationId: string | null = null;

  for (const companyId of companies) {
    const tot = { claimed: 0, ok: 0, up_to_date: 0, errors: 0 };
    try {
      for (;;) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        const targets = await rpc<PushTarget[]>('_shopify_push_claim', {
          _company: companyId, _limit: BATCH, _articles: simulate ? articleIds : null,
        });
        if (!targets.length) break;
        tot.claimed += targets.length;

        let results: PlannedResult[];
        try {
          if (!token) token = await shopifyToken();
          if (!locationId) {
            const lg = await gql(token, LOCATIONS_QUERY, {}, 50);
            locationId = pickLocation(lg.data?.locations?.nodes ?? []);
            if (!locationId) throw new Error('emplacement « Chaussée de Bruxelles 688 » introuvable sur Shopify');
          }
          const ids = [...new Set(targets.map((t) => t.shopify_variant_id))];
          const sg = await gql(token, VARIANT_STATE_QUERY, { ids, location: locationId }, 200);
          if (sg.errors) throw new Error(JSON.stringify(sg.errors).slice(0, 300));
          const plan = planPush(targets, parseVariantStates(sg.data?.nodes ?? []), locationId);

          if (simulate) {
            // RIEN n'est écrit : on renvoie ce qui serait envoyé.
            return J({
              ok: true, simulate: true, location_id: locationId,
              results: plan.results,
              mutations: {
                prices: chunk(plan.priceUpdates, PRICE_GROUP).map((g) => buildPriceMutation(g)),
                stock: chunk(plan.quantities, QTY_GROUP).map((g) => buildInventoryMutation(g, '(clé générée à l’envoi)')),
                activations: plan.activations.map((a) => buildActivateMutation(a, '(clé générée à l’envoi)')),
              },
            });
          }
          results = await execute(token, plan);
        } catch (e) {
          if (simulate) return J({ ok: false, simulate: true, error: errText(e) }, 502);
          results = targets.map((t) => ({
            queue_id: t.queue_id, article_id: t.article_id, reference: t.reference,
            product_id: t.shopify_product_id, variant_id: t.shopify_variant_id,
            status: 'erreur' as const, price_before: null, price_sent: null, qty_before: null, qty_sent: null,
            detail: errText(e), requested_at: t.requested_at, write_price: false, write_qty: false, inventory_item_id: null,
          }));
        }

        await rpc('_shopify_push_done', { _company: companyId, _results: results, _actor: actor });
        for (const r of results) {
          if (r.status === 'erreur') tot.errors++;
          else if (r.status === 'deja_a_jour') tot.up_to_date++;
          else tot.ok++;
        }
        if (tot.errors > 0 && tot.ok === 0 && tot.up_to_date === 0) break;   // Shopify indisponible : on réessaiera
      }
    } catch (e) {
      report.push({ company_id: companyId, ...tot, error: errText(e) });
      continue;
    }
    report.push({ company_id: companyId, ...tot });
  }
  return J({ ok: true, done: Date.now() - started <= TIME_BUDGET_MS, companies: report });
});
