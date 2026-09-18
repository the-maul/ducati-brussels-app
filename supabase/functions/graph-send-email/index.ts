// M10 — Edge Function : envoyer un e-mail depuis une boîte Outlook de la concession
// (Microsoft Graph /sendMail). Le mail est sauvé dans « Éléments envoyés ».
//
// QUI PEUT ENVOYER : un utilisateur connecté, membre de la société. Auparavant la
// fonction ne vérifiait que la présence d'un jeton, et la clé publique du site en
// est un : n'importe qui pouvait envoyer au nom de la concession.
//
// DEPUIS QUELLE ADRESSE (retour client du 18/09) :
//   - une des boîtes partagées de la société (shop@, occasions@, info@…) ;
//   - OU l'adresse personnelle de l'utilisateur connecté (simon@, domenico@…),
//     à condition qu'elle soit du même domaine que les boîtes de la société.
//   On ne part JAMAIS d'une adresse arbitraire fournie par le navigateur.
//
// TRACE DANS LA CARTE : un envoi depuis une boîte partagée est retrouvé par la
// relève (outlook-poll), qui lit ses « Éléments envoyés ». Une adresse personnelle
// n'est pas relevée : on enregistre donc l'échange ici même, sinon il n'apparaîtrait
// jamais dans la carte.
//
// PIED DE MAIL (décisions client P-5 du 18/09 et P-6 du 19/09) : sous le message,
// une invitation sobre à rejoindre l'application. Deux variantes :
//   - destinataire SANS compte : texte P-5 + lien « Créer mon compte » vers
//     <origine>/inscription?email=… ;
//   - destinataire AVEC un compte client mais JAMAIS venu sur son espace
//     (contact_accounts.first_portal_visit_at vide, rempli par portal_touch() à
//     l'ouverture de /mon-espace) : « Votre espace Ducati Bruxelles est prêt… » +
//     lien « Me connecter » vers <origine>/login.
// Pas de pied de mail : client déjà venu sur son espace, compte de l'équipe (sans
// fiche client), compte désactivé, plusieurs destinataires, adresse de la
// concession, origine invalide, ou doute (erreur de lecture). L'origine (adresse
// de l'application client) est transmise par l'appelant (`origin`).
// Secrets : MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET
//   (app Azure, permission APPLICATION Mail.Send).
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

/** L'utilisateur derrière le jeton, ou null (clé publique, jeton expiré…). */
async function caller(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SVC!, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? { id: u.id, email: String(u.email ?? '').toLowerCase() } : null;
}

const domainOf = (a: string) => a.split('@')[1]?.toLowerCase() ?? '';
const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

type FooterKind = 'join' | 'login' | null;

const FOOTER_STYLE = 'margin-top:24px;padding-top:12px;border-top:1px solid #d9d9d9;font-size:13px;line-height:18px;color:#5c5c5c';

/** Pied de mail P-5 / P-6, sous le message. Textes validés par le client (18/09, 19/09). */
function footerHtml(kind: 'join' | 'login', origin: string, to: string): string {
  const join = kind === 'join';
  const link = join ? `${origin}/inscription?email=${encodeURIComponent(to)}` : `${origin}/login`;
  const text = join
    ? 'Retrouvez facilement la vie de votre moto (photos, entretiens, pièces, documents) et bénéficiez de bonus de fidélité en rejoignant notre communauté de clients sur l’application Ducati Bruxelles.'
    : 'Votre espace Ducati Bruxelles est prêt : retrouvez la vie de votre moto (photos, entretiens, pièces, documents) et vos bonus de fidélité.';
  const label = join ? 'Créer mon compte' : 'Me connecter';
  return `
<div style="${FOOTER_STYLE}">
  <p style="margin:0 0 6px 0">${esc(text)}</p>
  <p style="margin:0"><a href="${esc(link)}" style="color:#c8102e">${label}</a></p>
</div>`;
}

/**
 * Quel pied de mail pour cette adresse ?
 *   'join'  : aucun compte ;
 *   'login' : compte client actif, jamais venu sur son espace ;
 *   null    : déjà venu, compte équipe, compte désactivé, ou doute (erreur de lecture).
 */
