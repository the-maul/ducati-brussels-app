// M10 — Edge Function : ENVOI DES RELANCES D'ENTRETIEN (migration 20261031120000, decision M-72).
//
// Quoi : les relances `followups` au statut `planifiee` dont la date d'envoi est atteinte partent
// par e-mail, depuis une boite Outlook de la societe (Microsoft Graph, decision D4 : jamais
// Resend). Le texte vient de `followup_render` (modele de la societe, LANGUE DU CLIENT, variables
// remplies, lien « Prendre rendez-vous » avec le jeton de la relance). La signature de la boite
// est ajoutee comme pour tout mail de l'application (`_shared/mail-message.ts`).
//
// Pourquoi pas la file `notifications` : `appointment-reminders` y enfile ses rappels, que
// `dispatch-notifications` marque `skipped` faute de cle Resend. On passe par Outlook, le seul
// canal reel de la concession.
//
// Qui appelle :
//   - pg_cron (tache `followups-send`, en-tete x-cron-secret) : toutes les societes, tout ce
//     qui est du ;
//   - un membre connecte (bouton « Envoyer maintenant » / « Apercu ») : { companyId, followupId,
//     dryRun? } — `dryRun` renvoie le mail construit (objet, destinataire, boite, HTML) sans
//     rien envoyer ni enregistrer.
// Apres chaque envoi : `followup_mark_sent` (statut envoyee, copie du mail, echange dans
// l'historique du client, ligne `events`) ; en cas d'echec : `followup_mark_error` (la relance
// reste planifiee et repart au passage suivant).
//
// Secrets : MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET (app Azure,
// permission APPLICATION Mail.Send), CRON_SECRET, APP_ORIGINS (adresse de l'espace client,
// premiere valeur ; sinon la premiere adresse connue). Sans cle Graph : 501 graph_not_configured,
// rien n'est marque.
// Deploiement : npx supabase@2.117.0 functions deploy followups-send --project-ref ujmrosbgkvgvwfnuryna
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { identify, isActiveMember, isUuid } from '../_shared/acces.ts';
import { buildGraphMessage, signatureFor, signatureHtml, MAIL_STYLE, type SignatureCompany } from '../_shared/mail-message.ts';
import { mailTexts } from '../_shared/mail-i18n.ts';

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = Deno.env.get('MS_GRAPH_TENANT_ID');
const CID = Deno.env.get('MS_GRAPH_CLIENT_ID');
const CSECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET');
const DEFAULT_APP_ORIGINS = ['https://ducatilive.netlify.app', 'https://app.ducatibruxelles.be', 'https://dms.ducatibruxelles.be'];
const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const CLIENT_ORIGIN = APP_ORIGINS[0] ?? DEFAULT_APP_ORIGINS[0];

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const H = { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const r = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) return { ok: false, data: null, error: `${fn}: ${(await r.text()).slice(0, 300)}` };
  const txt = await r.text();
  return { ok: true, data: txt ? JSON.parse(txt) as T : null };
}
async function graphToken(): Promise<string | null> {
  const form = new URLSearchParams({ client_id: CID!, client_secret: CSECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  return r.ok ? (await r.json()).access_token : null;
}

type Followup = { id: string; company_id: string; kind: string; status: string; send_at: string; locale: string; to_email: string | null };
type Rendered = { subject: string; body: string; to_email: string | null; locale: string; link: string; template_key: string | null };

/** Boite d'envoi : la boite principale de la societe, sinon la premiere boite partagee active. */
async function senderFor(companyId: string): Promise<{ mailbox: string | null; name: string | null }> {
  const co = await (await db(`companies?select=inbound_mailbox&id=eq.${companyId}`)).json().catch(() => null);
  const boxes = await (await db(`company_mailboxes?select=address,signature_name&company_id=eq.${companyId}&is_active=eq.true&order=address`)).json().catch(() => []);
  const list = Array.isArray(boxes) ? boxes as { address: string; signature_name?: string | null }[] : [];
  const main = String(co?.[0]?.inbound_mailbox ?? '').toLowerCase() || null;
  const mailbox = main ?? (list[0]?.address?.toLowerCase() ?? null);
  const box = list.find((b) => b.address.toLowerCase() === mailbox);
  return { mailbox, name: box?.signature_name ?? null };
}

/** Signature de la boite (coordonnees de la fiche societe) ; jamais d'exception. */
async function signatureOf(companyId: string, mailbox: string, mailboxName: string | null): Promise<string> {
  try {
    const r = await db(`companies?select=name,address,zip,city,mail_signature_brand,mail_signature_address,mail_signature_phone,mail_signature_site_url,mail_signature_site_label&id=eq.${companyId}`);
    let company: SignatureCompany | null = null;
    if (r.ok) { const rows = await r.json(); company = Array.isArray(rows) && rows[0] ? rows[0] : null; }
    if (!company) {
      const r2 = await db(`companies?select=name,address,zip,city&id=eq.${companyId}`);
      const rows = r2.ok ? await r2.json() : [];
      company = Array.isArray(rows) && rows[0] ? rows[0] : null;
    }
    return signatureHtml(signatureFor({ from: mailbox, shared: true, mailboxName, company }));
  } catch { return ''; }
}

/**
 * Corps HTML : paragraphes du modele (texte brut), la ligne du lien devient un bouton
 * « Prendre rendez-vous » dans la langue du client. Les couleurs viennent de MAIL_STYLE.
 */
export function bodyHtml(text: string, link: string, locale: string): string {
  const book = mailTexts(locale).followup.book;
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs.map((p) => {
    const lines = p.split('\n').map((l) => {
      if (link && l.trim() === link) {
        return `<a href="${esc(link)}" style="display:inline-block;background:${MAIL_STYLE.brand};color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:6px">${esc(book)}</a>`;
      }
      return esc(l);
    });
    return `<p style="margin:0 0 14px 0">${lines.join('<br>')}</p>`;
  }).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const caller = await identify(req);
  if (!caller) return J({ error: 'forbidden' }, 403);
  const body = await req.json().catch(() => ({})) as { companyId?: unknown; followupId?: unknown; dryRun?: unknown };
  const dryRun = body.dryRun === true;
  const companyId = isUuid(body.companyId) ? body.companyId : null;
  const followupId = isUuid(body.followupId) ? body.followupId : null;

  if (caller.kind === 'user') {
    // Un membre : sa societe, une relance precise (envoi immediat ou apercu).
    if (!companyId || !followupId) return J({ error: 'missing_params' }, 400);
    if (!(await isActiveMember(caller.id, companyId))) return J({ error: 'not_a_member' }, 403);
  }
  if (!dryRun && (!TENANT || !CID || !CSECRET)) return J({ error: 'graph_not_configured' }, 501);

  // Ce qui est du : planifiee et send_at atteinte (cron), ou la relance demandee (membre).
  const today = new Date().toISOString().slice(0, 10);
  let q = 'followups?select=id,company_id,kind,status,send_at,locale,to_email&status=eq.planifiee&order=send_at&limit=200';
  if (followupId) q += `&id=eq.${followupId}`;
  else q += `&send_at=lte.${today}`;
  if (companyId) q += `&company_id=eq.${companyId}`;
  const due = await (await db(q)).json().catch(() => []);
  const list = (Array.isArray(due) ? due : []) as Followup[];
  if (followupId && list.length === 0) return J({ error: 'not_due_or_not_planned' }, 400);

  let sent = 0, failed = 0;
  const errors: { id: string; error: string }[] = [];
  const senders = new Map<string, { mailbox: string | null; name: string | null; signature: string }>();
  let tok: string | null = null;

  for (const f of list) {
    const rendered = await rpc<Rendered[]>('followup_render', { _id: f.id, _origin: CLIENT_ORIGIN });
    const m = rendered.data?.[0];
    if (!rendered.ok || !m) { failed++; errors.push({ id: f.id, error: rendered.error ?? 'render_empty' }); await rpc('followup_mark_error', { _id: f.id, _error: rendered.error ?? 'render_empty' }); continue; }
    const to = String(m.to_email ?? f.to_email ?? '').trim().toLowerCase();
    if (!/^[^\s@,;]+@[^\s@,;]+$/.test(to)) { failed++; errors.push({ id: f.id, error: 'no_email' }); await rpc('followup_mark_error', { _id: f.id, _error: 'adresse e-mail absente ou invalide' }); continue; }

    let s = senders.get(f.company_id);
    if (!s) {
      const { mailbox, name } = await senderFor(f.company_id);
      s = { mailbox, name, signature: mailbox ? await signatureOf(f.company_id, mailbox, name) : '' };
      senders.set(f.company_id, s);
    }
    if (!s.mailbox) { failed++; errors.push({ id: f.id, error: 'no_mailbox' }); await rpc('followup_mark_error', { _id: f.id, _error: 'aucune boite d envoi pour la societe' }); continue; }

    const html = bodyHtml(m.body, m.link, m.locale);
    const graphBody = buildGraphMessage({ subject: m.subject, bodyHtml: html, signature: s.signature, footer: '', to, attachments: [] });
    if (dryRun) {
      return J({ ok: true, dryRun: true, id: f.id, from: s.mailbox, to, subject: m.subject, locale: m.locale, html: graphBody.message.body.content, link: m.link });
    }
    tok = tok ?? await graphToken();
    if (!tok) return J({ error: 'graph_auth_failed', sent, failed }, 502);
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(s.mailbox)}/sendMail`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(graphBody),
    });
    if (!res.ok) {
      const detail = `graph_${res.status}: ${(await res.text()).slice(0, 200)}`;
      failed++; errors.push({ id: f.id, error: detail });
      await rpc('followup_mark_error', { _id: f.id, _error: detail });
      continue;
    }
    const mark = await rpc('followup_mark_sent', { _id: f.id, _subject: m.subject, _body: m.body, _mailbox: s.mailbox, _template_key: m.template_key });
    if (!mark.ok) { failed++; errors.push({ id: f.id, error: mark.error ?? 'mark_failed' }); continue; }
    sent++;
  }
  return J({ ok: true, processed: list.length, sent, failed, errors });
});
