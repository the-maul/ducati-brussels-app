// M11 — Edge Function : webhook Stripe. Vérifie la signature de l'événement, puis
// finalise la commande web payée (facture + sortie de stock réel) via la RPC
// `finalize_web_order`. On NE simule plus : le paiement boucle jusqu'à « payée ».
//
// Secrets requis :
//   STRIPE_WEBHOOK_SECRET  (whsec_… — donné par Stripe à la création de l'endpoint)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injectés automatiquement par Supabase)
//
// Déploiement :
//   supabase functions deploy stripe-webhook
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// Puis déclarer l'URL de la fonction comme endpoint webhook dans le dashboard Stripe
// (événement checkout.session.completed).
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const enc = new TextEncoder();

/** Compare deux chaînes hex en temps constant (anti timing-attack). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Vérifie la signature Stripe (`Stripe-Signature: t=..,v1=..`) par HMAC-SHA256 sur
 * `${t}.${payload}` avec le secret du webhook. Rejette hors tolérance de 5 min.
 */
async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  // Tolérance temporelle (5 min) — rejette les rejeux anciens.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  return timingSafeEqual(toHex(sig), v1);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return new Response(JSON.stringify({ error: 'webhook_not_configured' }), { status: 501, headers: { 'Content-Type': 'application/json' } });

  const sigHeader = req.headers.get('Stripe-Signature');
  const body = await req.text(); // brut : indispensable pour la signature
  if (!sigHeader || !(await verifyStripeSignature(body, sigHeader, secret))) {
    return new Response(JSON.stringify({ error: 'invalid_signature' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let event: any;
  try { event = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }

  // On ne traite que la session de paiement réussie.
  if (event?.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true, ignored: event?.type }), { headers: { 'Content-Type': 'application/json' } });
  }
  const session = event.data?.object ?? {};
  const orderId: string | undefined = session.client_reference_id;
  if (session.payment_status && session.payment_status !== 'paid') {
    return new Response(JSON.stringify({ received: true, not_paid: session.payment_status }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (!orderId) return new Response(JSON.stringify({ error: 'no_order_ref' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Finalisation via la RPC (idempotente) avec la clé service role.
  const url = Deno.env.get('SUPABASE_URL');
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${url}/rest/v1/rpc/finalize_web_order`, {
    method: 'POST',
    headers: { apikey: svc!, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _order: orderId, _method: 'CB' }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return new Response(JSON.stringify({ error: 'finalize_failed', detail }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const documentId = await res.json();
  return new Response(JSON.stringify({ received: true, order: orderId, document_id: documentId }), { headers: { 'Content-Type': 'application/json' } });
});
