/**
 * M11 — Paiement en ligne via Stripe Checkout (Edge Function `stripe-checkout`).
 * Si Stripe n'est pas encore configuré (pas de clé serveur), retourne false et la
 * commande reste « en attente de paiement » (le marchand finalise hors-ligne).
 */
import { supabase } from '@/integrations/supabase/client';

export async function startCheckout(orderId: string, amount: number, email: string): Promise<boolean> {
  if (!orderId || amount <= 0) return false;
  try {
    const { data, error } = await supabase.functions.invoke('stripe-checkout', {
      body: { orderId, amount, email, returnUrl: window.location.href },
    });
    if (error) return false;
    const url = (data as { url?: string } | null)?.url;
    if (url) { window.location.href = url; return true; }
    return false;
  } catch {
    return false;
  }
}
