/**
 * Adresse de l'application CÔTÉ CLIENT (portail, inscription).
 *
 * Domaines prévus (18/09) : `app.ducatibruxelles.be` pour les clients,
 * `dms.ducatibruxelles.be` pour le personnel ; le site public Shopify reste
 * `ducatibruxelles.be`. Tant que le domaine client n'est pas en ligne, on se
 * replie sur l'adresse actuelle du site (ex. l'adresse Netlify).
 *
 * RÉGLAGE UNIQUE : variable d'environnement publique `VITE_CLIENT_APP_URL`
 * (ex. `https://app.ducatibruxelles.be`, sans barre finale). Sert au message de
 * bienvenue, au lien du pied de mail (P-5) et aux liens d'invitation envoyés
 * après une inscription.
 */

const VALID = /^https:\/\/[^/\s]+$|^http:\/\/localhost(:\d+)?$/;

export function clientAppUrl(): string {
  const raw = String(import.meta.env.VITE_CLIENT_APP_URL ?? '').trim().replace(/\/+$/, '');
  if (raw && VALID.test(raw)) return raw;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

/** Forme affichée au client : sans « https:// » (ex. app.ducatibruxelles.be). */
export function clientAppHost(): string {
  return clientAppUrl().replace(/^https?:\/\//, '');
}
