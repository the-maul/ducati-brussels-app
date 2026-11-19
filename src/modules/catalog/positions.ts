/**
 * Catalogue Ducati — repères (positions) d'une vue éclatée, pour l'affichage sans image
 * (lot E du parcours mécanicien, 19/11/2026). Logique pure, testée dans tests/atelier-vues-eclatees.test.ts.
 */
/** Tri « naturel » des repères Ducati (1, 2, 10, 10A, 11). */
export function comparePositions(a: string, b: string): number {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  const fa = Number.isFinite(na), fb = Number.isFinite(nb);
  if (fa && fb && na !== nb) return na - nb;
  if (fa !== fb) return fa ? -1 : 1;
  return a.localeCompare(b);
}

/** Repères d'une vue (zones cliquables + lignes), sans doublon, triés : affichage sans image. */
export function positionsOf(hotspots: readonly { pos: string | number }[] | null | undefined, lines: readonly { position: string | null }[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const h of hotspots ?? []) { const p = String(h.pos ?? '').trim(); if (p) set.add(p); }
  for (const l of lines ?? []) { const p = String(l.position ?? '').trim(); if (p) set.add(p); }
  return [...set].sort(comparePositions);
}

