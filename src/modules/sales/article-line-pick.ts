/** Recherche d'article d'une ligne — logique pure du composant `ArticleLinePicker` (ATE001b). */

/** Index actif apres une fleche (boucle en haut et en bas ; -1 = aucun). */
export function moveActive(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}
