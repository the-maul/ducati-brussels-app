/**
 * Où envoyer quelqu'un qui vient de se connecter (ou de choisir son mot de passe) ?
 *   - membre du personnel (au moins un rôle)   → /dashboard
 *   - client (compte rattaché à une fiche)      → /mon-espace
 *   - sur l'hôte réservé aux clients           → /mon-espace (voir portal-host.ts)
 * Un compte sans rôle ni fiche va sur /dashboard, qui affiche déjà « aucun accès ».
 */
import { supabase } from '@/integrations/supabase/client';
import { isClientHost, PORTAL_HOME, STAFF_HOME } from '@/lib/portal-host';

export type HomePath = typeof PORTAL_HOME | typeof STAFF_HOME;

/** Le compte connecté est-il un client (fiche liée par contact_accounts) ? */
export async function isPortalClient(): Promise<boolean> {
  const { data, error } = await supabase.rpc('portal_whoami');
  if (error) return false;
  return data !== null && typeof data === 'object';
}

export async function resolveHomePath(userId: string | null | undefined): Promise<HomePath> {
  if (isClientHost()) return PORTAL_HOME;
  if (!userId) return STAFF_HOME;
  const { count } = await supabase
    .from('user_roles')
    .select('role', { count: 'exact', head: true })
    .eq('user_id', userId);
  if ((count ?? 0) > 0) return STAFF_HOME;
  return (await isPortalClient()) ? PORTAL_HOME : STAFF_HOME;
}
