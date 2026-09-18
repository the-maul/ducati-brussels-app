/**
 * Mail de sécurité « Votre mot de passe a été modifié » (décision U-5 du 18/09).
 *
 * Appelé par /reset-password juste après un changement réussi, avec la session de
 * la personne connectée. La fonction Edge send-account-invitation (`kind:
 * 'password_changed'`) n'écrit qu'à l'adresse du compte CONNECTÉ : impossible de
 * viser quelqu'un d'autre. Le mail ne contient jamais le mot de passe.
 * Ne lève jamais d'erreur : un échec d'envoi ne doit pas bloquer la personne.
 */
import { supabase } from '@/integrations/supabase/client';
import { clientAppUrl } from '@/lib/client-app-url';

export async function notifyPasswordChanged(): Promise<boolean> {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : clientAppUrl();
    const { error } = await supabase.functions.invoke('send-account-invitation', {
      body: { kind: 'password_changed', origin },
    });
    if (error) console.warn('[pwd] mail de changement non envoyé', error.message);
    return !error;
  } catch (e) {
    console.warn('[pwd] mail de changement non envoyé', e instanceof Error ? e.message : e);
    return false;
  }
}
