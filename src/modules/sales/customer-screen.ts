/**
 * M6 -- Ecran client sur tablette (mission 12, carte P2 ; PDV020, 03/11/2026).
 * Regles PURES (aucun appel reseau), testees dans tests/ecran-client.test.ts :
 *  - le parcours de la vente vu par le client : accueil -> ticket -> paiement -> signature -> merci -> accueil ;
 *  - ce que la tablette affiche a partir de l etat lu en base (mode pose par le vendeur, QR de virement
 *    existant, delai du merci mesure sur l horloge du SERVEUR) ;
 *  - le ticket envoye a l ecran (lignes, remises, TVA par taux, total TTC) : rien d autre du client que
 *    son nom et sa langue ;
 *  - le code d appairage (6 caracteres sans ambiguite) et l etat connecte / deconnecte d un appareil ;
 *  - la langue de l ecran : celle du client si on la connait (I18N004), sinon celle choisie sur l ecran.
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n';

export const SCREEN_MODES = ['accueil', 'ticket', 'qr', 'terminal', 'signature', 'merci'] as const;
export type ScreenMode = (typeof SCREEN_MODES)[number];
export const isScreenMode = (v: unknown): v is ScreenMode => typeof v === 'string' && (SCREEN_MODES as readonly string[]).includes(v);

/** Duree du merci (s) ; plus long quand le client peut taper son adresse e-mail. */
export const THANKS_SECONDS = 10;
export const THANKS_EMAIL_SECONDS = 90;
/** Un appareil est « connecte » s il a donne signe de vie depuis moins de 30 s (il relit toutes les 5 s). */
export const ONLINE_WINDOW_MS = 30_000;
/** Relecture de secours, comme l ecran QR existant. */
export const SCREEN_POLL_MS = 5000;
export const SCREEN_TOKEN_STORAGE_KEY = 'ducati.ecran-client.token';

/* ------------------------------------------------------------------------------------------------
 * Ticket montre au client
 * ---------------------------------------------------------------------------------------------- */

export type TicketLineInput = {
  designation: string; quantity: number; unit_price_ht: number; vat_rate: number;
  discount_pct?: number | null; line_type?: string | null;
};
export type ScreenLine = { designation: string; quantity: number; unit_ttc: number; discount_pct: number; total_ttc: number; text?: boolean };
export type ScreenVat = { rate: number; base: number; vat: number };
export type ScreenTotals = { ht: number; vat: number; ttc: number; discount: number };
export type ScreenQr =
  | { kind: 'sepa' }
  | { kind: 'stripe'; url: string; expires_at?: string | null }
  | { kind: 'bancontact'; url: string; expires_at?: string | null };
export type ScreenMethod = 'card' | 'cash' | 'qr_sepa' | 'qr_stripe';
export type ScreenSignature = { title: string; text: string; document_id?: string | null };

