/**
 * Mission 12, carte P3 -- PDV040 « Payer par QR (Bancontact / carte) » : appels serveur.
 * Creation / annulation : fonction Edge `stripe-checkout` (cle Stripe cote serveur uniquement).
 * Confirmation : fonction Edge `stripe-webhook` (Stripe) -> le reglement passe a « recu » ; l ecran
 * suit par Realtime (document_payments) et relecture.
 * Reglage societe : stripe_settings_get / stripe_settings_set (migration 20261103260000).
 * Ecran client : publie le QR par `counter_display_set` (mode « qr », migration 20261103240000) s il
 * existe ; sinon rien (le QR reste sur l ecran du vendeur).
 */
import { supabase } from '@/integrations/supabase/client';
import { STRIPE_METHOD, type StripeChannel } from './stripe-pay-rules';

/** Cle react-query de l etat Stripe d une societe (cle posee, reglage). */
export const stripeStatusKey = (companyId: string) => ['stripe-status', companyId] as const;

export type StripeMethodCode = 'bancontact' | 'card' | 'wero';
export type StripeSettings = { enabled: boolean; methods: StripeMethodCode[]; mode: 'test' | 'live'; counterMinutes: number };
export type StripeStatus = {
  configured: boolean;                 // une cle STRIPE_SECRET_KEY est posee
  keyMode: 'test' | 'live' | null;
  ready: boolean;                      // cle + reglage active + meme mode
  reason: string | null;               // no_key | disabled | mode_mismatch | no_method
  settings: StripeSettings;
  webhookUrl: string | null;
};
export type StripeCheckout = {
  paymentId: string; sessionId: string; url: string; expiresAt: string; amount: number;
  documentNumber: string | null; channel: StripeChannel; livemode: boolean;
};
export type StripePaymentRow = {
  id: string; status: string; amount: number; channel: StripeChannel | null; url: string | null;
  expiresAt: string | null; fee: number | null; methodType: string | null; livemode: boolean | null;
  createdAt: string; receivedAt: string | null; note: string | null;
};

/** Message lisible d une erreur de fonction Edge (corps JSON { message | error }). */
async function invokeError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    const b = await ctx.clone().json().catch(() => null) as { message?: string; error?: string } | null;
    if (b?.message) return new Error(b.message);
    if (b?.error) return new Error(b.error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', { body });
  if (error) throw await invokeError(error);
  return data as T;
}

export async function getStripeStatus(companyId: string): Promise<StripeStatus> {
  const r = await call<{
    configured: boolean; key_mode: 'test' | 'live' | null; ready: boolean; reason: string | null; webhook_url?: string;
    settings: { enabled: boolean; methods: StripeMethodCode[]; mode: 'test' | 'live'; counter_minutes: number };
  }>({ action: 'status', company_id: companyId });
  return {
    configured: !!r.configured, keyMode: r.key_mode ?? null, ready: !!r.ready, reason: r.reason ?? null,
    webhookUrl: r.webhook_url ?? null,
    settings: { enabled: !!r.settings?.enabled, methods: r.settings?.methods ?? ['bancontact', 'card'], mode: r.settings?.mode ?? 'test', counterMinutes: r.settings?.counter_minutes ?? 30 },
  };
}

export async function createStripeCheckout(companyId: string, documentId: string, amount: number, channel: StripeChannel): Promise<StripeCheckout> {
  const r = await call<{
    ok: boolean; payment_id: string; session_id: string; url: string; expires_at: string; amount: number;
    document_number: string | null; channel: StripeChannel; livemode: boolean; message?: string; error?: string;
  }>({ action: 'create', company_id: companyId, document_id: documentId, amount, channel, origin: window.location.origin });
  if (!r?.ok) throw new Error(r?.message ?? r?.error ?? 'stripe');
  return {
    paymentId: r.payment_id, sessionId: r.session_id, url: r.url, expiresAt: r.expires_at, amount: Number(r.amount),
    documentNumber: r.document_number, channel: r.channel, livemode: !!r.livemode,
  };
}

