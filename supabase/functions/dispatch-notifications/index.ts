// M10 — Edge Function : dispatch de la file de notifications (e-mail via Resend,
// SMS via un fournisseur générique). Lit les notifications 'pending' (service role),
// envoie si les clés sont posées, sinon marque 'skipped' (dégradé propre).
//
// Secrets (optionnels) : RESEND_API_KEY, NOTIFY_FROM (e-mail expéditeur vérifié),
//                        SMS_API_URL, SMS_API_KEY, SMS_FROM.
// Appelée par pg_cron (toutes les 10 min) via pg_net. verify_jwt=false.
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RESEND = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('NOTIFY_FROM') || 'onboarding@resend.dev';
const SMS_URL = Deno.env.get('SMS_API_URL');
const SMS_KEY = Deno.env.get('SMS_API_KEY');
const SMS_FROM = Deno.env.get('SMS_FROM') || 'Ducati';

async function db(path: string, init: RequestInit) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
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

async function sendSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!SMS_URL || !SMS_KEY) return { ok: false, error: 'skipped' };
  const res = await fetch(SMS_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${SMS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: SMS_FROM, to, message: body }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `sms_${res.status}` };
}

Deno.serve(async (_req: Request) => {
  // Récupère un lot de notifications en attente.
  const res = await db('notifications?status=eq.pending&order=scheduled_at&limit=50', { method: 'GET' });
  const pending = await res.json();
  let sent = 0, skipped = 0, failed = 0;

  for (const n of pending as Array<Record<string, unknown>>) {
    const r = n.channel === 'sms'
      ? await sendSms(String(n.to_address), String(n.body ?? ''))
      : await sendEmail(String(n.to_address), String(n.subject ?? ''), String(n.body ?? ''));
    const status = r.ok ? 'sent' : (r.error === 'skipped' ? 'skipped' : 'failed');
    if (status === 'sent') sent++; else if (status === 'skipped') skipped++; else failed++;
    await db(`notifications?id=eq.${n.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status, error: r.error ?? null, sent_at: r.ok ? new Date().toISOString() : null }),
    });
  }
  return new Response(JSON.stringify({ processed: (pending as unknown[]).length, sent, skipped, failed }), { headers: { 'Content-Type': 'application/json' } });
});
