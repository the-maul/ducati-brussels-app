/**
 * M2 — Rattrapage G8 (18/11/2026) : « fichier perso » d'un fournisseur (G8 « Intégrer fichier
 * perso »). Le format retient, pour chaque champ de l'article, le NOM de la colonne du fichier
 * (pas sa position) : le tarif suivant du même fournisseur se relit même si une colonne a bougé.
 */
export type IndexMapping = Partial<Record<string, number>>;
export type NameMapping = Record<string, string>;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Mapping de l'écran (champ → index) vers le format enregistré (champ → nom d'en-tête). */
export function mappingToNames(mapping: IndexMapping, headers: string[]): NameMapping {
  const out: NameMapping = {};
  for (const [field, idx] of Object.entries(mapping)) {
    if (idx == null || idx < 0 || idx >= headers.length) continue;
    const h = headers[idx]?.trim();
    if (h) out[field] = h;
  }
  return out;
}

/**
 * Format enregistré → mapping de l'écran pour CE fichier. Un en-tête introuvable est rendu à
 * part (`missing`) : l'écran le signale au lieu de lire une mauvaise colonne.
 */
export function namesToMapping(names: NameMapping, headers: string[]): { mapping: IndexMapping; missing: string[] } {
  const index = new Map<string, number>();
  headers.forEach((h, i) => { const k = norm(h); if (k && !index.has(k)) index.set(k, i); });
  const mapping: IndexMapping = {};
  const missing: string[] = [];
  for (const [field, name] of Object.entries(names)) {
    const i = index.get(norm(name));
    if (i == null) missing.push(name);
    else mapping[field] = i;
  }
  return { mapping, missing };
}
