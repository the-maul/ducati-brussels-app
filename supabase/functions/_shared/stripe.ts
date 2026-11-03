// Mission 12, carte P3 -- PDV040 « Payer par QR (Bancontact / carte) », SANS SUPPLEMENT.
// Regles pures partagees par les fonctions Edge `stripe-checkout` et `stripe-webhook` (et les tests bun) :
//   - construction de la session Stripe Checkout : montant EXACT du reglement (aucun supplement, art.
//     VII.30 par. 3 CDE), une seule ligne, devise EUR, description = numero du document, metadata
//     (company_id, document_id, payment_id), moyens choisis dans Parametres, expiration ;
//   - mode de la cle (sk_test_ / sk_live_) ;
//   - signature des webhooks (en-tete Stripe-Signature : t=..., v1=HMAC-SHA256 hex de « t.corps ») ;
//   - lecture d un evenement -> decision (confirmer / annuler / ignorer) ;
//   - traitement complet d un webhook avec un « magasin » injecte (la base en production, une
//     memoire dans les tests). L idempotence reelle est en base (table stripe_events).
// Aucun appel reseau ici. WebCrypto seulement (Deno et bun).
// deno-lint-ignore-file

export const STRIPE_METHODS = ['bancontact', 'card', 'wero'] as const;
export type StripeMethod = (typeof STRIPE_METHODS)[number];
export type StripeChannel = 'comptoir' | 'distance';
export type StripeKeyMode = 'test' | 'live';

/** Montant minimum accepte par Stripe en EUR. */
export const STRIPE_MIN_EUR = 0.5;
/** Limites Stripe de `expires_at` : 30 min a 24 h apres la creation (marges incluses). */
export const EXPIRY_MIN_SECONDS = 30 * 60 + 60;
export const EXPIRY_MAX_SECONDS = 24 * 3600 - 120;
/** Tolerance de l horodatage d un webhook (valeur par defaut des bibliotheques Stripe). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Mode d une cle Stripe d apres son prefixe ; null si ce n est pas une cle secrete Stripe. */
export function stripeKeyMode(key: string | null | undefined): StripeKeyMode | null {
  const k = (key ?? '').trim();
  if (/^(sk|rk)_test_[A-Za-z0-9]{8,}$/.test(k)) return 'test';
  if (/^(sk|rk)_live_[A-Za-z0-9]{8,}$/.test(k)) return 'live';
  return null;
}

/** EUR -> centimes (entier). */
export const toCents = (eur: number): number => Math.round(eur * 100);

/** Moyens retenus : connus, sans doublon, dans l ordre de STRIPE_METHODS ; au moins un. */
export function cleanMethods(methods: readonly string[] | null | undefined): StripeMethod[] {
  const set = new Set((methods ?? []).map((m) => String(m).trim().toLowerCase()));
  return STRIPE_METHODS.filter((m) => set.has(m));
}

/** Expiration (secondes Unix) : comptoir = duree reglee (30 min au moins), distance = 24 h. */
export function expiresAtFor(channel: StripeChannel, nowSec: number, counterMinutes = 30): number {
  const wanted = channel === 'distance' ? EXPIRY_MAX_SECONDS : Math.round(counterMinutes * 60);
  return Math.floor(nowSec) + Math.min(Math.max(wanted, EXPIRY_MIN_SECONDS), EXPIRY_MAX_SECONDS);
}

export type CheckoutInput = {
  amount: number;              // EUR, montant exact du reglement attendu
  documentNumber: string;
  companyId: string;
  documentId: string;
  paymentId: string;
  methods: readonly string[];
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;           // secondes Unix
  locale?: string;
};

/**
 * Parametres de POST /v1/checkout/sessions (form-urlencoded).
 * AUCUN SUPPLEMENT : une seule ligne, quantite 1, du montant exact ; pas de frais, pas de port, pas
 * de taxe automatique ; les frais Stripe restent a charge du magasin.
 */
