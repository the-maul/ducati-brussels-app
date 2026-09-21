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
//
// SIMULATION (`dryRun: true`, 19/09) : mêmes contrôles (connexion, société, boîte, pied de
// mail), mais RIEN n'est envoyé ni enregistré : la fonction renvoie le message construit
// (objet, destinataire, boîte, corps HTML avec pied, pièces jointes sans leur contenu).
// Sert aux essais sans écrire à un client.
//
// TRACE D'UN DOCUMENT (`trace: { entityType: 'documents', entityId }`, mission 05 carte 8) :
// le document doit appartenir à la société ; après un envoi réussi, une ligne `events`
// (action `email_sent`) note qui, quand, à qui, depuis quelle boîte, l'objet et les fichiers.
// Les appelants existants (sans `dryRun` ni `trace`) ne voient aucun changement.
//
// SIGNATURE (retour client du 21/09) : ajoutée à TOUS les envois (CRM, documents de vente,
// fournisseurs), entre le message et le pied de mail, selon l'adresse d'envoi :
//   - adresse personnelle → nom (profiles.full_name) + fonction (profiles.job_title) ;
//   - boîte partagée → nom de la boîte (company_mailboxes.signature_name), sans personne ;
// puis les coordonnées de la société (companies.mail_signature_*) et « E : » = adresse d'envoi.
// Lecture en best-effort : si la migration 20260921191000 n'est pas encore appliquée, on
// retombe sur le nom et l'adresse de la société ; une erreur de lecture n'empêche jamais l'envoi.
// Le mode `dryRun` renvoie le HTML complet (aperçu dans la fenêtre d'envoi).
// Secrets : MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET
//   (app Azure, permission APPLICATION Mail.Send).
// deno-lint-ignore-file
import {
  footerHtml, toGraphAttachments, buildGraphMessage, attachmentsSummary, signatureHtml, signatureFor,
  type SignatureCompany,
} from '../_shared/mail-message.ts';
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
type FooterKind = 'join' | 'login' | null;

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
/** Première ligne d'une réponse REST, ou null (erreur, colonne absente…). */
async function first<T>(path: string): Promise<T | null> {
  try {
    const r = await db(path);
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] as T : null;
  } catch { return null; }
}

/** HTML de la signature pour cette boîte d'envoi ('' si rien à signer). Jamais d'exception. */
async function signatureBlock(companyId: string, mailbox: string, shared: boolean, userId: string): Promise<string> {
  const company = await first<SignatureCompany>(`companies?select=name,address,zip,city,mail_signature_brand,mail_signature_address,mail_signature_phone,mail_signature_site_url,mail_signature_site_label&id=eq.${companyId}`)
    ?? await first<SignatureCompany>(`companies?select=name,address,zip,city&id=eq.${companyId}`);
  let user: { full_name: string | null; job_title?: string | null } | null = null;
  let mailboxName: string | null = null;
  if (shared) {
    try {
      const r = await db(`company_mailboxes?select=address,signature_name&company_id=eq.${companyId}`);
      const rows = r.ok ? await r.json() : [];
      const box = (Array.isArray(rows) ? rows : []).find((b: { address: string }) => String(b.address).toLowerCase() === mailbox);
      mailboxName = box?.signature_name ?? null;
    } catch { mailboxName = null; }
  } else {
    user = await first<{ full_name: string | null; job_title: string | null }>(`profiles?select=full_name,job_title&id=eq.${userId}`)
      ?? await first<{ full_name: string | null }>(`profiles?select=full_name&id=eq.${userId}`);
  }
  return signatureHtml(signatureFor({ from: mailbox, shared, user, mailboxName, company }));
}

const toText = (html: string) => html
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const payload = await req.json().catch(() => ({}));
  const { companyId, contactId, to, subject, body, attachments, from, origin, trace } = payload ?? {};
  const dryRun = payload?.dryRun === true;
  if (!dryRun && (!TENANT || !CID || !CSECRET)) return J({ error: 'graph_not_configured' }, 501);

  const user = await caller(req);
  if (!user) return J({ error: 'not_signed_in' }, 401);

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
  const atts = toGraphAttachments(attachments);

  // Document à tracer : il doit appartenir à la société (sinon on n'envoie rien).
  const traceId = trace && trace.entityType === 'documents' && typeof trace.entityId === 'string' && /^[0-9a-f-]{36}$/i.test(trace.entityId)
    ? trace.entityId : null;
  if (trace && !traceId) return J({ error: 'bad_trace' }, 400);
  if (traceId) {
    const d = await (await db(`documents?select=id&id=eq.${traceId}&company_id=eq.${companyId}&limit=1`)).json();
    if (!Array.isArray(d) || d.length === 0) return J({ error: 'unknown_document' }, 400);
  }

  // Pied de mail P-5 / P-6 : destinataire unique, hors concession, origine valide.
  const o = typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : '';
  const validOrigin = /^https:\/\/[^/\s]+$/.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o);
  const recipient = String(to).trim().toLowerCase();
  const single = /^[^\s@,;]+@[^\s@,;]+$/.test(recipient);
  const internalAddress = domains.has(domainOf(recipient)) || shared.has(recipient);
  const kind = validOrigin && single && !internalAddress ? await footerKind(recipient) : null;
  const footer = kind ? footerHtml(kind, o, recipient) : '';

  // Signature selon l'adresse d'envoi (21/09).
  const signature = await signatureBlock(companyId, mailbox, shared.has(mailbox), user.id);

  // Corps déjà en HTML (éditeur enrichi) + signature + pied de mail.
  const graphBody = buildGraphMessage({ subject, bodyHtml: String(body || ''), signature, footer, to, attachments: atts });

  if (dryRun) {
    return J({
      ok: true, dryRun: true, from: mailbox, to, subject, footer: kind, signature: signature !== '',
      html: graphBody.message.body.content, attachments: attachmentsSummary(atts),
      trace: traceId ? { entityType: 'documents', entityId: traceId } : null,
    });
  }

  const tok = await token();
  if (!tok) return J({ error: 'graph_auth_failed' }, 502);

  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(graphBody),
  });
  if (!sendRes.ok) return J({ error: 'send_failed', detail: (await sendRes.text()).slice(0, 200) }, 502);

  // Trace du document envoyé (qui, quand, à qui, quelle boîte, quels fichiers).
  if (traceId) {
    await db('events', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        company_id: companyId, actor_id: user.id, action: 'email_sent', entity_type: 'documents',
        entity_id: traceId, origin: 'screen',
        new_data: { to, from: mailbox, subject, contact_id: contactId ?? null, attachments: attachmentsSummary(atts), footer: kind },
      }),
    });
  }

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
