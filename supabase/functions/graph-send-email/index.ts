// M10 — Edge Function : envoyer un e-mail DEPUIS la boîte Outlook de la société
// (Microsoft Graph), et le journaliser instantanément sur la fiche du contact (sortant).
// Anti-doublon : on crée un brouillon (→ id), on journalise avec cet id, puis on envoie ;
// la relève Sent Items reconnaîtra ce même id (idempotence) et ne le re-créera pas.
//
// Secrets : MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET
//   (app Azure avec permissions APPLICATION Mail.ReadWrite + Mail.Send).
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = Deno.env.get('MS_GRAPH_TENANT_ID');
const CID = Deno.env.get('MS_GRAPH_CLIENT_ID');
const CSECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function token(): Promise<string | null> {
  const form = new URLSearchParams({ client_id: CID!, client_secret: CSECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  return r.ok ? (await r.json()).access_token : null;
}
async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!TENANT || !CID || !CSECRET) return J({ error: 'graph_not_configured' }, 501);
  const { companyId, contactId, to, subject, body } = await req.json();
  if (!companyId || !to || !subject) return J({ error: 'missing_params' }, 400);

  const co = await (await db(`companies?select=inbound_mailbox&id=eq.${companyId}`)).json();
  const mailbox = co?.[0]?.inbound_mailbox;
  if (!mailbox) return J({ error: 'no_mailbox' }, 400);
  const tok = await token();
  if (!tok) return J({ error: 'graph_auth_failed' }, 502);
  const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

  // 1) brouillon (récupère l'id pour l'anti-doublon)
  const draftRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ subject, body: { contentType: 'HTML', content: String(body || '').replace(/\n/g, '<br>') }, toRecipients: [{ emailAddress: { address: to } }] }),
  });
  if (!draftRes.ok) return J({ error: 'draft_failed', detail: (await draftRes.text()).slice(0, 200) }, 502);
  const draft = await draftRes.json();

  // 2) journalise tout de suite (sortant) avec l'id du message
  await db('rpc/ingest_email', { method: 'POST', body: JSON.stringify({ _company: companyId, _direction: 'out', _match_email: to, _display_from: mailbox, _subject: subject, _body: String(body || '').slice(0, 4000), _received: new Date().toISOString(), _external_id: draft.id }) });

  // 3) envoie le brouillon
  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${draft.id}/send`, { method: 'POST', headers: H });
  if (!sendRes.ok) return J({ error: 'send_failed', detail: (await sendRes.text()).slice(0, 200) }, 502);
  return J({ ok: true, message_id: draft.id });
});