export function buildCheckoutSessionParams(i: CheckoutInput): URLSearchParams {
  if (!Number.isFinite(i.amount) || i.amount < STRIPE_MIN_EUR) throw new Error('amount_too_small');
  if (i.amount > 999_999.99) throw new Error('amount_too_large');
  const cents = toCents(i.amount);
  const methods = cleanMethods(i.methods);
  if (methods.length === 0) throw new Error('no_method');
  const label = (i.documentNumber || '').trim() || 'Paiement';
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('submit_type', 'pay');
  p.set('locale', i.locale || 'auto');
  p.set('client_reference_id', label.slice(0, 200));
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'eur');
  p.set('line_items[0][price_data][unit_amount]', String(cents));
  p.set('line_items[0][price_data][product_data][name]', label.slice(0, 250));
  methods.forEach((m, n) => p.set(`payment_method_types[${n}]`, m));
  const meta = { company_id: i.companyId, document_id: i.documentId, payment_id: i.paymentId, document_number: label };
  for (const [k, v] of Object.entries(meta)) {
    p.set(`metadata[${k}]`, v);
    p.set(`payment_intent_data[metadata][${k}]`, v);
  }
  p.set('payment_intent_data[description]', label.slice(0, 1000));
  p.set('success_url', i.successUrl);
  p.set('cancel_url', i.cancelUrl);
  p.set('expires_at', String(Math.floor(i.expiresAt)));
  return p;
}

/** Montant total demande par une session (centimes) : la somme de ses lignes. */
export function sessionTotalCents(p: URLSearchParams): number {
  let total = 0;
  for (let n = 0; p.has(`line_items[${n}][quantity]`); n++) {
    total += Number(p.get(`line_items[${n}][quantity]`)) * Number(p.get(`line_items[${n}][price_data][unit_amount]`));
  }
  return total;
}

/** Adresses de retour (page publique « merci »). */
export function returnUrls(baseUrl: string, documentNumber: string): { successUrl: string; cancelUrl: string } {
  const base = baseUrl.replace(/\/+$/, '');
  const ref = encodeURIComponent(documentNumber || '');
  return { successUrl: `${base}/paiement/merci?ref=${ref}`, cancelUrl: `${base}/paiement/merci?ref=${ref}&etat=annule` };
}

