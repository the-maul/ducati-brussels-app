// M10 — Edge Function : relève la boîte Outlook d'écoute (Microsoft Graph), journalise
// les mails entrants sur le contact correspondant et charge les PHOTOS jointes en GED.
// Appelée par pg_cron (toutes les 5 min). Dégradée proprement si les secrets manquent.
//
// Secrets requis : MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET
//   (app Azure avec permission APPLICATION Mail.Read). SUPABASE_URL / SERVICE_ROLE injectés.
// Config : companies.inbound_mailbox = adresse Outlook écoutée (Paramètres → Sociétés).
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = Deno.env.get('MS_GRAPH_TENANT_ID');
const CID = Deno.env.get('MS_GRAPH_CLIENT_ID');
const CSECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET');

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}
async function rpc(fn: string, body: unknown) {
  const r = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) return null;
  const txt = await r.text();            // certaines RPC renvoient void (corps vide)
  return txt ? JSON.parse(txt) : null;
}

async function graphToken(): Promise<string | null> {
  const form = new URLSearchParams({ client_id: CID!, client_secret: CSECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!res.ok) return null;
  return (await res.json()).access_token ?? null;
}
const G = (tok: string, path: string) => fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${tok}` } });

// upload un fichier (octets) en GED bucket privé + ligne attachments.
async function gedUpload(companyId: string, contactId: string, name: string, ctype: string, bytes: Uint8Array) {
  const safe = name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${companyId}/contact/${contactId}/${Date.now()}_${safe}`;
  const up = await fetch(`${URL}/storage/v1/object/ged/${path}`, { method: 'POST', headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': ctype, 'x-upsert': 'true' }, body: bytes });
  if (!up.ok) return;
  await db('attachments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ company_id: companyId, entity_type: 'contact', entity_id: contactId, file_name: name, storage_path: path, content_type: ctype, size_bytes: bytes.length, note: 'Pièce jointe e-mail (Outlook)' }) });
}

Deno.serve(async () => {
  if (!TENANT || !CID || !CSECRET) return new Response(JSON.stringify({ error: 'graph_not_configured' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
  const tok = await graphToken();
  if (!tok) return new Response(JSON.stringify({ error: 'graph_auth_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });

  let logged = 0, photos = 0, scanned = 0;
  const errors: string[] = [];
  try {
  const coRes = await db('companies?select=id,inbound_mailbox,inbound_last_check,sent_last_check&inbound_mailbox=not.is.null');
  const companies = await coRes.json();
  if (!Array.isArray(companies)) return new Response(JSON.stringify({ error: 'companies_query', detail: companies }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const addr = (o: unknown) => (((o as Record<string, unknown>)?.emailAddress as Record<string, unknown>)?.address as string) || '';

  // Relève d'un dossier (inbox ou sentitems). Pour 'in' on matche l'expéditeur ;
  // pour 'out' on matche le 1er destinataire. Charge aussi les images (sauf signatures).
  async function processFolder(coId: string, mailbox: string, folder: string, direction: 'in' | 'out', since: string): Promise<string> {
    const q = `/users/${encodeURIComponent(mailbox)}/mailFolders/${folder}/messages?$top=25&$orderby=${direction === 'in' ? 'receivedDateTime' : 'sentDateTime'}%20desc&$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,hasAttachments`;
    const res = await G(tok!, q);
    if (!res.ok) { errors.push(`${folder} ${mailbox}: ${res.status}`); return since; }
    const msgs = (await res.json()).value ?? [];
    let maxTs = since;
    for (const m of msgs as Array<Record<string, unknown>>) {
      try {
        const ts = (direction === 'in' ? m.receivedDateTime : (m.sentDateTime || m.receivedDateTime)) as string;
        if (ts <= since) continue;
        scanned++;
        if (ts > maxTs) maxTs = ts;
        const sender = addr(m.from);
        const recips = (m.toRecipients as unknown[] | undefined) ?? [];
        const matchEmail = direction === 'in' ? sender : (recips.length ? addr(recips[0]) : '');
        const displayFrom = direction === 'in' ? sender : mailbox;
        const ing = await rpc('ingest_email', { _company: coId, _direction: direction, _match_email: matchEmail, _display_from: displayFrom, _subject: m.subject ?? '', _body: m.bodyPreview ?? '', _received: ts, _external_id: m.id });
        const row = Array.isArray(ing) ? ing[0] : ing;
        if (!row?.matched || !row?.contact_id) continue;
        logged++;
        const at = await G(tok!, `/users/${encodeURIComponent(mailbox)}/messages/${m.id}/attachments`);
        if (at.ok) for (const a of ((await at.json()).value ?? []) as Array<Record<string, unknown>>) {
          const ctype = String(a.contentType || '');
          if (a['@odata.type'] === '#microsoft.graph.fileAttachment' && ctype.startsWith('image/') && a.contentBytes) {
            const bin = Uint8Array.from(atob(a.contentBytes as string), (c) => c.charCodeAt(0));
            if (a.isInline === true && bin.length < 30000) continue; // ignore signatures
            await gedUpload(coId, row.contact_id as string, String(a.name || 'photo'), ctype, bin);
            photos++;
          }
        }
      } catch (e) { errors.push(`msg ${m.id}: ${String(e).slice(0, 120)}`); }
    }
    return maxTs;
  }

  for (const co of companies as Array<Record<string, string>>) {
    const mailbox = co.inbound_mailbox;
    const day = new Date(Date.now() - 864e5).toISOString();
    const inSince = co.inbound_last_check || day;
    const sentSince = co.sent_last_check || day;
    const maxIn = await processFolder(co.id, mailbox, 'inbox', 'in', inSince);
    const maxSent = await processFolder(co.id, mailbox, 'sentitems', 'out', sentSince);
    await rpc('set_mail_cursors', { _company: co.id, _in: maxIn !== inSince ? maxIn : null, _sent: maxSent !== sentSince ? maxSent : null });
  }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'unhandled', detail: String(e).slice(0, 300), scanned, logged, photos, errors }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ scanned, logged, photos, errors }), { headers: { 'Content-Type': 'application/json' } });
});
