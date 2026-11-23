/**
 * M0 / M1 — Recherche globale : quel groupe de résultats vient en premier (retour du 23/11/2026).
 * Un nom cherche d'abord un client. Dès qu'il y a un chiffre (VIN, plaque), la moto passe devant.
 */
export function vehiclesFirst(query: string): boolean {
  return /\d/.test(query);
}

/** Ce qui était tapé dans la recherche devient nom puis prénom. Un numéro ou un e-mail ne préremplit rien. */
export function quickClientNames(term: string): { last: string; first: string } {
  const q = term.trim().replace(/\s+/g, ' ');
  if (!q || /[\d@]/.test(q)) return { last: '', first: '' };
  const [last, ...rest] = q.toUpperCase().split(' ');
  return { last, first: rest.join(' ') };
}
