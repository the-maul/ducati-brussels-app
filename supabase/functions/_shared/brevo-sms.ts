// SMS par Brevo (18/11/2026, decision client T14 / T15) : adaptateur de l'API SMS transactionnelle.
// Utilise par dispatch-notifications (file `notifications`, pg_cron) et sms-brevo (etat, SMS de test).
// Fonctions pures + un envoi qui prend `fetch` en parametre : teste dans tests/sms-brevo.test.ts sans
// jamais appeler Brevo.
//
// API (docs Brevo « Transactional SMS endpoints ») :
//   POST https://api.brevo.com/v3/transactionalSMS/send   (ancien chemin : /v3/transactionalSMS/sms)
//   en-tetes : api-key: <BREVO_API_KEY>, content-type / accept: application/json
//   corps    : { sender, recipient, content, type: 'transactional', tag, unicodeEnabled }
//              sender  : 11 caracteres alphanumeriques ou 15 chiffres
//              recipient : numero avec indicatif pays, SANS « + » (ex. 32470123456)
//   reponse  : 201 { messageId } ; erreur 4xx { code, message } (not_enough_credits, unauthorized...)
//   GET https://api.brevo.com/v3/account : plan[] avec { type: 'sms', credits } (solde SMS).
//
// Secrets Supabase : BREVO_API_KEY (obligatoire pour envoyer ; absente = « skipped / no_api_key »,
// jamais d'erreur), BREVO_SMS_SENDER (facultatif, defaut DucatiBXL).
//
// deno-lint-ignore-file

export const BREVO_BASE = 'https://api.brevo.com/v3';
export const BREVO_SEND_PATHS = ['/transactionalSMS/send', '/transactionalSMS/sms'] as const;
export const DEFAULT_SENDER = 'DucatiBXL';

/**
 * Numero en E.164 (+32470123456), Belgique par defaut ; null si illisible.
 * Miroir de public._sms_e164 (migration 20261119170000).
 */
export function normalizePhone(raw: string | null | undefined, cc = '32'): string | null {
  if (raw == null) return null;
  let d = String(raw).trim().replace(/[\s./()\-]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = cc + d.slice(1);
  else if (cc === '32' && /^4\d{8}$/.test(d)) d = '32' + d;
  if (!/^[1-9]\d{7,14}$/.test(d)) return null;
  if (d.startsWith('32') && d.length !== 10 && d.length !== 11) return null;
  return '+' + d;
}

/** Mobile ? Belgique : +32 4xx ; a l'etranger on ne sait pas : accepte. */
export function isMobile(e164: string | null | undefined): boolean {
  if (!e164) return false;
  return !e164.startsWith('+32') || /^\+324\d{8}$/.test(e164);
}

/** Destinataire au format Brevo : chiffres seuls, indicatif compris, sans « + ». */
export function brevoRecipient(e164: string): string {
  return e164.replace(/^\+/, '');
}

/** Expediteur valable chez Brevo : 11 caracteres alphanumeriques, ou 15 chiffres. */
export function isValidSender(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^[A-Za-z0-9]{1,11}$/.test(s) || /^\d{1,15}$/.test(s);
}

/** Expediteur retenu : celui de la societe, sinon le secret BREVO_SMS_SENDER, sinon DucatiBXL. */
export function resolveSender(company: string | null | undefined, envSender: string | null | undefined): string {
  if (isValidSender(company ?? null)) return String(company);
  if (isValidSender(envSender ?? null)) return String(envSender);
  return DEFAULT_SENDER;
}

// Alphabet SMS standard (GSM 03.38) : 160 caracteres par SMS ; au-dela, 153 par morceau.
// Un caractere hors alphabet (ex. « ê », « œ », emoji) fait passer tout le SMS en Unicode : 70 / 67.
const GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€\f';

export type SmsSize = { encoding: 'gsm' | 'unicode'; units: number; segments: number; perSegment: number };

export function smsSize(text: string): SmsSize {
  const chars = Array.from(text ?? '');
  let gsm = true, units = 0;
  for (const ch of chars) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (!gsm) {
    const u = chars.reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
    return { encoding: 'unicode', units: u, segments: u === 0 ? 0 : u <= 70 ? 1 : Math.ceil(u / 67), perSegment: u <= 70 ? 70 : 67 };
  }
  return { encoding: 'gsm', units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153), perSegment: units <= 160 ? 160 : 153 };
}

export type BrevoPayload = {
  sender: string; recipient: string; content: string; type: 'transactional'; tag: string; unicodeEnabled: boolean;
};

export function buildBrevoPayload(p: { sender: string; to: string; content: string; tag?: string }): BrevoPayload {
  return {
    sender: p.sender,
    recipient: brevoRecipient(p.to),
    content: p.content,
    type: 'transactional',
    tag: p.tag || 'dms',
    unicodeEnabled: smsSize(p.content).encoding === 'unicode',
  };
}

export type SendResult =
  | { status: 'sent'; messageId: string | null }
  | { status: 'skipped'; error: string }
  | { status: 'failed'; error: string };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; text(): Promise<string>;
}>;

/** Lit l'erreur Brevo ({ code, message }) en un code court : brevo_<status>_<code>. */
export function brevoError(status: number, bodyText: string): string {
  let code = '';
  try {
    const j = JSON.parse(bodyText);
    code = String(j?.code ?? '').trim();
  } catch { /* corps non JSON */ }
  return `brevo_${status}${code ? '_' + code.replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 40) : ''}`;
}

/**
 * Envoie un SMS. Cle absente : « skipped / no_api_key » (aucun appel). Numero illisible : « failed /
 * invalid_number ». Si le chemin /send repond 404, essaie l'ancien /sms (API v3 historique).
 */
export async function sendBrevoSms(p: {
  apiKey: string | null | undefined; sender: string; to: string; content: string; tag?: string; fetchImpl: FetchLike;
}): Promise<SendResult> {
  if (!p.apiKey) return { status: 'skipped', error: 'no_api_key' };
  const to = normalizePhone(p.to);
  if (!to) return { status: 'failed', error: 'invalid_number' };
  if (!p.content || !p.content.trim()) return { status: 'failed', error: 'empty' };
  const body = JSON.stringify(buildBrevoPayload({ sender: p.sender, to, content: p.content, tag: p.tag }));
  const headers = { 'api-key': p.apiKey, 'content-type': 'application/json', accept: 'application/json' };
  let last = '';
  for (const path of BREVO_SEND_PATHS) {
    let res;
    try {
      res = await p.fetchImpl(BREVO_BASE + path, { method: 'POST', headers, body });
    } catch (e) {
      return { status: 'failed', error: 'brevo_network' };
    }
    const text = await res.text().catch(() => '');
    if (res.ok) {
      let id: string | null = null;
      try { const j = JSON.parse(text); id = j?.messageId != null ? String(j.messageId) : null; } catch { /* vide */ }
      return { status: 'sent', messageId: id };
    }
    last = brevoError(res.status, text);
    if (res.status !== 404) break;
  }
  return { status: 'failed', error: last || 'brevo_error' };
}

/** Solde SMS du compte Brevo (GET /account) ; null si inconnu. */
export function smsCredits(account: unknown): number | null {
  const plan = (account as { plan?: unknown })?.plan;
  if (!Array.isArray(plan)) return null;
  const sms = plan.find((x) => (x as { type?: string })?.type === 'sms') as { credits?: unknown } | undefined;
  const c = Number(sms?.credits);
  return sms && Number.isFinite(c) ? c : null;
}
