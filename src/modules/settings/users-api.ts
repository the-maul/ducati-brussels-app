/**
 * M0 — Écran Utilisateurs : ce qui ne passe pas par les fonctions serveur
 * d'administration (admin.functions.ts).
 */
import { supabase } from '@/integrations/supabase/client';

/**
 * Envoie (ou renvoie) l'invitation à choisir son mot de passe, par Outlook.
 * Le lien mène à /reset-password de CE site : on transmet donc son adresse.
 */
export async function sendAccountInvitation(companyId: string, userId: string): Promise<{ ok?: boolean; to?: string; error?: string }> {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { data, error } = await supabase.functions.invoke('send-account-invitation', { body: { companyId, userId, origin } });
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try { const j = await ctx?.json?.(); if (j?.error) return { error: j.error }; } catch { /* corps illisible */ }
    return { error: error.message };
  }
  return data as { ok?: boolean; to?: string };
}

/** Recherche d'une fiche client à rattacher à un compte (nom, prénom ou e-mail). */
export type ContactHit = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null };
export async function searchContactsForAccount(companyId: string, q: string): Promise<ContactHit[]> {
  const s = q.trim().replace(/[%,()]/g, ' ');
  if (s.length < 2) return [];
  const { data, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email, phone')
    .eq('company_id', companyId)
    .or(`last_name.ilike.%${s}%,first_name.ilike.%${s}%,email.ilike.%${s}%`)
    .order('last_name')
    .limit(8);
  if (error) throw error;
  return (data as ContactHit[]) ?? [];
}
