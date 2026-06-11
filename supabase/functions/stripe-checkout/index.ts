// M11 — Edge Function : crée une session Stripe Checkout pour une commande web.
// Secrets requis (à fournir par le client) : STRIPE_SECRET_KEY.
// Appelée par le storefront public (verify_jwt = false). Le passage de la commande
// en « payée » + la facture se font via la fonction `stripe-webhook` (à venir).
//
// Déploiement : supabase functions deploy stripe-checkout
//               supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    // Stripe pas encore configuré → 501, le front retombe sur « paiement hors-ligne ».
    return new Response(JSON.stringify({ error: 'stripe_not_configured' }), { status: 501, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  try {
    const { orderId, amount, email, returnUrl } = await req.json();
    const base = (returnUrl || 'https://example.com').split('?')[0];
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('success_url', `${base}?paid=1&order=${orderId}`);
    form.set('cancel_url', `${base}?canceled=1`);
    if (email) form.set('customer_email', email);
    form.set('client_reference_id', orderId);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', 'eur');
    form.set('line_items[0][price_data][product_data][name]', `Commande ${orderId}`);
    form.set('line_items[0][price_data][unit_amount]', String(Math.round(Number(amount) * 100)));

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const session = await res.json();
    if (!res.ok) return new Response(JSON.stringify({ error: session?.error?.message ?? 'stripe_error' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ url: session.url, id: session.id }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
