/**
 * Aiguillage personnel / clients selon l'adresse du site (décision client du 18/09).
 *
 * Aujourd'hui : une seule adresse, le portail client vit sous /mon-espace.
 * Demain : dms.ducatibruxelles.be pour le personnel, app.ducatibruxelles.be pour
 * les clients. Il suffira alors de poser, dans Netlify, la variable de build
 *   VITE_CLIENT_APP_HOST=app.ducatibruxelles.be
 * Sur cet hôte-là : la racine mène à /mon-espace et les pages du personnel sont
 * interdites (renvoi vers /mon-espace), même pour un compte du personnel.
 * Variable absente (cas actuel) : aucun changement, l'aiguillage se fait par compte.
 *
 * Cette logique ne protège AUCUNE donnée : la sécurité reste dans la base
 * (fonctions portal_ et RLS). C'est uniquement de la navigation.
 */

export const PORTAL_HOME = '/mon-espace' as const;
export const STAFF_HOME = '/dashboard' as const;

/** Hôte réservé aux clients, ou null s'il n'est pas configuré. */
export function clientAppHost(): string | null {
  const raw = (import.meta.env as Record<string, unknown>).VITE_CLIENT_APP_HOST;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : null;
}

/**
 * Sommes-nous sur l'hôte des clients ? Côté serveur (rendu SSR) le nom d'hôte
 * n'est pas connu ici : on répond « non » et le navigateur corrige au montage.
 */
export function isClientHost(hostname?: string): boolean {
  const host = clientAppHost();
  if (!host) return false;
  const current = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  return current.toLowerCase() === host;
}
