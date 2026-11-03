/**
 * Mission 12, carte P3 -- PDV040 « Payer par QR (Bancontact / carte) » SANS SUPPLEMENT.
 * Regles pures de supabase/functions/_shared/stripe.ts : construction de la session Checkout
 * (montant exact, moyens, metadata, expiration, aucun supplement), mode de la cle, signature des
 * webhooks, decision par evenement, traitement complet avec un magasin en memoire qui reproduit
 * les fonctions SQL (_stripe_payment_settle / _stripe_payment_expire : idempotence par evenement,
 * attendu -> recu, expire -> annule). Aucun appel a Stripe. Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  buildCheckoutSessionParams, sessionTotalCents, expiresAtFor, stripeKeyMode, cleanMethods, returnUrls, safeOrigin,
  stripeSignatureHeader, verifyStripeSignature, stripeEventDecision, processStripeWebhook,
  EXPIRY_MIN_SECONDS, EXPIRY_MAX_SECONDS, type WebhookStore, type SettleResult, type ExpireResult,
} from '../supabase/functions/_shared/stripe.ts';
import {
  stripeStatusView, stripeMailtoLink, stripeSmsLink, stripeProposedAmount, stripeReasonKey,
} from '../src/modules/sales/stripe-pay-rules';

const IDS = {
  company: '3d9f0f13-a691-4d07-ad58-34590df86e33',
  document: 'fc8f2b9c-5bee-4afb-99cb-9016dae01934',
  payment: 'ee3c85de-be91-4cc9-85a1-6a1c0823c841',
};
const NOW = 1_793_700_000;

const input = (over: Partial<Parameters<typeof buildCheckoutSessionParams>[0]> = {}) => ({
  amount: 1234.56, documentNumber: 'FAC-2026-00042', companyId: IDS.company, documentId: IDS.document, paymentId: IDS.payment,
  methods: ['bancontact', 'card'], successUrl: 'https://dms.example/paiement/merci?ref=FAC-2026-00042',
  cancelUrl: 'https://dms.example/paiement/merci?ref=FAC-2026-00042&etat=annule', expiresAt: NOW + 1860, ...over,
});

// ---------------------------------------------------------------- Session Checkout

describe('session Stripe Checkout', () => {
  test('montant exact en centimes, une seule ligne, quantite 1, EUR', () => {
    const p = buildCheckoutSessionParams(input());
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('123456');
    expect(p.get('line_items[0][quantity]')).toBe('1');
    expect(p.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(p.has('line_items[1][quantity]')).toBe(false);
    expect(sessionTotalCents(p)).toBe(123456);
    expect(p.get('mode')).toBe('payment');
  });

  test('aucun supplement : le total demande au client est le montant du reglement, quel que soit le moyen', () => {
    for (const methods of [['bancontact'], ['card'], ['bancontact', 'card', 'wero']]) {
      for (const amount of [0.5, 10, 19.99, 605, 12_499.9]) {
        const p = buildCheckoutSessionParams(input({ amount, methods }));
        expect(sessionTotalCents(p)).toBe(Math.round(amount * 100));
      }
    }
    const keys = [...buildCheckoutSessionParams(input()).keys()];
    // ni frais, ni port, ni taxe automatique, ni remise / supplement de ligne
    expect(keys.some((k) => /shipping|automatic_tax|application_fee|surcharge|tax_rates|discounts|adjustable/.test(k))).toBe(false);
  });

  test('description et reference = numero du document ; metadata sur la session et sur le paiement', () => {
    const p = buildCheckoutSessionParams(input());
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('FAC-2026-00042');
    expect(p.get('client_reference_id')).toBe('FAC-2026-00042');
    expect(p.get('payment_intent_data[description]')).toBe('FAC-2026-00042');
    for (const prefix of ['metadata', 'payment_intent_data[metadata]']) {
      expect(p.get(`${prefix}[company_id]`)).toBe(IDS.company);
      expect(p.get(`${prefix}[document_id]`)).toBe(IDS.document);
      expect(p.get(`${prefix}[payment_id]`)).toBe(IDS.payment);
    }
  });

  test('moyens proposes : ceux du reglage, connus, sans doublon ; aucun -> refus', () => {
    const p = buildCheckoutSessionParams(input({ methods: ['card', 'bancontact', 'card', 'paypal'] }));
    expect(p.get('payment_method_types[0]')).toBe('bancontact');
    expect(p.get('payment_method_types[1]')).toBe('card');
    expect(p.has('payment_method_types[2]')).toBe(false);
    expect(cleanMethods(['WERO', 'card'])).toEqual(['card', 'wero']);
    expect(() => buildCheckoutSessionParams(input({ methods: ['paypal'] }))).toThrow('no_method');
  });

  test('montant minimum Stripe 0,50 EUR', () => {
    expect(() => buildCheckoutSessionParams(input({ amount: 0.49 }))).toThrow('amount_too_small');
    expect(() => buildCheckoutSessionParams(input({ amount: Number.NaN }))).toThrow('amount_too_small');
  });

  test('expiration : comptoir 30 min au moins, distance 24 h, toujours dans les limites Stripe', () => {
    expect(expiresAtFor('comptoir', NOW, 30) - NOW).toBe(EXPIRY_MIN_SECONDS);
    expect(expiresAtFor('comptoir', NOW, 10) - NOW).toBe(EXPIRY_MIN_SECONDS);
    expect(expiresAtFor('comptoir', NOW, 60) - NOW).toBe(3600);
    expect(expiresAtFor('comptoir', NOW, 5000) - NOW).toBe(EXPIRY_MAX_SECONDS);
    expect(expiresAtFor('distance', NOW) - NOW).toBe(EXPIRY_MAX_SECONDS);
    expect(EXPIRY_MIN_SECONDS).toBeGreaterThanOrEqual(30 * 60);
    expect(EXPIRY_MAX_SECONDS).toBeLessThanOrEqual(24 * 3600);
    expect(buildCheckoutSessionParams(input()).get('expires_at')).toBe(String(NOW + 1860));
  });

  test('retour vers la page publique merci, numero du document encode', () => {
    expect(returnUrls('https://dms.example/', 'TIK 1/2')).toEqual({
      successUrl: 'https://dms.example/paiement/merci?ref=TIK%201%2F2',
      cancelUrl: 'https://dms.example/paiement/merci?ref=TIK%201%2F2&etat=annule',
    });
    expect(safeOrigin('https://dms.example/sales/x')).toBe('https://dms.example');
    expect(safeOrigin('http://localhost:8080/pos')).toBe('http://localhost:8080');
    expect(safeOrigin('http://evil.example')).toBeNull();
    expect(safeOrigin('javascript:alert(1)')).toBeNull();
  });

  test('mode de la cle : test par defaut, live reconnu, le reste refuse', () => {
    expect(stripeKeyMode('sk_test_51AbCdEfGhIjKlMn')).toBe('test');
    expect(stripeKeyMode('rk_live_51AbCdEfGhIjKlMn')).toBe('live');
    expect(stripeKeyMode('pk_test_51AbCdEfGhIjKlMn')).toBeNull();
    expect(stripeKeyMode('')).toBeNull();
    expect(stripeKeyMode(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------- Signature

const SECRET = 'whsec_test_secret_for_unit_tests_only';

describe('signature des webhooks', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.expired' });

  test('signature correcte acceptee', async () => {
    const h = await stripeSignatureHeader(body, SECRET, NOW);
    expect(await verifyStripeSignature(body, h, SECRET, NOW + 10)).toEqual({ ok: true });
  });

  test('corps modifie, mauvais secret, trop vieux, en-tete absent ou mal forme : refuse', async () => {
    const h = await stripeSignatureHeader(body, SECRET, NOW);
    expect((await verifyStripeSignature(body + ' ', h, SECRET, NOW)).ok).toBe(false);
    expect((await verifyStripeSignature(body, h, 'whsec_autre', NOW)).ok).toBe(false);
    expect(await verifyStripeSignature(body, h, SECRET, NOW + 301)).toEqual({ ok: false, reason: 'too_old' });
    expect(await verifyStripeSignature(body, null, SECRET, NOW)).toEqual({ ok: false, reason: 'no_header' });
    expect(await verifyStripeSignature(body, 'v1=abc', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifyStripeSignature(body, h, '', NOW)).toEqual({ ok: false, reason: 'no_secret' });
  });

  test('plusieurs v1 (rotation du secret) : une seule correcte suffit', async () => {
    const good = (await stripeSignatureHeader(body, SECRET, NOW)).split(',')[1];
    expect((await verifyStripeSignature(body, `t=${NOW},v1=00ff,${good}`, SECRET, NOW)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------- Decision par evenement

const meta = { company_id: IDS.company, document_id: IDS.document, payment_id: IDS.payment };
const completed = (over: Record<string, unknown> = {}) => ({
  id: 'evt_completed', type: 'checkout.session.completed', livemode: false,
  data: { object: { id: 'cs_test_A', object: 'checkout.session', payment_status: 'paid', amount_total: 123456, currency: 'eur', payment_intent: 'pi_A', metadata: meta, ...over } },
});
const piSucceeded = () => ({
  id: 'evt_pi', type: 'payment_intent.succeeded', livemode: false,
  data: { object: { id: 'pi_A', object: 'payment_intent', amount_received: 123456, currency: 'eur', payment_method_types: ['bancontact'], metadata: meta } },
});
const expired = (id = 'evt_expired') => ({
  id, type: 'checkout.session.expired', livemode: false,
  data: { object: { id: 'cs_test_A', object: 'checkout.session', payment_status: 'unpaid', amount_total: 123456, currency: 'eur', metadata: meta } },
});

describe('decision par evenement', () => {
  test('session payee -> confirmer avec le montant reel', () => {
    expect(stripeEventDecision(completed())).toEqual({
      kind: 'settle', paymentId: IDS.payment, companyId: IDS.company, sessionId: 'cs_test_A', paymentIntent: 'pi_A',
      amountCents: 123456, methodType: null, livemode: false,
    });
  });
  test('payment_intent.succeeded -> confirmer (moyen connu)', () => {
    const d = stripeEventDecision(piSucceeded());
    expect(d.kind).toBe('settle');
    if (d.kind === 'settle') { expect(d.methodType).toBe('bancontact'); expect(d.paymentIntent).toBe('pi_A'); }
  });
  test('session terminee mais pas encore payee (moyen differe) -> on attend', () => {
    expect(stripeEventDecision(completed({ payment_status: 'unpaid' }))).toEqual({ kind: 'ignore', reason: 'not_paid_yet' });
  });
  test('expiree -> annuler ; evenement etranger au DMS ou autre type -> ignorer', () => {
    expect(stripeEventDecision(expired()).kind).toBe('expire');
    expect(stripeEventDecision(completed({ metadata: {} }))).toEqual({ kind: 'ignore', reason: 'not_ours' });
    expect(stripeEventDecision({ id: 'evt_x', type: 'charge.refunded', data: { object: {} } })).toEqual({ kind: 'ignore', reason: 'type' });
    expect(stripeEventDecision(completed({ currency: 'usd' }))).toEqual({ kind: 'ignore', reason: 'currency' });
  });
});

// ---------------------------------------------------------------- Webhook complet (magasin en memoire)

type Pay = { id: string; session: string; status: 'attendu' | 'recu' | 'annule'; amount: number; fee: number | null };

/** Reproduit _stripe_payment_settle / _stripe_payment_expire (migration 20261103260000). */
function memoryStore(pay: Pay, fee: number | null = 35) {
  const seen = new Map<string, string>();
  const events: string[] = [];
  let paid = 0;
  const find = (pid: string | null, sid: string | null) => (pid === pay.id || (sid && sid === pay.session) ? pay : null);
  const store: WebhookStore = {
    async settle(a): Promise<SettleResult> {
      const p = find(a.paymentId, a.sessionId);
      if (!p) return 'unknown';
      if (seen.has(a.eventId)) return 'duplicate';
      let res: SettleResult;
      if (p.status === 'recu') {
        if (p.fee === null && a.feeCents !== null) p.fee = a.feeCents / 100;
        res = 'already';
      } else {
        p.status = 'recu'; p.amount = a.amountCents === null ? p.amount : a.amountCents / 100;
        p.fee = a.feeCents === null ? p.fee : a.feeCents / 100;
        paid += p.amount; events.push('stripe_payment_received'); res = 'received';
      }
      seen.set(a.eventId, res);
      return res;
    },
    async expire(a): Promise<ExpireResult> {
      const p = find(a.paymentId, a.sessionId);
      if (!p) return 'unknown';
      if (seen.has(a.eventId)) return 'duplicate';
      let res: ExpireResult = 'already';
      if (p.status === 'attendu') { p.status = 'annule'; events.push('stripe_payment_expired'); res = 'cancelled'; }
      seen.set(a.eventId, res);
      return res;
    },
    async paymentDetails() { return { feeCents: fee, methodType: 'bancontact' }; },
  };
  return { store, events, paid: () => paid };
}

