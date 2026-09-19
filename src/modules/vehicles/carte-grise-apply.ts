/**
 * Mission 04, carte 7 — types de la lecture de carte grise et application au formulaire
 * véhicule (fonctions pures, testées par tests/carte-grise.test.ts).
 */
export type CgConfidence = 'high' | 'medium' | 'low';
export type CgField =
  | 'vin' | 'plate' | 'first_registration_date' | 'brand' | 'model' | 'displacement'
  | 'power_kw' | 'power_cv' | 'energy' | 'antipollution' | 'color';

/** Réponse de read-id-doc en mode « carte_grise » (type MappedCarteGrise côté fonction). */
export type CgReading = {
  is_registration_certificate: boolean;
  values: Partial<Record<CgField, string>>;
  confidence: Partial<Record<CgField, CgConfidence>>;
  unmapped: { code: string; raw: string }[];
  holder: string | null;
};

/**
 * Applique une lecture au formulaire : un champ vide est rempli ; un champ déjà saisi
 * et différent n'est PAS écrasé (proposé comme « Sur la carte grise : … »).
 */
export function applyCgReading(
  current: Record<string, string | boolean>, reading: CgReading,
): { next: Record<string, string | boolean>; filled: CgField[]; conflicts: Partial<Record<CgField, string>> } {
  const next = { ...current };
  const filled: CgField[] = [];
  const conflicts: Partial<Record<CgField, string>> = {};
  for (const [k, v] of Object.entries(reading.values) as [CgField, string][]) {
    if (v == null || v === '') continue;
    const cur = typeof current[k] === 'string' ? (current[k] as string).trim() : '';
    if (!cur) { next[k] = v; filled.push(k); }
    else if (cur.toUpperCase() !== v.toUpperCase()) conflicts[k] = v;
  }
  return { next, filled, conflicts };
}
