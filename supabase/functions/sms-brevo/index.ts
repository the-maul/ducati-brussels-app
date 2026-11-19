// SMS par Brevo (18/11/2026) — Parametres → SMS : etat de la connexion et SMS de test.
// verify_jwt=false : l'appelant est verifie ici (utilisateur connecte, membre actif de la societe).
//
// Actions (corps JSON) :
//   { action: 'status', company_id }  -> cle posee ou non (JAMAIS la cle), expediteur par defaut,
//                                        solde SMS du compte Brevo (GET /v3/account, lecture seule).
//   { action: 'test', company_id, to, body }
//                                     -> administrateur ; public.sms_test_prepare (numero saisi a
//                                        l'ecran, societe de test refusee, 5 par heure) puis envoi
//                                        Brevo et public.sms_dispatch_result (trace dans la file).
// Secrets : BREVO_API_KEY, BREVO_SMS_SENDER (facultatif, defaut DucatiBXL).
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { identify, isActiveMember, isUuid } from '../_shared/acces.ts';
import { BREVO_BASE, DEFAULT_SENDER, isValidSender, resolveSender, sendBrevoSms, smsCredits } from '../_shared/brevo-sms.ts';

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON = Deno.env.get('SUPABASE_ANON_KEY');
const BREVO_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_SENDER = Deno.env.get('BREVO_SMS_SENDER');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Appel RPC avec le jeton de l'utilisateur (auth.uid() = lui, droits verifies en base). */
async function rpcAsUser<T>(auth: string, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON || SVC!, Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) {
    let m = '';
    try { m = String(JSON.parse(t)?.message ?? ''); } catch { /* corps illisible */ }
    return { ok: false, error: /^SMS_[A-Z_]+$/.test(m) ? m : 'rpc_error' };
  }
  return { ok: true, data: (t ? JSON.parse(t) : null) as T };
}

async function rpcService(fn: string, args: Record<string, unknown>) {
  await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
}

async function brevoAccount(): Promise<{ credits: number | null; error: string | null }> {
  if (!BREVO_KEY) return { credits: null, error: null };
  try {
    const r = await fetch(`${BREVO_BASE}/account`, { headers: { 'api-key': BREVO_KEY, accept: 'application/json' } });
    if (!r.ok) return { credits: null, error: `brevo_${r.status}` };
    return { credits: smsCredits(await r.json()), error: null };
  } catch {
    return { credits: null, error: 'brevo_network' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const caller = await identify(req);
  if (!caller || caller.kind !== 'user') return J({ error: 'forbidden' }, 403);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const companyId = String(body.company_id ?? '');
  if (!isUuid(companyId) || !(await isActiveMember(caller.id, companyId))) return J({ error: 'forbidden' }, 403);
  const auth = req.headers.get('Authorization') ?? '';

  if (body.action === 'status') {
    const acct = await brevoAccount();
    return J({
      ok: true,
      configured: !!BREVO_KEY,
      default_sender: isValidSender(BREVO_SENDER) ? BREVO_SENDER : DEFAULT_SENDER,
      env_sender_invalid: !!BREVO_SENDER && !isValidSender(BREVO_SENDER),
      credits: acct.credits,
      account_error: acct.error,
    });
  }

  if (body.action === 'test') {
    const prep = await rpcAsUser<Array<{ id: number; to_address: string; body: string; sender: string | null }>>(
      auth, 'sms_test_prepare', { _company: companyId, _to: String(body.to ?? ''), _body: String(body.body ?? '') });
    if (!prep.ok) return J({ ok: false, error: prep.error }, 400);
    const row = prep.data?.[0];
    if (!row) return J({ ok: false, error: 'SMS_TEST_COMPANY' }, 400);
    const r = await sendBrevoSms({
      apiKey: BREVO_KEY, sender: resolveSender(row.sender, BREVO_SENDER), to: row.to_address, content: row.body,
      tag: 'sms_test', fetchImpl: fetch as never,
    });
    await rpcService('sms_dispatch_result', {
      _id: row.id, _status: r.status, _error: r.status === 'sent' ? null : r.error, _provider_id: r.status === 'sent' ? r.messageId : null,
    });
    if (r.status === 'sent') return J({ ok: true, id: row.id, to: row.to_address });
    return J({ ok: false, id: row.id, error: r.error, status: r.status });
  }

  return J({ error: 'action' }, 400);
});