/** Charge utile de `counter_displays.payload` (memes cles que le filtre de counter_display_set). */
export type ScreenPayload = {
  doc_type?: string | null;
  document_number?: string | null;
  customer_name?: string | null;
  locale?: Locale | null;
  lines?: ScreenLine[];
  totals?: ScreenTotals;
  vat?: ScreenVat[];
  amount?: number;
  due?: number;
  methods?: ScreenMethod[];
  qr?: ScreenQr | null;
  signature?: ScreenSignature | null;
  allow_email?: boolean;
  email_sent?: boolean;
  thanks_seconds?: number;
  message?: string | null;
  stage?: 'saisie' | 'a_payer';
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const noAmount = (t: string | null | undefined) => t === 'texte' || t === 'vide';

/** Lignes et totaux tels que le client les voit (TTC par ligne, remise, TVA par taux). */
export function ticketForScreen(lines: TicketLineInput[], opts: { noVat?: boolean } = {}): Pick<ScreenPayload, 'lines' | 'totals' | 'vat'> {
  const out: ScreenLine[] = [];
  const byRate = new Map<number, ScreenVat>();
  let ht = 0; let vat = 0; let gross = 0;
  for (const l of lines) {
    const qty = Number(l.quantity) || 0;
    if (noAmount(l.line_type)) {
      if (l.line_type === 'texte' && l.designation.trim()) out.push({ designation: l.designation.trim(), quantity: 0, unit_ttc: 0, discount_pct: 0, total_ttc: 0, text: true });
      continue;
    }
    if (qty === 0) continue;
    const rate = opts.noVat ? 0 : Number(l.vat_rate) || 0;
    const disc = Number(l.discount_pct) || 0;
    const lineGross = qty * Number(l.unit_price_ht);
    const lineHt = lineGross * (1 - disc / 100);
    const lineVat = (lineHt * rate) / 100;
    ht += lineHt; vat += lineVat; gross += lineGross * (1 + rate / 100);
    const v = byRate.get(rate) ?? { rate, base: 0, vat: 0 };
    v.base += lineHt; v.vat += lineVat; byRate.set(rate, v);
    out.push({
      designation: l.designation, quantity: qty,
      unit_ttc: r2(Number(l.unit_price_ht) * (1 + rate / 100)), discount_pct: disc,
      total_ttc: r2(lineHt + lineVat),
    });
  }
  const ttc = r2(r2(ht) + r2(vat));
  return {
    lines: out,
    totals: { ht: r2(ht), vat: r2(vat), ttc, discount: r2(Math.max(gross - ttc, 0)) },
    vat: [...byRate.values()].sort((a, b) => a.rate - b.rate).map((v) => ({ rate: v.rate, base: r2(v.base), vat: r2(v.vat) })),
  };
}

/**
 * Ticket d un document de vente deja enregistre : lignes recalculees pour l affichage, mais totaux
 * du DOCUMENT (remise globale, port, net force, detaxe, marge) ; le detail de TVA par taux n est
 * montre que s il retombe exactement sur le total du document.
 */
export function documentForScreen(
  doc: { doc_type?: string | null; number?: string | null; total_ht: number | string; total_vat: number | string; total_ttc: number | string },
  lines: TicketLineInput[],
  opts: { noVat?: boolean; customerName?: string | null; locale?: Locale | null; due?: number | null } = {},
): ScreenPayload {
  const t = ticketForScreen(lines, { noVat: opts.noVat });
  const ht = r2(Number(doc.total_ht) || 0);
  const vat = r2(Number(doc.total_vat) || 0);
  const ttc = r2(Number(doc.total_ttc) || 0);
  const sameTotals = Math.abs((t.totals?.ttc ?? 0) - ttc) < 0.01;
  return {
    doc_type: doc.doc_type ?? null,
    document_number: doc.number ?? null,
    customer_name: opts.customerName ?? null,
    locale: opts.locale ?? null,
    lines: t.lines,
    totals: { ht, vat, ttc, discount: sameTotals ? t.totals?.discount ?? 0 : r2(Math.max((t.totals?.ttc ?? 0) - ttc, 0)) },
    vat: sameTotals ? t.vat : [],
    ...(opts.due != null ? { due: r2(Math.max(opts.due, 0)) } : {}),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Parcours de la vente (cote vendeur) : accueil -> ticket -> paiement -> signature -> merci -> accueil
 * ---------------------------------------------------------------------------------------------- */

export type SaleStep = 'accueil' | 'ticket' | 'paiement' | 'signature' | 'merci';
export type SaleFlow = { step: SaleStep; needsSignature: boolean; method: 'card' | 'qr' | null };
export type SaleEvent =
  | { type: 'cart'; lines: number }
  | { type: 'checkout'; needsSignature?: boolean }
  | { type: 'method'; method: 'card' | 'qr' | null }
  | { type: 'paid' }
  | { type: 'signed' }
  | { type: 'timeout' }
  | { type: 'newSale' };

export const initialSaleFlow: SaleFlow = { step: 'accueil', needsSignature: false, method: null };

/** Une transition non prevue laisse l etat tel quel (l ecran ne saute jamais une etape). */
export function nextSaleFlow(s: SaleFlow, e: SaleEvent): SaleFlow {
  if (e.type === 'newSale') return initialSaleFlow;
  switch (s.step) {
    case 'accueil':
      return e.type === 'cart' && e.lines > 0 ? { ...s, step: 'ticket' } : s;
    case 'ticket':
      if (e.type === 'cart') return e.lines > 0 ? s : initialSaleFlow;
      if (e.type === 'checkout') return { step: 'paiement', needsSignature: !!e.needsSignature, method: null };
      return s;
    case 'paiement':
      if (e.type === 'method') return { ...s, method: e.method };
      if (e.type === 'paid') return { ...s, step: s.needsSignature ? 'signature' : 'merci' };
      return s;
    case 'signature':
      return e.type === 'signed' ? { ...s, step: 'merci' } : s;
    case 'merci':
      return e.type === 'timeout' ? initialSaleFlow : s;
  }
}

/** Mode de l ecran pour une etape du parcours (paiement : terminal si carte, qr si QR, sinon montant a payer). */
export function screenModeForFlow(s: SaleFlow): ScreenMode {
  switch (s.step) {
    case 'accueil': return 'accueil';
    case 'ticket': return 'ticket';
    case 'paiement': return s.method === 'card' ? 'terminal' : s.method === 'qr' ? 'qr' : 'ticket';
    case 'signature': return 'signature';
    case 'merci': return 'merci';
  }
}

/* ------------------------------------------------------------------------------------------------
 * Ce que la tablette affiche (a partir de l etat lu en base)
 * ---------------------------------------------------------------------------------------------- */

export type ScreenPayment = {
  id: string; status: string | null; method: string | null; amount: number; reference: string | null;
  received_at: string | null; document_number: string | null; customer_name: string | null;
};
export type ScreenSnapshot = {
  mode: ScreenMode;
  payload: ScreenPayload;
  version: number;
  mode_changed_at: string | null;
  reply_kind: string | null;
  company_name: string;
  bank: { beneficiary: string; iban: string | null; bic: string | null };
  payment: ScreenPayment | null;
};

export type ResolvedScreen =
  | { mode: 'accueil' }
  | { mode: 'ticket'; stage: 'saisie' | 'a_payer' }
  | { mode: 'qr'; qr: ScreenQr; amount: number; payment: ScreenPayment | null }
  | { mode: 'terminal'; amount: number }
  | { mode: 'signature'; signature: ScreenSignature; signed: boolean }
  | { mode: 'merci'; amount: number | null; allowEmail: boolean; emailSent: boolean; remainingMs: number };

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
};

/** Duree du merci (ms) selon la charge utile. */
export function thanksDurationMs(p: ScreenPayload): number {
  const s = p.allow_email ? Math.max(num(p.thanks_seconds), THANKS_EMAIL_SECONDS) : num(p.thanks_seconds) || THANKS_SECONDS;
  return Math.min(Math.max(s, 3), 600) * 1000;
}

/** Montant a payer affiche : reste du / montant / TTC, dans cet ordre. */
export function amountToPay(p: ScreenPayload): number {
  if (p.due != null && num(p.due) > 0) return r2(num(p.due));
  if (p.amount != null && num(p.amount) > 0) return r2(num(p.amount));
  return r2(num(p.totals?.ttc));
}

/**
 * Ecran a afficher. `serverNowMs` = horloge du serveur (champ `now` de la lecture) : la tablette peut
 * avoir une horloge fausse, le delai du merci se mesure entre deux instants du serveur.
 * Priorite au QR de virement existant (qr_payment_start pose `payment_id`) : attendu -> qr ;
 * recu depuis moins que le merci -> merci.
 */
export function resolveScreen(s: ScreenSnapshot | null | undefined, serverNowMs: number): ResolvedScreen {
  if (!s) return { mode: 'accueil' };
  const p = s.payload ?? {};
  const pay = s.payment;
  if (pay && pay.method === 'VIRQR') {
    if (pay.status === 'attendu') return { mode: 'qr', qr: { kind: 'sepa' }, amount: r2(num(pay.amount)), payment: pay };
    if (pay.status === 'recu') {
      const at = ms(pay.received_at) ?? ms(s.mode_changed_at);
      const left = at == null ? 0 : at + thanksDurationMs(p) - serverNowMs;
      if (left > 0) return { mode: 'merci', amount: r2(num(pay.amount)), allowEmail: !!p.allow_email && s.mode === 'merci', emailSent: s.reply_kind === 'email' || !!p.email_sent, remainingMs: left };
      if (s.mode !== 'merci') return s.mode === 'qr' ? { mode: 'accueil' } : resolveScreen({ ...s, payment: null }, serverNowMs);
    }
  }
  switch (s.mode) {
    case 'ticket': {
      const hasLines = (p.lines ?? []).some((l) => !l.text);
      if (!hasLines && amountToPay(p) <= 0) return { mode: 'accueil' };
      return { mode: 'ticket', stage: p.stage === 'a_payer' ? 'a_payer' : 'saisie' };
    }
    case 'qr': {
      const qr = p.qr;
      if (qr && (qr.kind === 'stripe' || qr.kind === 'bancontact') && qr.url) {
        const exp = ms(qr.expires_at ?? null);
        if (exp != null && exp <= serverNowMs) return { mode: 'ticket', stage: 'a_payer' };
        return { mode: 'qr', qr, amount: amountToPay(p), payment: null };
      }
      // QR de virement sans reglement attendu (abandonne) : retour au montant a payer.
      return amountToPay(p) > 0 ? { mode: 'ticket', stage: 'a_payer' } : { mode: 'accueil' };
    }
    case 'terminal':
      return { mode: 'terminal', amount: amountToPay(p) };
    case 'signature':
      return p.signature && p.signature.text
        ? { mode: 'signature', signature: p.signature, signed: s.reply_kind === 'signature' }
        : { mode: 'accueil' };
    case 'merci': {
      const at = ms(s.mode_changed_at);
      const left = at == null ? thanksDurationMs(p) : at + thanksDurationMs(p) - serverNowMs;
      if (left <= 0) return { mode: 'accueil' };
      const amount = p.amount != null ? r2(num(p.amount)) : p.totals ? r2(num(p.totals.ttc)) : null;
      return { mode: 'merci', amount, allowEmail: !!p.allow_email, emailSent: s.reply_kind === 'email' || !!p.email_sent, remainingMs: left };
    }
    default:
      return { mode: 'accueil' };
  }
}

/** Lecture defensive du JSON renvoye par la base (customer_display_read / counter_display_state). */
export function parseSnapshot(raw: unknown): ScreenSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const bank = (r.bank ?? {}) as Record<string, unknown>;
  const pay = r.payment && typeof r.payment === 'object' ? (r.payment as Record<string, unknown>) : null;
  return {
    mode: isScreenMode(r.mode) ? r.mode : 'accueil',
    payload: (r.payload && typeof r.payload === 'object' ? r.payload : {}) as ScreenPayload,
    version: num(r.version),
    mode_changed_at: typeof r.mode_changed_at === 'string' ? r.mode_changed_at : null,
    reply_kind: typeof r.reply_kind === 'string' ? r.reply_kind : null,
    company_name: typeof r.company_name === 'string' ? r.company_name : '',
    bank: {
      beneficiary: typeof bank.beneficiary === 'string' ? bank.beneficiary : '',
      iban: typeof bank.iban === 'string' ? bank.iban : null,
      bic: typeof bank.bic === 'string' ? bank.bic : null,
    },
    payment: pay ? {
      id: String(pay.id ?? ''), status: (pay.status as string) ?? null, method: (pay.method as string) ?? null,
      amount: num(pay.amount), reference: (pay.reference as string) ?? null, received_at: (pay.received_at as string) ?? null,
      document_number: (pay.document_number as string) ?? null, customer_name: (pay.customer_name as string) ?? null,
    } : null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Langue, appairage, connexion
 * ---------------------------------------------------------------------------------------------- */

/** Langue de l ecran : celle du client si connue (I18N004), sinon celle choisie sur la tablette, sinon FR. */
export function screenLocale(customerLocale: unknown, chosen: unknown): Locale {
  if (isLocale(customerLocale)) return customerLocale;
  if (isLocale(chosen)) return chosen;
  return DEFAULT_LOCALE;
}

/** Le client peut-il changer la langue ? Seulement quand on ne connait pas la sienne. */
export const canChooseLocale = (customerLocale: unknown): boolean => !isLocale(customerLocale);

export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code saisi au comptoir : majuscules, sans espace ni tiret ; O lu comme 0 n existe pas, donc rien a corriger. */
export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isPairingCode(code: string): boolean {
  return code.length === 6 && [...code].every((c) => PAIRING_ALPHABET.includes(c));
}

/** Adresse du QR affiche par la tablette : ouvre la caisse avec le code pre-rempli. */
export function pairingUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/pos?ecran=${encodeURIComponent(code)}`;
}

/** Code d appairage lu dans l adresse de la caisse (?ecran=XXXXXX), ou null. */
export function pairingCodeFromSearch(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const c = normalizePairingCode(value);
  return isPairingCode(c) ? c : null;
}

export function deviceOnline(lastSeenAt: string | null | undefined, serverNow: string | number | null | undefined): boolean {
  const seen = ms(lastSeenAt ?? null);
  const now = typeof serverNow === 'number' ? serverNow : ms(serverNow ?? null);
  if (seen == null || now == null) return false;
  return now - seen <= ONLINE_WINDOW_MS;
}

export type ScreenLink = 'unavailable' | 'none' | 'offline' | 'online';

/** Etat du bouton « Ecran client » : base pas a jour / aucun appareil / deconnecte / connecte. */
export function screenLinkState(devices: { last_seen_at: string | null }[] | null | undefined, serverNow: string | null | undefined, available: boolean): ScreenLink {
  if (!available) return 'unavailable';
  if (!devices || devices.length === 0) return 'none';
  return devices.some((d) => deviceOnline(d.last_seen_at, serverNow)) ? 'online' : 'offline';
}

/** Adresse e-mail tapee sur la tablette (meme controle qu en base). */
export function isScreenEmail(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s.length <= 254 && /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s);
}

/** Etat renvoye a la tablette par customer_display_read. */
export type DeviceRead =
  | { status: 'unknown' | 'revoked' | 'expired' }
  | { status: 'pending'; code: string; expires_at: string; now: string }
  | { status: 'paired'; now: string; device: { name: string; register_code: string; channel: string }; screen: ScreenSnapshot };

export function parseDeviceRead(raw: unknown): DeviceRead {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.status === 'pending' && typeof r.code === 'string') {
    return { status: 'pending', code: r.code, expires_at: String(r.expires_at ?? ''), now: String(r.now ?? '') };
  }
  if (r.status === 'paired') {
    const d = (r.device ?? {}) as Record<string, unknown>;
    return {
      status: 'paired', now: String(r.now ?? ''),
      device: { name: String(d.name ?? ''), register_code: String(d.register_code ?? ''), channel: String(d.channel ?? '') },
      screen: parseSnapshot(r.screen) ?? parseSnapshot({})!,
    };
  }
  if (r.status === 'revoked' || r.status === 'expired') return { status: r.status };
  return { status: 'unknown' };
}

/** Que faire du jeton garde sur la tablette apres une lecture : le garder ou recommencer l appairage. */
export function keepDeviceToken(read: DeviceRead): boolean {
  return read.status === 'pending' || read.status === 'paired';
}
