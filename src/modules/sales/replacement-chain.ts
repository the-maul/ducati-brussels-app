/**
 * Chaine de remplacement (pure, sans acces base) : partagee par la vente (replacement.ts) et
 * les garde-fous de commande fournisseur (articles/supply-state.ts).
 */
export const MAX_REPLACEMENT_HOPS = 30;

export type ReplacementChain = {
  /** Dernière référence de la chaîne (null si l'article n'est pas remplacé). */
  lastId: string | null;
  /** Identifiants parcourus, article de départ compris. */
  path: string[];
  /** Vrai si la chaîne revient sur une référence déjà vue (données à corriger). */
  loop: boolean;
};

/**
 * Suit la chaîne de remplacement depuis `startId`. `next(id)` renvoie la référence qui
 * remplace `id` (ou null / undefined). En cas de boucle, on s'arrête sur la dernière
 * référence avant de repasser par une référence déjà vue.
 */
export function followReplacementChain(
  startId: string,
  next: (id: string) => string | null | undefined,
  maxHops = MAX_REPLACEMENT_HOPS,
): ReplacementChain {
  const path = [startId];
  const seen = new Set(path);
  let current = startId;
  let loop = false;
  for (;;) {
    const n = next(current);
    if (!n) break;
    // boucle (A → B → A) ou chaîne anormalement longue : on s'arrête et on le signale
    if (seen.has(n) || path.length > maxHops) { loop = true; break; }
    path.push(n);
    seen.add(n);
    current = n;
  }
  return { lastId: path.length > 1 ? current : null, path, loop };
}
