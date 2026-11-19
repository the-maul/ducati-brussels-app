/**
 * Où envoyer quelqu'un qui vient de se connecter (ou de choisir son mot de passe) ?
 *   - membre du personnel (au moins un rôle)   → /dashboard, ou « Mon atelier » pour un
 *     mécanicien / chef d'atelier (lot F du 19/11/2026) ; le réglage du compte
 *     (`profiles.home_page`, choisi sur « Mon atelier ») prime sur le rôle
 *   - client (compte rattaché à une fiche)      → /mon-espace
 *   - sur l'hôte réservé aux clients           → /mon-espace (voir portal-host.ts)
 * Un compte sans rôle ni fiche va sur /dashboard, qui affiche déjà « aucun accès ».
 */
import { supabase } from '@/integrations/supabase/client';
import { isClientHost, PORTAL_HOME, STAFF_HOME } from '@/lib/portal-host';
import { homeTarget, MY_WORKSHOP_PATH } from '@/modules/workshop/my-workshop/rules';

export type HomePath = typeof PORTAL_HOME | typeof STAFF_HOME | typeof MY_WORKSHOP_PATH;

/** Le compte connecté est-il un client (fiche liée par contact_accounts) ? */
export async function isPortalClient(): Promise<boolean> {
  const { data, error } = await supabase.rpc('portal_whoami');
  if (error) return false;
  return data !== null && typeof data === 'object';
}

export async function resolveHomePath(userId: string | null | undefined): Promise<HomePath> {
  if (isClientHost()) return PORTAL_HOME;
  if (!userId) return STAFF_HOME;
  const loose = supabase as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } } };
  };
  const [rolesRes, prefRes] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', userId),
    // Colonne de la migration 20261119290000 : absente, le rôle décide.
    loose.from('profiles').select('home_page').eq('id', userId).maybeSingle(),
  ]);
  const roles = ((rolesRes.data ?? []) as { role: string }[]).map((r) => r.role);
  if (roles.length > 0) {
    const pref = prefRes.error ? null : ((prefRes.data as { home_page?: string | null } | null)?.home_page ?? null);
    return homeTarget(roles, pref) === 'my_workshop' ? MY_WORKSHOP_PATH : STAFF_HOME;
  }
  return (await isPortalClient()) ? PORTAL_HOME : STAFF_HOME;
}
