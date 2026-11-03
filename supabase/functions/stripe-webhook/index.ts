// Mission 12, carte P3 -- PDV040 : confirmation automatique des paiements par QR Stripe.
//
// Appelee par Stripe uniquement (URL a declarer dans le tableau de bord Stripe, Developpeurs ->
// Webhooks : <SUPABASE_URL>/functions/v1/stripe-webhook ; evenements checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
// checkout.session.expired, payment_intent.succeeded).
//   - signature Stripe-Signature verifiee avec le secret STRIPE_WEBHOOK_SECRET (whsec_...), horodatage
//     a 5 min pres ; sans secret : 503 (ferme par defaut), signature fausse : 400 ;
//   - paiement reussi -> reglement `attendu` -> `recu` (montant reel, frais Stripe notes a part,
//     jamais factures au client), trace `events`, ecran client « merci » (_stripe_payment_settle) ;
//   - session expiree -> reglement `annule` (_stripe_payment_expire) ;
//   - idempotent : un evenement deja traite (table stripe_events) ne fait plus rien ; les deux
//     evenements d un meme paiement (session terminee + paiement reussi) ne comptent qu une fois.
// Les frais Stripe sont relus sur le paiement (balance_transaction.fee) avec STRIPE_SECRET_KEY,
// au mieux : s ils manquent, le second evenement les complete.
// deno-lint-ignore-file
import { processStripeWebhook, type WebhookStore } from '../_shared/stripe.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

const SB_URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${txt.slice(0, 300)}`);
  return (txt ? JSON.parse(txt) : null) as T;
}

const store: WebhookStore = {
  settle: (a) => rpc('_stripe_payment_settle', {
    _event_id: a.eventId, _event_type: a.eventType, _payment: a.paymentId, _session_id: a.sessionId,
    _payment_intent: a.paymentIntent, _amount_cents: a.amountCents, _fee_cents: a.feeCents,
    _method_type: a.methodType, _livemode: a.livemode,
  }),
  expire: (a) => rpc('_stripe_payment_expire', {
    _event_id: a.eventId, _event_type: a.eventType, _payment: a.paymentId, _session_id: a.sessionId,
  }),
  async paymentDetails(pi) {
    const key = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').trim();
    if (!key) return null;
    const r = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(pi)}?expand[]=latest_charge.balance_transaction`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => null);
    const charge = j?.latest_charge;
    const fee = Number(charge?.balance_transaction?.fee);
    return {
      feeCents: Number.isFinite(fee) ? fee : null,
      methodType: typeof charge?.payment_method_details?.type === 'string' ? charge.payment_method_details.type : null,
    };
  },
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return J({ error: 'method' }, 405);
  if (!SB_URL || !SVC) return J({ error: 'not_configured' }, 501);
  const rawBody = await req.text();
  try {
    const out = await processStripeWebhook({
      rawBody, signature: req.headers.get('stripe-signature'),
      secret: Deno.env.get('STRIPE_WEBHOOK_SECRET'), nowSec: Math.floor(Date.now() / 1000),
    }, store);
    return J(out.body, out.status);
  } catch (e) {
    // Erreur de base : 500, Stripe reessaiera (l idempotence evite tout double encaissement).
    return J({ error: 'failed', message: (e as Error).message.slice(0, 300) }, 500);
  }
});
