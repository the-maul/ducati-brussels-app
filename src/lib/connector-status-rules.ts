/**
 * Voyants de connexion de la barre du haut (Simon, 26/11/2026) : vert = page ouverte et connectée,
 * rouge = pas prêt, avec la marche à suivre. DCS aujourd'hui ; Shopify et Horus suivront.
 * Règles pures : tests/connector-status.test.ts.
 */

export type DcsPortal = 'connected' | 'login' | 'none';
export type DcsConnectorState = 'connected' | 'login' | 'none' | 'no_extension' | 'old_extension';

/** Réponse de l'extension à la commande « status » → état du voyant. */
export function dcsConnectorState(reply: unknown): DcsConnectorState {
  if (!reply || typeof reply !== 'object') return 'no_extension';
  const portal = (reply as { portal?: unknown }).portal;
  // Une extension 0.11.2 ou plus ancienne répond, mais sans l'état du portail.
  if (portal !== 'connected' && portal !== 'login' && portal !== 'none') return 'old_extension';
  return portal;
}

export const connectorOk = (s: DcsConnectorState) => s === 'connected';
