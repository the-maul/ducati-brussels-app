// M0 — Edge Function : « Mise en production » (Paramètres, administrateurs, 19/11/2026).
//
// Dit, pour la fenêtre de mise en production, si chaque secret du serveur est POSÉ (oui / non) :
// Microsoft Graph (mails Outlook), Brevo (SMS), Shopify, Claude (classification et résumé des mails),
// Stripe, secret des tâches pg_cron, Resend (retiré, affiché pour mémoire). La VALEUR d'un secret
// n'est jamais lue au-delà de « vide ou non », jamais renvoyée, jamais enregistrée.
// Le résultat est noté en base (public.integration_status_record, clé de service) : la fonction SQL
// production_apply refuse de démarrer un élément dont le secret manque.
//
// Accès : utilisateur connecté, ADMINISTRATEUR de la société demandée ({ companyId }).
// Rien n'est envoyé, rien d'autre n'est écrit.
// Déploiement : npx supabase@2.117.0 functions deploy production-status --project-ref ujmrosbgkvgvwfnuryna
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { identify, isUuid } from '../_shared/acces.ts';

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const has = (...keys: string[]) => keys.every((k) => (Deno.env.get(k) ?? '').trim() !== '');

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const caller = await identify(req);
  if (!caller || caller.kind !== 'user') return J({ error: 'forbidden' }, 403);
  const body = await req.json().catch(() => ({})) as { companyId?: unknown };
  const companyId = isUuid(body.companyId) ? body.companyId : null;
  if (!companyId) return J({ error: 'missing_params' }, 400);

  // Administrateur actif de la société (même règle que public.is_admin).
  const roles = await (await db(`user_roles?select=role&user_id=eq.${caller.id}&company_id=eq.${companyId}&role=eq.admin&limit=1`)).json().catch(() => []);
  const prof = await (await db(`profiles?select=is_active&id=eq.${caller.id}&limit=1`)).json().catch(() => []);
  if (!Array.isArray(roles) || roles.length === 0 || (Array.isArray(prof) && prof[0]?.is_active === false)) {
    return J({ error: 'not_admin' }, 403);
  }

  const cron = (Deno.env.get('CRON_SECRET') ?? '').length >= 32;
  const integrations = {
    graph: has('MS_GRAPH_TENANT_ID', 'MS_GRAPH_CLIENT_ID', 'MS_GRAPH_CLIENT_SECRET'),
    brevo: has('BREVO_API_KEY'),
    shopify: has('SHOPIFY_STORE_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'),
    anthropic: has('ANTHROPIC_API_KEY'),
    stripe: has('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'),
    cron,
    resend: has('RESEND_API_KEY'),
  };
  const rec = await db('rpc/integration_status_record', { method: 'POST', body: JSON.stringify({ _company: companyId, _status: integrations }) });
  return J({ ok: true, integrations, recorded: rec.ok });
});