async function footerKind(address: string): Promise<FooterKind> {
  const r = await db(`profiles?select=id,email,is_active&email=ilike.${encodeURIComponent(address)}&limit=5`);
  if (!r.ok) return null;
  const rows = await r.json();
  if (!Array.isArray(rows)) return null;
  // ilike traite « _ » comme un joker : seule l’adresse exacte compte (sinon : pas de compte).
  const exact = rows.filter((p: { email: string | null }) => String(p.email ?? '').toLowerCase() === address);
  if (exact.length === 0) return 'join';
  const profile = exact[0] as { id: string; is_active: boolean | null };
  if (profile.is_active === false) return null;
  const ca = await db(`contact_accounts?select=first_portal_visit_at&user_id=eq.${profile.id}&limit=1`);
  if (!ca.ok) return null;
  const acc = await ca.json();
  if (!Array.isArray(acc) || acc.length === 0) return null;          // compte de l'équipe
  return acc[0].first_portal_visit_at ? null : 'login';
}
const toText = (html: string) => html
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!TENANT || !CID || !CSECRET) return J({ error: 'graph_not_configured' }, 501);

  const user = await caller(req);
  if (!user) return J({ error: 'not_signed_in' }, 401);

  const { companyId, contactId, to, subject, body, attachments, from, origin } = await req.json();
  if (!companyId || !to || !subject) return J({ error: 'missing_params' }, 400);

  const member = await (await db(`user_roles?select=role&user_id=eq.${user.id}&company_id=eq.${companyId}&limit=1`)).json();
  if (!Array.isArray(member) || member.length === 0) return J({ error: 'not_a_member' }, 403);

  const boxes = await (await db(`company_mailboxes?select=address&company_id=eq.${companyId}&is_active=eq.true`)).json();
  const shared = new Set((Array.isArray(boxes) ? boxes : []).map((b: { address: string }) => b.address.toLowerCase()));
  const domains = new Set([...shared].map(domainOf));

  // Boîte d'expédition, vérifiée côté serveur.
  let mailbox: string | undefined;
  const wanted = typeof from === 'string' ? from.trim().toLowerCase() : '';
  if (wanted) {
    const isShared = shared.has(wanted);
    const isOwn = wanted === user.email && domains.has(domainOf(wanted));
    if (!isShared && !isOwn) return J({ error: 'unknown_mailbox' }, 400);
    mailbox = wanted;
  } else {
    const co = await (await db(`companies?select=inbound_mailbox&id=eq.${companyId}`)).json();
    mailbox = co?.[0]?.inbound_mailbox?.toLowerCase();
  }
  if (!mailbox) return J({ error: 'no_mailbox' }, 400);

  // Pièces jointes : [{ name, contentType, contentBytes(base64) }]
  const atts = Array.isArray(attachments) ? attachments.map((a: Record<string, string>) => ({
    '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType || 'application/octet-stream', contentBytes: a.contentBytes,
  })) : [];

  // Pied de mail P-5 / P-6 : destinataire unique, hors concession, origine valide.
  const o = typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : '';
  const validOrigin = /^https:\/\/[^/\s]+$/.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o);
  const recipient = String(to).trim().toLowerCase();
  const single = /^[^\s@,;]+@[^\s@,;]+$/.test(recipient);
  const internalAddress = domains.has(domainOf(recipient)) || shared.has(recipient);
  const kind = validOrigin && single && !internalAddress ? await footerKind(recipient) : null;
  const footer = kind ? footerHtml(kind, o, recipient) : '';

  const tok = await token();
  if (!tok) return J({ error: 'graph_auth_failed' }, 502);

  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: String(body || '') + footer }, // déjà du HTML (éditeur enrichi)
        toRecipients: [{ emailAddress: { address: to } }],
        ...(atts.length ? { attachments: atts } : {}),
      },
      saveToSentItems: true,
    }),
  });
  if (!sendRes.ok) return J({ error: 'send_failed', detail: (await sendRes.text()).slice(0, 200) }, 502);

  // Adresse personnelle : la relève ne la lit pas, on enregistre l'échange nous-mêmes.
  if (!shared.has(mailbox) && contactId) {
    await db('communications', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        company_id: companyId, contact_id: contactId, channel: 'email', direction: 'out',
        subject, body: toText(String(body || '')).slice(0, 12000), occurred_at: new Date().toISOString(),
        from_address: mailbox, mailbox, created_by: user.id,
      }),
    });
  }
  return J({ ok: true, from: mailbox });
});
