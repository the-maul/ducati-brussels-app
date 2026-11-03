// Mission 12, carte P3 -- PDV040 « Payer par QR (Bancontact / carte) » SANS SUPPLEMENT.
//
// Appelee par le panneau de reglement (utilisateur connecte, membre actif de la societe) :
//   { action: 'status', company_id }                         -> cle posee ? mode de la cle, reglage societe ;
//   { action: 'create', company_id, document_id, amount, channel: 'comptoir' | 'distance', origin }
//        -> reglement ATTENDU mode STRIPE (fonction SQL _stripe_payment_begin), puis session Stripe
//           Checkout du MONTANT EXACT (une ligne, EUR, description = numero du document, metadata
//           company_id / document_id / payment_id, retour vers la page publique /paiement/merci),
//           puis reference et lien gardes sur le reglement (_stripe_payment_attach). Echec Stripe :
//           le reglement attendu est annule (_stripe_payment_abort) ;
//   { action: 'cancel', company_id, payment_id, reason }    -> session expiree chez Stripe puis reglement annule.
//
// Cle secrete : secret Supabase STRIPE_SECRET_KEY (jamais dans le code). Mode test par defaut : le
// reglage societe (test / live) doit correspondre au prefixe de la cle (sk_test_ / sk_live_), sinon
// rien ne part. Sans cle : { configured: false } et l ecran masque le bouton avec un message.
// Aucun mail envoye ici : le lien « a distance » est rendu a l ecran, le vendeur l envoie lui-meme.
// deno-lint-ignore-file
import { identify, isActiveMember, isUuid } from '../_shared/acces.ts';
import {
  buildCheckoutSessionParams, expiresAtFor, returnUrls, safeOrigin, stripeKeyMode, cleanMethods,
  type StripeChannel,
} from '../_shared/stripe.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SB_URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_KEY = () => (Deno.env.get('STRIPE_SECRET_KEY') ?? '').trim();
const APP_URL = () => safeOrigin(Deno.env.get('APP_PUBLIC_URL') ?? '');

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  if (!r.ok) {
    let msg = txt.slice(0, 400);
    try { msg = JSON.parse(txt)?.message ?? msg; } catch { /* texte brut */ }
    throw new Error(msg);
  }
  return (txt ? JSON.parse(txt) : null) as T;
}

