/**
 * Nom d'une moto à l'écran (Simon, 23/11/2026) : chez Ducati, le modèle suffit (« MONSTER 1100 S »).
 * Les autres marques gardent leur nom. Les documents imprimés et les messages aux clients gardent
 * la marque complète.
 */
export function motoName(v: { brand?: string | null; model?: string | null }): string {
  const brand = (v.brand ?? '').trim();
  const model = (v.model ?? '').trim();
  if (!model) return brand;
  if (brand.toUpperCase() !== 'DUCATI') return [brand, model].filter(Boolean).join(' ');
  return model.replace(/^DUCATI\s+/i, '') || model;
}
