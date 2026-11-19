// M10 — Envoi d'un mail par Microsoft Graph depuis une boîte de la concession (Q53, 19/11/2026).
//
// Partagé par toutes les fonctions qui envoient un mail : graph-send-email (envois de l'écran),
// dispatch-notifications (file `notifications` : rappels de RDV, relances de factures, confirmation
// de commande), followups-send (relances d'entretien), accounting-auto-transfer (fichiers EBP).
// Avant, chacune recopiait le jeton Graph et l'appel /sendMail ; la file de notifications passait,
// elle, par Resend, jamais configuré : ses mails ne partaient jamais.
//
// Le mail est enregistré dans « Éléments envoyés » de la boîte (saveToSentItems).
//
// EXPÉDITEUR AUTORISÉ (règle de graph-send-email, retour client du 18/09), une seule fois ici :
//   - une boîte de la société (company_mailboxes actives : shop@, occasions@, info@…) ;
//   - OU l'adresse personnelle de l'utilisateur connecté, si elle est du même domaine que ces boîtes.
//   Jamais une adresse arbitraire fournie par le navigateur. `allowedSender` est pur (testé).
//
// Secrets : MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET (app Azure, permission
// APPLICATION Mail.Send). Leur valeur n'est jamais renvoyée : `graphConfigured()` dit seulement s'ils
// sont posés.
// deno-lint-ignore-file
import { signatureFor, signatureHtml, type SignatureCompany } from './mail-message.ts';

declare const Deno: { env: { get(k: string): string | undefined } } | undefined;

const env = (k: string): string | undefined => (typeof Deno !== 'undefined' ? Deno.env.get(k) : undefined);

/** Les trois secrets Graph sont-ils posés ? (jamais leur valeur) */
export function graphConfigured(): boolean {
  return !!(env('MS_GRAPH_TENANT_ID') && env('MS_GRAPH_CLIENT_ID') && env('MS_GRAPH_CLIENT_SECRET'));
}

let cached: { token: string; until: number } | null = null;

