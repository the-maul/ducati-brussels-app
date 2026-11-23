/**
 * M0 / M1 — Recherche globale : quel groupe de résultats vient en premier (retour du 23/11/2026).
 * Un nom cherche d'abord un client. Dès qu'il y a un chiffre (VIN, plaque), la moto passe devant.
 */
export function vehiclesFirst(query: string): boolean {
  return /\d/.test(query);
}
