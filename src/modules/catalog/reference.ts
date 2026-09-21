/**
 * Catalogue Ducati (mission 06) — forme compacte d'une référence, identique à la base :
 * ducati_catalog_norm_ref() et l'index idx_articles_ref_compact (majuscules, uniquement A-Z0-9).
 * C'est par cette forme qu'une pièce du catalogue retrouve l'article du DMS.
 */
export function normalizeCatalogReference(ref: string | null | undefined): string {
  return String(ref ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