export async function cancelStripeCheckout(companyId: string, paymentId: string, reason: string): Promise<void> {
  const r = await call<{ ok: boolean; message?: string; error?: string }>({ action: 'cancel', company_id: companyId, payment_id: paymentId, reason });
  if (!r?.ok) throw new Error(r?.message ?? r?.error ?? 'stripe');
}

/** Reglements Stripe d un document (colonnes de la migration 20261103260000). */
export async function listStripePayments(documentId: string): Promise<StripePaymentRow[]> {
  const { data, error } = await supabase
    .from('document_payments')
    .select('id, status, amount, paid_at, received_at, note, stripe_channel, stripe_url, stripe_expires_at, stripe_fee, stripe_method_type, stripe_livemode' as never)
    .eq('document_id', documentId).eq('method', STRIPE_METHOD).order('paid_at', { ascending: false });
  if (error) throw error;
  type Row = { id: string; status: string; amount: number; paid_at: string; received_at: string | null; note: string | null;
    stripe_channel: StripeChannel | null; stripe_url: string | null; stripe_expires_at: string | null; stripe_fee: number | null;
    stripe_method_type: string | null; stripe_livemode: boolean | null };
  return ((data ?? []) as unknown as Row[]).map((p) => ({
    id: p.id, status: p.status, amount: Number(p.amount), channel: p.stripe_channel, url: p.stripe_url,
    expiresAt: p.stripe_expires_at, fee: p.stripe_fee === null ? null : Number(p.stripe_fee), methodType: p.stripe_method_type,
    livemode: p.stripe_livemode, createdAt: p.paid_at, receivedAt: p.received_at, note: p.note,
  }));
}

/** Realtime sur les reglements du document ; renvoie la fonction de desabonnement. */
export function subscribeDocumentPayments(documentId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`doc-payments-${documentId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'document_payments', filter: `document_id=eq.${documentId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

/** Reglage de la societe (desactive tant qu il n y a pas de ligne). */
export async function getStripeSettings(companyId: string): Promise<StripeSettings> {
  const { data, error } = await (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(
    'stripe_settings_get', { _company: companyId });
  if (error) throw error;
  const r = (data as { enabled: boolean; methods: StripeMethodCode[]; mode: 'test' | 'live'; counter_minutes: number }[] | null)?.[0];
  return { enabled: !!r?.enabled, methods: r?.methods ?? ['bancontact', 'card'], mode: r?.mode ?? 'test', counterMinutes: r?.counter_minutes ?? 30 };
}

export async function setStripeSettings(companyId: string, s: StripeSettings): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ error: unknown }>)(
    'stripe_settings_set', { _company: companyId, _enabled: s.enabled, _methods: s.methods, _mode: s.mode, _counter_minutes: s.counterMinutes });
  if (error) throw error;
}

/**
 * Ecran client appaire (mode « qr » de 20261103240000) : affiche le QR Stripe ; `merci` / `accueil`
 * ensuite. Sans la migration de l ecran client : sans effet (renvoie false).
 */
export async function publishStripeOnCustomerScreen(
  companyId: string,
  mode: 'qr' | 'merci' | 'accueil',
  p: { paymentId?: string; url?: string; expiresAt?: string; amount?: number; documentNumber?: string | null; customerName?: string | null } = {},
): Promise<boolean> {
  const payload = mode === 'qr'
    ? { qr: { kind: 'stripe', url: p.url, expires_at: p.expiresAt ?? null, payment_id: p.paymentId }, amount: p.amount, document_number: p.documentNumber ?? null, customer_name: p.customerName ?? null }
    : mode === 'merci' ? { amount: p.amount } : {};
  const { error } = await (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ error: unknown }>)(
    'counter_display_set', { _company: companyId, _mode: mode, _payload: payload });
  if (!error) return true;
  const e = error as { code?: string; message?: string };
  if (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist/i.test(e.message ?? '')) return false;
  throw error;
}