async function stripe(path: string, init: { method?: string; body?: URLSearchParams; idempotencyKey?: string } = {}): Promise<any> {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${STRIPE_KEY()}`,
      ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body?.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j?.error?.message ?? `stripe ${r.status}`) as Error & { code?: string; status?: number };
    e.code = j?.error?.code; e.status = r.status;
    throw e;
  }
  return j;
}

type Settings = { enabled: boolean; methods: string[]; mode: 'test' | 'live'; counter_minutes: number; updated_at: string | null };

async function settingsOf(companyId: string): Promise<Settings> {
  const rows = await rpc<Settings[]>('stripe_settings_get', { _company: companyId });
  return rows?.[0] ?? { enabled: false, methods: ['bancontact', 'card'], mode: 'test', counter_minutes: 30, updated_at: null };
}

/** Pret a encaisser ? (cle posee, du bon mode, reglage active) -- sinon la raison, pour l ecran. */
function readiness(s: Settings): { ready: boolean; reason: string | null; keyMode: 'test' | 'live' | null } {
  const keyMode = stripeKeyMode(STRIPE_KEY());
  if (!keyMode) return { ready: false, reason: 'no_key', keyMode };
  if (!s.enabled) return { ready: false, reason: 'disabled', keyMode };
  if (s.mode !== keyMode) return { ready: false, reason: 'mode_mismatch', keyMode };
  if (cleanMethods(s.methods).length === 0) return { ready: false, reason: 'no_method', keyMode };
  return { ready: true, reason: null, keyMode };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return J({ error: 'method' }, 405);
  if (!SB_URL || !SVC) return J({ error: 'not_configured' }, 501);

  const caller = await identify(req);
  if (!caller || caller.kind !== 'user') return J({ error: 'not_signed_in' }, 401);
  const body = await req.json().catch(() => ({}));
  const companyId = body?.company_id;
  if (!isUuid(companyId) || !(await isActiveMember(caller.id, companyId))) return J({ error: 'forbidden' }, 403);

  try {
    const s = await settingsOf(companyId);
    const ready = readiness(s);

    if (body.action === 'status') {
      return J({
        ok: true, configured: ready.keyMode !== null, key_mode: ready.keyMode, ready: ready.ready, reason: ready.reason,
        settings: { enabled: s.enabled, methods: cleanMethods(s.methods), mode: s.mode, counter_minutes: s.counter_minutes },
        webhook_url: `${SB_URL}/functions/v1/stripe-webhook`,
      });
    }

    if (body.action === 'create') {
      if (!ready.ready) return J({ ok: false, error: ready.reason }, 409);
      if (!isUuid(body.document_id)) return J({ error: 'document_id' }, 400);
      const channel: StripeChannel = body.channel === 'distance' ? 'distance' : 'comptoir';
      const amount = Number(body.amount);
      if (!Number.isFinite(amount)) return J({ error: 'amount' }, 400);
      const base = APP_URL() ?? safeOrigin(body.origin) ?? safeOrigin(req.headers.get('origin'));
      if (!base) return J({ error: 'origin' }, 400);

      // 1. Reglement attendu (controles : societe, document, reste a payer, QR deja en attente).
      const begun = await rpc<any>('_stripe_payment_begin', { _actor: caller.id, _document: body.document_id, _amount: amount, _channel: channel });
      if (begun.company_id !== companyId) {
        await rpc('_stripe_payment_abort', { _payment: begun.payment_id, _reason: 'societe differente' });
        return J({ error: 'forbidden' }, 403);
      }
      // 2. Session Stripe du montant exact (aucun supplement).
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = expiresAtFor(channel, now, Number(begun.counter_minutes) || 30);
      const { successUrl, cancelUrl } = returnUrls(base, begun.document_number ?? '');
      let session: any;
      try {
        const params = buildCheckoutSessionParams({
          amount: Number(begun.amount), documentNumber: begun.document_number ?? '', companyId,
          documentId: begun.document_id, paymentId: begun.payment_id, methods: begun.methods ?? [],
          successUrl, cancelUrl, expiresAt,
        });
        session = await stripe('checkout/sessions', { method: 'POST', body: params, idempotencyKey: `dms-${begun.payment_id}` });
      } catch (e) {
        await rpc('_stripe_payment_abort', { _payment: begun.payment_id, _reason: (e as Error).message }).catch(() => undefined);
        return J({ ok: false, error: 'stripe', message: (e as Error).message }, 502);
      }
      const expIso = new Date((Number(session.expires_at) || expiresAt) * 1000).toISOString();
      await rpc('_stripe_payment_attach', {
        _payment: begun.payment_id, _session_id: session.id, _url: session.url, _expires_at: expIso, _livemode: session.livemode === true,
      });
      return J({
        ok: true, payment_id: begun.payment_id, session_id: session.id, url: session.url, expires_at: expIso,
        amount: Number(begun.amount), document_number: begun.document_number, channel, livemode: session.livemode === true,
      });
    }

    if (body.action === 'cancel') {
      if (!isUuid(body.payment_id)) return J({ error: 'payment_id' }, 400);
      const rows = await (await fetch(
        `${SB_URL}/rest/v1/document_payments?select=id,status,method,stripe_session_id,documents!inner(company_id)&id=eq.${body.payment_id}&limit=1`,
        { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } },
      )).json().catch(() => []);
      const p = Array.isArray(rows) ? rows[0] : null;
      if (!p || p.method !== 'STRIPE' || p.documents?.company_id !== companyId) return J({ error: 'not_found' }, 404);
      if (p.status !== 'attendu') return J({ ok: true, status: p.status });
      if (p.stripe_session_id) {
        if (!stripeKeyMode(STRIPE_KEY())) return J({ ok: false, error: 'no_key' }, 409);
        try {
          await stripe(`checkout/sessions/${encodeURIComponent(p.stripe_session_id)}/expire`, { method: 'POST', body: new URLSearchParams() });
        } catch (e) {
          // Session deja terminee : le client a peut-etre paye ; le webhook tranchera. On n annule pas.
          const cur = await stripe(`checkout/sessions/${encodeURIComponent(p.stripe_session_id)}`).catch(() => null);
          if (!cur || cur.status === 'complete' || cur.payment_status === 'paid') {
            return J({ ok: false, error: 'already_paid_or_unknown', message: (e as Error).message }, 409);
          }
        }
      }
      const status = await rpc<string>('_stripe_payment_cancel', { _actor: caller.id, _payment: body.payment_id, _reason: String(body.reason ?? '').slice(0, 200) });
      return J({ ok: true, status });
    }

    return J({ error: 'action' }, 400);
  } catch (e) {
    return J({ ok: false, error: 'failed', message: (e as Error).message }, 400);
  }
});
