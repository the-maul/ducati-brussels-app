/**
 * Plaque d'immatriculation (retour de Domenico, 23/11/2026) : lettres et chiffres en majuscules,
 * exactement 7 caractères. Une plaque personnalisée n'a aucune de ces limites.
 * Les plaques déjà enregistrées ne sont contrôlées que si on les modifie.
 */
export const PLATE_LENGTH = 7;

export function normalizePlate(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Ce que le champ garde pendant la frappe. */
export function plateInput(raw: string, custom: boolean): string {
  return custom ? raw.toUpperCase() : normalizePlate(raw).slice(0, PLATE_LENGTH);
}

/** Valeur à enregistrer. */
export function cleanPlate(raw: string | null | undefined, custom: boolean): string {
  return custom ? (raw ?? '').trim().toUpperCase() : normalizePlate(raw);
}

/** Une plaque vide reste permise : elle n'est pas toujours connue à la création. */
export function plateIsValid(plate: string, custom: boolean): boolean {
  return custom || plate === '' || plate.length === PLATE_LENGTH;
}

/** « M-ACN-057 » et « MACN057 » sont la même plaque (DCS, carte grise, ancienne saisie). */
export function samePlate(a: unknown, b: unknown): boolean {
  const x = normalizePlate(a == null ? '' : String(a));
  return x !== '' && x === normalizePlate(b == null ? '' : String(b));
}

/**
 * Plaque lue ailleurs (DCS, carte grise, import G8) : enregistrée sans tirets ni espaces quand
 * elle fait 7 caractères. Sinon le texte d'origine est gardé tel quel, pour être vérifié à la main
 * (même règle que le nettoyage des fiches du 26/11/2026).
 */
export function plateFromSource(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const n = normalizePlate(text);
  return n.length === PLATE_LENGTH ? n : text;
}