/** Origine http(s) acceptable pour les retours (sinon null). */
export function safeOrigin(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return null;
    return u.origin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Signature des webhooks

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** HMAC-SHA256 hex de « t.corps » avec le secret du webhook (whsec_... tel quel). */
export async function stripeSignature(rawBody: string, secret: string, t: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  return hex(new Uint8Array(sig));
}

/** En-tete Stripe-Signature (pour les tests et la simulation). */
export async function stripeSignatureHeader(rawBody: string, secret: string, t: number): Promise<string> {
  return `t=${t},v1=${await stripeSignature(rawBody, secret, t)}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: 'no_secret' | 'no_header' | 'malformed' | 'too_old' | 'mismatch' };

/** Le webhook vient-il bien de Stripe ? Ferme par defaut (secret ou en-tete absent : non). */
export async function verifyStripeSignature(
  rawBody: string, header: string | null | undefined, secret: string | null | undefined,
  nowSec: number, tolerance = SIGNATURE_TOLERANCE_SECONDS,
): Promise<SignatureCheck> {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!header) return { ok: false, reason: 'no_header' };
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const [k, ...rest] = part.trim().split('=');
    const v = rest.join('=');
    if (k === 't' && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && v) v1.push(v);
  }
  if (t === null || v1.length === 0) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSec - t) > tolerance) return { ok: false, reason: 'too_old' };
  const expected = await stripeSignature(rawBody, secret, t);
  return v1.some((s) => sameText(s, expected)) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

// ---------------------------------------------------------------- Evenements -> decision

export type StripeEvent = { id: string; type: string; livemode?: boolean; data?: { object?: any } };

export type StripeDecision =
  | { kind: 'settle'; paymentId: string | null; companyId: string | null; sessionId: string | null; paymentIntent: string | null;
      amountCents: number | null; methodType: string | null; livemode: boolean }
  | { kind: 'expire'; paymentId: string | null; companyId: string | null; sessionId: string | null }
  | { kind: 'ignore'; reason: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Ce que l on fait d un evenement Stripe :
 *   checkout.session.completed (paye) / async_payment_succeeded / payment_intent.succeeded -> settle ;
 *   checkout.session.completed non paye (moyen differe) -> on attend l evenement suivant ;
 *   checkout.session.expired / async_payment_failed -> expire (reglement annule) ;
 *   le reste, ou un evenement sans notre payment_id (pas lance par le DMS) -> ignore.
 */
export function stripeEventDecision(ev: StripeEvent): StripeDecision {
  const o = ev?.data?.object ?? {};
  const meta = (o && typeof o.metadata === 'object' && o.metadata) || {};
  const paymentId = str(meta.payment_id);
  const companyId = str(meta.company_id);
  const livemode = ev?.livemode === true || o?.livemode === true;
  const currency = str(o.currency)?.toLowerCase() ?? 'eur';
  switch (ev?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (!paymentId) return { kind: 'ignore', reason: 'not_ours' };
      if (o.payment_status !== 'paid') return { kind: 'ignore', reason: 'not_paid_yet' };
      if (currency !== 'eur') return { kind: 'ignore', reason: 'currency' };
      return {
        kind: 'settle', paymentId, companyId, sessionId: str(o.id),
        paymentIntent: typeof o.payment_intent === 'string' ? o.payment_intent : str(o.payment_intent?.id),
        amountCents: Number.isFinite(Number(o.amount_total)) ? Number(o.amount_total) : null,
        methodType: null, livemode,
      };
    }
    case 'payment_intent.succeeded': {
      if (!paymentId) return { kind: 'ignore', reason: 'not_ours' };
      if (currency !== 'eur') return { kind: 'ignore', reason: 'currency' };
      const amt = Number(o.amount_received ?? o.amount);
      const types: unknown = o.payment_method_types;
      return {
        kind: 'settle', paymentId, companyId, sessionId: null, paymentIntent: str(o.id),
        amountCents: Number.isFinite(amt) ? amt : null,
        methodType: Array.isArray(types) && types.length === 1 ? String(types[0]) : null, livemode,
      };
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      if (!paymentId) return { kind: 'ignore', reason: 'not_ours' };
      return { kind: 'expire', paymentId, companyId, sessionId: str(o.id) };
    default:
      return { kind: 'ignore', reason: 'type' };
  }
}

// ---------------------------------------------------------------- Traitement d un webhook

export type SettleResult = 'received' | 'duplicate' | 'already' | 'unknown';
export type ExpireResult = 'cancelled' | 'duplicate' | 'already' | 'unknown';

/** Acces aux donnees (base en production, memoire dans les tests). */
export type WebhookStore = {
  settle(a: { eventId: string; eventType: string; paymentId: string | null; sessionId: string | null; paymentIntent: string | null;
              amountCents: number | null; feeCents: number | null; methodType: string | null; livemode: boolean }): Promise<SettleResult>;
  expire(a: { eventId: string; eventType: string; paymentId: string | null; sessionId: string | null }): Promise<ExpireResult>;
  /** Frais Stripe et moyen reel du paiement (best effort : null si indisponible). */
  paymentDetails?(paymentIntent: string): Promise<{ feeCents: number | null; methodType: string | null } | null>;
};

export type WebhookOutcome = { status: number; body: Record<string, unknown> };

export async function processStripeWebhook(
  input: { rawBody: string; signature: string | null; secret: string | null | undefined; nowSec: number },
  store: WebhookStore,
): Promise<WebhookOutcome> {
  const check = await verifyStripeSignature(input.rawBody, input.signature, input.secret, input.nowSec);
  if (!check.ok) return { status: check.reason === 'no_secret' ? 503 : 400, body: { error: 'signature', reason: check.reason } };
  let ev: StripeEvent;
  try { ev = JSON.parse(input.rawBody); } catch { return { status: 400, body: { error: 'json' } }; }
  if (!str(ev?.id) || !str(ev?.type)) return { status: 400, body: { error: 'event' } };
  const d = stripeEventDecision(ev);
  if (d.kind === 'ignore') return { status: 200, body: { ignored: d.reason } };
  if (d.kind === 'expire') {
    const result = await store.expire({ eventId: ev.id, eventType: ev.type, paymentId: d.paymentId, sessionId: d.sessionId });
    return { status: 200, body: { result } };
  }
  let feeCents: number | null = null;
  let methodType = d.methodType;
  if (d.paymentIntent && store.paymentDetails) {
    try {
      const det = await store.paymentDetails(d.paymentIntent);
      feeCents = det?.feeCents ?? null;
      methodType = det?.methodType ?? methodType;
    } catch { /* frais completes au prochain evenement */ }
  }
  const result = await store.settle({
    eventId: ev.id, eventType: ev.type, paymentId: d.paymentId, sessionId: d.sessionId, paymentIntent: d.paymentIntent,
    amountCents: d.amountCents, feeCents, methodType, livemode: d.livemode,
  });
  return { status: 200, body: { result } };
}
