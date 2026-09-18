/**
 * Mission 04, carte 6 — contrôle du VIN (n° de châssis, case E de la carte grise).
 *
 * Norme ISO 3779 : 17 caractères, lettres et chiffres, sans I, O ni Q (confondus
 * avec 1 et 0). Les cadres anciens (avant 1981) ont souvent un numéro plus court :
 * ces écarts sont des AVERTISSEMENTS, jamais un blocage.
 * La base applique la même normalisation : `public.vin_normalize(text)`.
 */

export type VinWarning = 'length' | 'forbidden_letters';

export type VinCheck = {
  /** VIN comparable : majuscules, lettres et chiffres seulement ; '' si vide. */
  normalized: string;
  warnings: VinWarning[];
  /** Lettres interdites trouvées (I, O, Q), dans l'ordre d'apparition, sans doublon. */
  forbidden: string[];
};

export const VIN_LENGTH = 17;

/** Majuscules, sans espace, tiret, point ni autre séparateur. */
export function normalizeVin(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function checkVin(raw: string | null | undefined): VinCheck {
  const normalized = normalizeVin(raw);
  const warnings: VinWarning[] = [];
  if (!normalized) return { normalized, warnings, forbidden: [] };
  if (normalized.length !== VIN_LENGTH) warnings.push('length');
  const forbidden = [...new Set(normalized.match(/[IOQ]/g) ?? [])];
  if (forbidden.length > 0) warnings.push('forbidden_letters');
  return { normalized, warnings, forbidden };
}
