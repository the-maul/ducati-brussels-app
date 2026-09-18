// Mission 03 — Vérifier que le DMS parle bien à la boutique Shopify.
//
// Obtient un jeton par « client credentials grant » (valable 24 h) avec les secrets
// SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, puis lit le nom de la
// boutique, les droits accordés, le nombre de produits et les emplacements de stock.
// Ne modifie rien. Ne renvoie jamais un secret ni le jeton.
//
// Appelable par la clé de service ou par un membre actif de l'équipe.
// deno-lint-ignore-file
import { identify, activeCompaniesOf } from '../_shared/acces.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SHOP = Deno.env.get('SHOPIFY_STORE_DOMAIN');
const CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET');
const API_VERSION = '2026-07';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const caller = await identify(req);
  if (!caller) return J({ error: 'not_signed_in' }, 401);
  if (caller.kind === 'user' && (await activeCompaniesOf(caller.id)).length === 0) return J({ error: 'forbidden' }, 403);

  const missing = [!SHOP && 'SHOPIFY_STORE_DOMAIN', !CLIENT_ID && 'SHOPIFY_CLIENT_ID', !CLIENT_SECRET && 'SHOPIFY_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) return J({ ok: false, error: 'not_configured', missing }, 501);

  const tr = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID!, client_secret: CLIENT_SECRET! }).toString(),
  });
  if (!tr.ok) return J({ ok: false, error: 'token_failed', status: tr.status, detail: (await tr.text()).slice(0, 300) }, 502);
  const t = await tr.json();

  const q = `{ shop { name myshopifyDomain currencyCode } productsCount { count } locations(first: 20) { nodes { name isActive } } }`;
  const gr = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t.access_token },
    body: JSON.stringify({ query: q }),
  });
  const g = await gr.json().catch(() => null);
  return J({
    ok: gr.ok && !g?.errors,
    scopes: t.scope,
    shop: g?.data?.shop ?? null,
    products: g?.data?.productsCount?.count ?? null,
    locations: g?.data?.locations?.nodes ?? null,
    errors: g?.errors ?? null,
  });
});