async function deliver(store: WebhookStore, ev: unknown, opts: { secret?: string; t?: number; tamper?: boolean } = {}) {
  const raw = JSON.stringify(ev);
  const t = opts.t ?? NOW;
  const sig = await stripeSignatureHeader(raw, opts.secret ?? SECRET, t);
  return processStripeWebhook({ rawBody: opts.tamper ? raw.replace('123456', '1') : raw, signature: sig, secret: SECRET, nowSec: NOW }, store);
}

describe('webhook stripe : signature, idempotence, attendu -> recu, expire -> annule', () => {
  test('signature fausse : 400, rien ne change ; secret non pose : 503', async () => {
    const pay: Pay = { id: IDS.payment, session: 'cs_test_A', status: 'attendu', amount: 1234.56, fee: null };
    const m = memoryStore(pay);
    expect((await deliver(m.store, completed(), { secret: 'whsec_pirate' })).status).toBe(400);
    expect((await deliver(m.store, completed(), { tamper: true })).status).toBe(400);
    expect(pay.status).toBe('attendu');
    const raw = JSON.stringify(completed());
    const out = await processStripeWebhook({ rawBody: raw, signature: await stripeSignatureHeader(raw, SECRET, NOW), secret: undefined, nowSec: NOW }, m.store);
    expect(out.status).toBe(503);
    expect(pay.status).toBe('attendu');
  });

  test('attendu -> recu avec le montant reel et les frais Stripe notes a part', async () => {
    const pay: Pay = { id: IDS.payment, session: 'cs_test_A', status: 'attendu', amount: 1234.56, fee: null };
    const m = memoryStore(pay, 1877);
    const out = await deliver(m.store, completed());
    expect(out).toEqual({ status: 200, body: { result: 'received' } });
    expect(pay.status).toBe('recu');
    expect(pay.amount).toBe(1234.56);          // le client paie le montant du document, pas plus
    expect(pay.fee).toBe(18.77);               // 1,5 % + 0,25 EUR : a charge du magasin
  });

  test('meme evenement deux fois = une fois ; session terminee + paiement reussi = un seul encaissement', async () => {
    const pay: Pay = { id: IDS.payment, session: 'cs_test_A', status: 'attendu', amount: 1234.56, fee: null };
    const m = memoryStore(pay);
    expect((await deliver(m.store, completed())).body).toEqual({ result: 'received' });
    expect((await deliver(m.store, completed())).body).toEqual({ result: 'duplicate' });
    expect((await deliver(m.store, piSucceeded())).body).toEqual({ result: 'already' });
    expect(m.paid()).toBe(1234.56);
    expect(m.events).toEqual(['stripe_payment_received']);
  });

  test('session expiree -> annule (une fois) ; un paiement recu ne s annule jamais', async () => {
    const pay: Pay = { id: IDS.payment, session: 'cs_test_A', status: 'attendu', amount: 50, fee: null };
    const m = memoryStore(pay);
    expect((await deliver(m.store, expired())).body).toEqual({ result: 'cancelled' });
    expect(pay.status).toBe('annule');
    expect((await deliver(m.store, expired())).body).toEqual({ result: 'duplicate' });

    const paidPay: Pay = { id: IDS.payment, session: 'cs_test_A', status: 'attendu', amount: 50, fee: null };
    const m2 = memoryStore(paidPay);
    await deliver(m2.store, completed({ amount_total: 5000 }));
    expect((await deliver(m2.store, expired('evt_late'))).body).toEqual({ result: 'already' });
    expect(paidPay.status).toBe('recu');
  });

  test('evenement non lie au DMS ou pas encore paye : 200 sans rien toucher', async () => {
    const pay: Pay = { id: IDS.payment, session: 'cs_test_A', status: 'attendu', amount: 10, fee: null };
    const m = memoryStore(pay);
    expect((await deliver(m.store, completed({ metadata: {} }))).body).toEqual({ ignored: 'not_ours' });
    expect((await deliver(m.store, completed({ payment_status: 'unpaid' }))).body).toEqual({ ignored: 'not_paid_yet' });
    expect(pay.status).toBe('attendu');
  });
});

