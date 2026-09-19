/**
 * M6 — Paiement par QR de virement (mission 02, carte 9) : appels serveur.
 * Toute écriture passe par des fonctions contrôlées (migration 20260919360000_m6_qr_virement_ecran_client) :
 * qr_payment_start / qr_payment_confirm / qr_payment_cancel / counter_display_show / counter_display_current.
 */
import { supabase } from '@/integrations/supabase/client';

export const QR_METHOD = 'VIRQR';

const rpc = supabase.rpc.bind(supabase);

export type QrPendingPayment = { id: string; amount: number; reference: string | null; createdAt: string };

/** Règlements QR encore attendus d'un document. */
export async function listPendingQrPayments(documentId: string): Promise<QrPendingPayment[]> {
  const { data, error } = await supabase
    .from('document_payments').select('id, amount, qr_reference, paid_at')
    .eq('document_id', documentId).eq('method', QR_METHOD).eq('status', 'attendu')
    .order('paid_at');
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, amount: Number(p.amount), reference: p.qr_reference, createdAt: p.paid_at }));
}

/** Crée le règlement attendu et l'affiche sur l'écran client du vendeur connecté. */
export async function startQrPayment(documentId: string, amount: number, reference: string): Promise<string> {
  const { data, error } = await rpc('qr_payment_start', { _document: documentId, _amount: amount, _reference: reference });
  if (error) throw error;
  return data as string;
}

export async function confirmQrPayment(paymentId: string): Promise<void> {
  const { error } = await rpc('qr_payment_confirm', { _payment: paymentId });
  if (error) throw error;
}

export async function cancelQrPayment(paymentId: string): Promise<void> {
  const { error } = await rpc('qr_payment_cancel', { _payment: paymentId });
  if (error) throw error;
}

/** Réaffiche un paiement QR en attente (ou `null` : écran d'accueil). */
export async function showOnCounterDisplay(companyId: string, paymentId: string | null): Promise<void> {
  const { error } = await rpc('counter_display_show', { _company: companyId, _payment: paymentId as string });
  if (error) throw error;
}

export type CounterDisplayState = {
  paymentId: string | null;
  status: string | null;
  amount: number;
  reference: string | null;
  documentNumber: string | null;
  customerName: string | null;
  beneficiary: string;
  iban: string | null;
  bic: string | null;
  receivedAt: string | null;
  updatedAt: string | null;
};

/** Ce que l'écran client doit afficher (null si l'écran n'a encore jamais servi). */
export async function getCounterDisplay(companyId: string): Promise<CounterDisplayState | null> {
  const { data, error } = await rpc('counter_display_current', { _company: companyId });
  if (error) throw error;
  const r = (data ?? [])[0];
  if (!r) return null;
  return {
    paymentId: r.payment_id, status: r.status, amount: Number(r.amount ?? 0), reference: r.reference,
    documentNumber: r.document_number, customerName: r.customer_name, beneficiary: r.beneficiary,
    iban: r.iban, bic: r.bic, receivedAt: r.received_at, updatedAt: r.updated_at,
  };
}

/** Abonnement Realtime à l'écran du vendeur ; renvoie la fonction de désabonnement. */
export function subscribeCounterDisplay(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`counter-display-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'counter_displays', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
