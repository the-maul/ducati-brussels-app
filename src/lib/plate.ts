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
