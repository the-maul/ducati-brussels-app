// Mission 03 — Accès réseau à l'Admin GraphQL de Shopify (jeton client credentials, limites de coût).
// Secrets lus dans l'environnement de la fonction serveur, jamais renvoyés.
// deno-lint-ignore-file
import { SHOPIFY_API_VERSION, throttleWaitMs } from './shopify-push.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

const SHOP = Deno.env.get('SHOPIFY_STORE_DOMAIN');
const CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function shopifyMissingSecrets(): string[] {
  return [!SHOP && 'SHOPIFY_STORE_DOMAIN', !CLIENT_ID && 'SHOPIFY_CLIENT_ID', !CLIENT_SECRET && 'SHOPIFY_CLIENT_SECRET'].filter(Boolean) as string[];
}

export async function shopifyToken(): Promise<string> {
  const tr = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID!, client_secret: CLIENT_SECRET! }).toString(),
  });
  if (!tr.ok) throw new Error(`token_failed ${tr.status}`);
  return (await tr.json()).access_token as string;
}

export type GqlResult = { data: any; errors: any[] | null; cost: any };

/**
 * Une requête GraphQL avec respect des limites : nouvel essai si 429/5xx ou THROTTLED,
 * puis pause si le seau de coût est trop bas pour la requête suivante (nextCost).
 */
export async function gql(token: string, query: string, variables: Record<string, unknown>, nextCost = 100): Promise<GqlResult> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://${SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    const g = await r.json().catch(() => null);
    const cost = g?.extensions?.cost;
    const throttled = Array.isArray(g?.errors) && g.errors.some((e: any) => e?.extensions?.code === 'THROTTLED');
    if (throttled) {
      const st = cost?.throttleStatus;
      const need = (cost?.requestedQueryCost ?? 200) - (st?.currentlyAvailable ?? 0);
      await sleep(Math.max(1000, Math.ceil((need / Math.max(st?.restoreRate ?? 50, 1)) * 1000)));
      continue;
    }
    if (!r.ok) throw new Error(`graphql ${r.status}: ${JSON.stringify(g?.errors ?? '').slice(0, 300)}`);
    const wait = throttleWaitMs(cost, nextCost);
    if (wait > 0) await sleep(Math.min(wait, 20_000));
    return { data: g?.data ?? null, errors: Array.isArray(g?.errors) && g.errors.length ? g.errors : null, cost };
  }
  throw new Error('throttled: Shopify limite les appels, nouvel essai au prochain passage');
}
