// M10 — Edge Function : dispatch de la file de notifications (e-mail via Resend, SMS via Brevo).
// Appelee par pg_cron (toutes les 10 min) via pg_net. verify_jwt=false.
//
// E-MAIL (inchange) : notifications 'pending' arrivees a echeance ; envoi si RESEND_API_KEY est posee,
// sinon 'skipped'. Secrets : RESEND_API_KEY, NOTIFY_FROM.
//
// SMS (lot SMS Brevo, 18/11/2026) : la base choisit ce qui part (public.sms_dispatch_claim : societe
// de test, mode arrete / test / actif, refus SMS, RDV deplace, OR revenu en arriere -> 'skipped' avec
// la raison), la fonction envoie par Brevo puis rend le resultat (public.sms_dispatch_result).
// Secrets : BREVO_API_KEY (absente : chaque SMS pris en charge finit 'skipped / no_api_key', aucune
// erreur), BREVO_SMS_SENDER (facultatif, defaut DucatiBXL ; l'expediteur de la societe passe avant).
// L'ancien « fournisseur generique » (secrets SMS_API_*) est remplace : un seul systeme.
//
// ACCÈS (lot sécurité S, 19/09) : pg_cron (en-tête x-cron-secret = secret CRON_SECRET) ou clé
// de service. Avant : déclenchable par n'importe qui avec la clé publique.
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { identify } from '../_shared/acces.ts';
import { resolveSender, sendBrevoSms } from '../_shared/brevo-sms.ts';
import { testCompanyIds } from '../_shared/test-company.ts';

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RESEND = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('NOTIFY_FROM') || 'onboarding@resend.dev';
const BREVO_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_SENDER = Deno.env.get('BREVO_SMS_SENDER');

async function db(path: string, init: RequestInit) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

async function sendEmail(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND) return { ok: false, error: 'skipped' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject: subject || '(sans objet)', html: `<p>${(body || '').replace(/\n/g, '<br>')}</p>` }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `resend_${res.status}: ${(await res.text()).slice(0, 200)}` };
}

type Claimed = { id: number; company_id: string; send_to: string; body: string; sender: string | null; is_test: boolean; template: string | null };

async function dispatchSms(tests: Set<string>): Promise<{ sms_sent: number; sms_skipped: number; sms_failed: number; sms_error?: string }> {
  let sent = 0, skipped = 0, failed = 0;
  let batch: Claimed[] = [];
  try {
    batch = (await rpc<Claimed[]>('sms_dispatch_claim', { _limit: 50 })) ?? [];
  } catch (e) {
    // Migration du lot SMS pas encore appliquee : on ne touche a rien.
    return { sms_sent: 0, sms_skipped: 0, sms_failed: 0, sms_error: String((e as Error).message).slice(0, 200) };
  }
  for (const n of batch) {
    // SOCIETE DE TEST (lot ItalTest) : filet de securite, la base ne devrait jamais en remettre une.
    if (tests.has(String(n.company_id ?? ''))) {
      skipped++;
      await rpc('sms_dispatch_result', { _id: n.id, _status: 'skipped', _error: 'test_company', _provider_id: null }).catch(() => undefined);
      continue;
    }
    const r = await sendBrevoSms({
      apiKey: BREVO_KEY, sender: resolveSender(n.sender, BREVO_SENDER), to: n.send_to, content: n.body,
      tag: n.template || 'dms', fetchImpl: fetch as never,
    });
    if (r.status === 'sent') sent++; else if (r.status === 'skipped') skipped++; else failed++;
    await rpc('sms_dispatch_result', {
      _id: n.id, _status: r.status,
      _error: r.status === 'sent' ? null : r.error,
      _provider_id: r.status === 'sent' ? r.messageId : null,
    }).catch(() => { /* la prise en charge expirera en 'failed / stuck_sending' : jamais de second envoi */ });
  }
  return { sms_sent: sent, sms_skipped: skipped, sms_failed: failed };
}

Deno.serve(async (req: Request) => {
  const caller = await identify(req);
  if (!caller || caller.kind === 'user') {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  // E-mails en attente arrives a echeance (les SMS passent par sms_dispatch_claim).
  const now = new Date().toISOString();
  const res = await db(`notifications?status=eq.pending&channel=neq.sms&scheduled_at=lte.${encodeURIComponent(now)}&order=scheduled_at&limit=50`, { method: 'GET' });
  const pending = await res.json();
  let sent = 0, skipped = 0, failed = 0;
  // SOCIETE DE TEST (lot ItalTest, 19/11/2026) : ses notifications ne partent jamais (la base les enregistre deja
  // « skipped » ; filet de securite ici). Controle impossible : rien ne part ce passage-ci.
  let tests: Set<string>;
  try { tests = await testCompanyIds(); } catch {
    return new Response(JSON.stringify({ error: 'test_company_check_failed' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  for (const n of pending as Array<Record<string, unknown>>) {
    if (tests.has(String(n.company_id ?? ''))) {
      skipped++;
      await db(`notifications?id=eq.${n.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'skipped', error: 'test_company' }) });
      continue;
    }
    const r = await sendEmail(String(n.to_address), String(n.subject ?? ''), String(n.body ?? ''));
    const status = r.ok ? 'sent' : (r.error === 'skipped' ? 'skipped' : 'failed');
    if (status === 'sent') sent++; else if (status === 'skipped') skipped++; else failed++;
    await db(`notifications?id=eq.${n.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status, error: r.error ?? null, sent_at: r.ok ? new Date().toISOString() : null }),
    });
  }
  const sms = await dispatchSms(tests);
  return new Response(JSON.stringify({ processed: (pending as unknown[]).length, sent, skipped, failed, ...sms }), { headers: { 'Content-Type': 'application/json' } });
});
