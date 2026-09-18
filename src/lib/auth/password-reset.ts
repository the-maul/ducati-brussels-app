/**
 * « Mot de passe oublié ? » (page /login, 19/09).
 *
 * Demande à la fonction Edge send-account-invitation (`kind: 'reset'`, appel public)
 * d'envoyer par Outlook un lien /reset-password?token_hash=…&type=recovery.
 * On n'utilise PAS supabase.auth.resetPasswordForEmail : l'adresse de retour
 * configurée dans Supabase Auth pointe encore vers localhost.
 *
 * La fonction répond toujours la même chose, que le compte existe ou non, et limite
 * les envois (1 par adresse toutes les 5 minutes, 5 par heure). L'écran affiche donc
 * toujours le même message. Renvoie false seulement si l'appel n'a pas pu aboutir
 * (réseau, adresse refusée).
 */
import { supabase } from '@/integrations/supabase/client';

export async function requestPasswordReset(email: string): Promise<boolean> {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { error } = await supabase.functions.invoke('send-account-invitation', {
      body: { kind: 'reset', email: email.trim(), origin },
    });
    return !error;
  } catch {
    return false;
  }
}
