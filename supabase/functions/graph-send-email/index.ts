// M10 — Edge Function : envoyer un e-mail DEPUIS la boîte Outlook de la société
// (Microsoft Graph /sendMail). Le mail est sauvé dans "Éléments envoyés" ; la relève
// (outlook-poll) le journalise ensuite sur la fiche du contact (sortant), sans doublon.
//
// Secrets : MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET
//   (app Azure, permission APPLICATION **Mail.Send** uniquement — pas d'écriture).
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
  const { companyId, to, subject, body, attachments } = await req.json();
  if (!companyId || !to || !subject) return J({ error: 'missing_params' }, 400);
  // Pièces jointes : [{ name, contentType, contentBytes(base64) }]
  const atts = Array.isArray(attachments) ? attachments.map((a: Record<string, string>) => ({
    '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType || 'application/octet-stream', contentBytes: a.contentBytes,
  })) : [];

  const co = await (await db(`companies?select=inbound_mailbox&id=eq.${companyId}`)).json();
  const mailbox = co?.[0]?.inbound_mailbox;
  if (!mailbox) return J({ error: 'no_mailbox' }, 400);
  const tok = await token();
  if (!tok) return J({ error: 'graph_auth_failed' }, 502);

  // Envoi simple (Mail.Send) — sauvegardé dans Éléments envoyés ; la relève le journalisera.
  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: String(body || '') }, // déjà du HTML (éditeur enrichi)
        toRecipients: [{ emailAddress: { address: to } }],
        ...(atts.length ? { attachments: atts } : {}),
      },
      saveToSentItems: true,
    }),
  });
  if (!sendRes.ok) return J({ error: 'send_failed', detail: (await sendRes.text()).slice(0, 200) }, 502);
  return J({ ok: true });
});