/** Jeton d'application Graph (client_credentials), gardé ~50 min dans l'instance. null si impossible. */
export async function graphToken(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!graphConfigured()) return null;
  if (cached && cached.until > Date.now()) return cached.token;
  const form = new URLSearchParams({
    client_id: env('MS_GRAPH_CLIENT_ID')!, client_secret: env('MS_GRAPH_CLIENT_SECRET')!,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  });
  const r = await fetchImpl(`https://login.microsoftonline.com/${env('MS_GRAPH_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  });
  if (!r.ok) return null;
  const tok = (await r.json().catch(() => null))?.access_token ?? null;
  if (tok) cached = { token: tok, until: Date.now() + 50 * 60 * 1000 };
  return tok;
}

export type GraphSendResult = { ok: true } | { ok: false; error: string };

/**
 * POST /users/{boîte}/sendMail. `message` = le corps Graph complet ({ message, saveToSentItems })
 * construit par `buildGraphMessage` (mail-message.ts). Jamais d'exception.
 */
export async function sendGraphMail(mailbox: string, message: unknown, fetchImpl: typeof fetch = fetch): Promise<GraphSendResult> {
  try {
    const tok = await graphToken(fetchImpl);
    if (!tok) return { ok: false, error: graphConfigured() ? 'graph_auth_failed' : 'graph_not_configured' };
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `graph_${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: `graph_error: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

export const domainOf = (a: string) => a.split('@')[1]?.toLowerCase() ?? '';

/**
 * Expéditeur autorisé (pur). `wanted` : adresse demandée (vide = boîte par défaut `fallback`).
 *   - boîte de la société → elle ;
 *   - adresse de l'utilisateur, même domaine que les boîtes → elle ;
 *   - sinon `{ error: 'unknown_mailbox' }` ; pas de boîte du tout → `{ error: 'no_mailbox' }`.
 */
export function allowedSender(p: {
  wanted?: string | null; userEmail?: string | null; shared: Iterable<string>; fallback?: string | null;
}): { mailbox: string; shared: boolean } | { error: 'unknown_mailbox' | 'no_mailbox' } {
  const shared = new Set([...p.shared].map((a) => a.toLowerCase()));
  const domains = new Set([...shared].map(domainOf));
  const wanted = String(p.wanted ?? '').trim().toLowerCase();
  if (wanted) {
    if (shared.has(wanted)) return { mailbox: wanted, shared: true };
    const user = String(p.userEmail ?? '').trim().toLowerCase();
    if (wanted === user && domains.has(domainOf(wanted))) return { mailbox: wanted, shared: false };
    return { error: 'unknown_mailbox' };
  }
  const fb = String(p.fallback ?? '').trim().toLowerCase();
  if (!fb) return { error: 'no_mailbox' };
  return { mailbox: fb, shared: shared.has(fb) };
}

type Db = (path: string, init?: RequestInit) => Promise<Response>;

/** Boîtes actives de la société (adresses en minuscules). [] en cas d'erreur. */
export async function companyMailboxes(db: Db, companyId: string): Promise<string[]> {
  try {
    const r = await db(`company_mailboxes?select=address&company_id=eq.${companyId}&is_active=eq.true`);
    const rows = r.ok ? await r.json() : [];
    return (Array.isArray(rows) ? rows : []).map((b: { address: string }) => String(b.address).toLowerCase());
  } catch { return []; }
}

/**
 * Boîte d'envoi des mails AUTOMATIQUES de la société (réglage « Mise en production », sinon info@,
 * sinon la boîte principale, sinon la première boîte active) : fonction SQL `notification_sender`.
 * null si aucune boîte. Migration pas encore posée : boîte principale, sinon première boîte active.
 */
export async function automationSender(db: Db, companyId: string): Promise<string | null> {
  try {
    const r = await db('rpc/notification_sender', { method: 'POST', body: JSON.stringify({ _company: companyId }) });
    if (r.ok) {
      const v = await r.json();
      return typeof v === 'string' && v ? v.toLowerCase() : null;
    }
  } catch { /* repli ci-dessous */ }
  try {
    const co = await (await db(`companies?select=inbound_mailbox&id=eq.${companyId}`)).json();
    const main = String(co?.[0]?.inbound_mailbox ?? '').toLowerCase();
    const boxes = await companyMailboxes(db, companyId);
    if (main && boxes.includes(main)) return main;
    return boxes.sort()[0] ?? null;
  } catch { return null; }
}

/** Signature d'une boîte partagée (nom de la boîte + coordonnées de la société). '' si rien. Jamais d'exception. */
export async function sharedBoxSignature(db: Db, companyId: string, mailbox: string): Promise<string> {
  try {
    let company: SignatureCompany | null = null;
    const r = await db(`companies?select=name,address,zip,city,mail_signature_brand,mail_signature_address,mail_signature_phone,mail_signature_site_url,mail_signature_site_label&id=eq.${companyId}`);
    if (r.ok) { const rows = await r.json(); company = Array.isArray(rows) && rows[0] ? rows[0] : null; }
    if (!company) {
      const r2 = await db(`companies?select=name,address,zip,city&id=eq.${companyId}`);
      const rows = r2.ok ? await r2.json() : [];
      company = Array.isArray(rows) && rows[0] ? rows[0] : null;
    }
    let mailboxName: string | null = null;
    try {
      const b = await db(`company_mailboxes?select=address,signature_name&company_id=eq.${companyId}`);
      const rows = b.ok ? await b.json() : [];
      const box = (Array.isArray(rows) ? rows : []).find((x: { address: string }) => String(x.address).toLowerCase() === mailbox.toLowerCase());
      mailboxName = box?.signature_name ?? null;
    } catch { mailboxName = null; }
    return signatureHtml(signatureFor({ from: mailbox, shared: true, mailboxName, company }));
  } catch { return ''; }
}

/** Texte brut de la file (sauts de ligne) → HTML échappé, un paragraphe par bloc. */
export function plainToHtml(text: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return String(text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
