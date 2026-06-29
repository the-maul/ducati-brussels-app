/**
 * Liens profonds vers le portail concessionnaire Ducati (Salesforce, SSO).
 * Aucune API : on ouvre la bonne page du portail pour un VIN donné ; c'est la
 * session SSO déjà ouverte du concessionnaire dans son navigateur qui authentifie.
 */
export const DUCATI_DEALER_BASE = 'https://ducati.my.site.com/dealer/s';

/** Page « historique VIN » du portail Ducati pour une moto donnée. */
export function ducatiVinHistoryUrl(vin: string): string {
  return `${DUCATI_DEALER_BASE}/vinhistory?vin=${encodeURIComponent(vin.trim().toUpperCase())}`;
}