// ---------------------------------------------------------------- Ecran : statut, liens, montants

describe('ecran : statut en direct, lien a distance, montants', () => {
  test('statut = couleur + icone + libelle', () => {
    expect(stripeStatusView('attendu')).toMatchObject({ tone: 'warning', labelKey: 'stripePay.statusPending' });
    expect(stripeStatusView('recu')).toMatchObject({ tone: 'success', labelKey: 'stripePay.statusPaid' });
    expect(stripeStatusView('annule')).toMatchObject({ tone: 'neutral', labelKey: 'stripePay.statusCancelled' });
    for (const s of ['attendu', 'recu', 'annule'] as const) expect(stripeStatusView(s).icon).toBeTruthy();
  });

  test('montant propose : reste a payer, acompte 10 %, libre -- jamais majore', () => {
    expect(stripeProposedAmount('solde', 605.0, 605.0, 0)).toBe(605);
    expect(stripeProposedAmount('acompte10', 8000, 12_990, 0)).toBe(1299);
    expect(stripeProposedAmount('acompte10', 500, 12_990, 0)).toBe(500);
    expect(stripeProposedAmount('libre', 605, 605, 99.999)).toBe(100);
  });

  test('mail et SMS : lien et montant, sans aucun frais', () => {
    const mail = stripeMailtoLink({ to: 'client@exemple.be', url: 'https://checkout.stripe.com/c/pay/cs_test_A', amount: 1299, documentNumber: 'RES-2026-00001', company: 'ITALBIKE STORE' });
    expect(mail.startsWith('mailto:client%40exemple.be?subject=')).toBe(true);
    const decoded = decodeURIComponent(mail);
    expect(decoded).toContain('https://checkout.stripe.com/c/pay/cs_test_A');
    expect(decoded).toContain('1299,00');
    expect(decoded).toContain('RES-2026-00001');
    expect(decoded.toLowerCase()).not.toMatch(/frais|supplement|supplément|%/);
    const sms = stripeSmsLink({ phone: '+32 470 00 00 00', url: 'https://checkout.stripe.com/c/pay/cs_test_A', amount: 10, documentNumber: 'TIK-1', company: 'ITALBIKE STORE' });
    expect(sms.startsWith('sms:+32470000000?body=')).toBe(true);
  });

  test('raison d indisponibilite -> message', () => {
    expect(stripeReasonKey('no_key')).toBe('stripePay.unavailableNoKey');
    expect(stripeReasonKey('disabled')).toBe('stripePay.unavailableDisabled');
    expect(stripeReasonKey('mode_mismatch')).toBe('stripePay.unavailableMode');
    expect(stripeReasonKey(null)).toBeNull();
  });
});

describe('sources : aucune cle Stripe, aucun supplement', () => {
  test('aucune cle secrete ni secret de webhook dans le code', () => {
    for (const f of ['../supabase/functions/stripe-checkout/index.ts', '../supabase/functions/stripe-webhook/index.ts',
                     '../supabase/functions/_shared/stripe.ts', '../src/modules/sales/stripe-pay-card.tsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src.match(/(sk|rk)_(test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/g) ?? []).toEqual([]);
    }
  });
  test('aucun supplement ni frais ajoute au montant dans la migration et les fonctions', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261103260000_m6_paiement_stripe.sql', import.meta.url), 'utf8');
    expect(sql).toContain("insert into public.document_payments (document_id, method, amount, status, note, stripe_channel, requested_by)");
    expect(/amt\s*\*\s*1\.0?5|\+\s*fee|amount\s*\+\s*stripe_fee/i.test(sql)).toBe(false);
  });
});
