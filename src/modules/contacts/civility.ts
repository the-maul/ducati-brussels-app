/**
 * Mission 04, carte 2 — civilité de la PERSONNE (M. / Mme / Mx), séparée de la
 * forme juridique d'un professionnel (colonne `legal_form`, valeurs de la table de
 * référence `civility` de Paramètres, lignes « Professionnel »).
 *
 * Valeurs enregistrées : « Monsieur », « Madame » (celles des ~6 000 fiches
 * existantes, inchangées) et « Mx ». Libellés affichés : M., Mme, Mx.
 * Les écritures G8 (MR, MME…) sont reconnues à la lecture. Fonctions PURES
 * (tests/civility.test.ts).
 */

export const PERSON_CIVILITIES = [
  { value: 'Monsieur', labelKey: 'contacts.civilityM' },
  { value: 'Madame', labelKey: 'contacts.civilityMme' },
  { value: 'Mx', labelKey: 'contacts.civilityMx' },
] as const;

export type PersonCivility = (typeof PERSON_CIVILITIES)[number]['value'];

const ALIASES: Record<string, PersonCivility> = {
  MONSIEUR: 'Monsieur', MR: 'Monsieur', M: 'Monsieur', 'M.': 'Monsieur',
  MADAME: 'Madame', MME: 'Madame', 'MME.': 'Madame', MLLE: 'Madame', MADEMOISELLE: 'Madame',
  MX: 'Mx',
};

/** Civilité de personne reconnue (quelle que soit l'écriture), sinon null (forme juridique, « Autre »…). */
export function personCivility(raw: string | null | undefined): PersonCivility | null {
  const k = (raw ?? '').trim().toUpperCase();
  return k ? ALIASES[k] ?? null : null;
}

/** Ligne de la table de référence `civility` (reference_values). */
export type CivilityRef = { code: string; label: string; is_active: boolean; extra: unknown };

/** Formes juridiques proposées : lignes actives marquées « Professionnel » dans Paramètres. */
export function legalFormOptions(rows: CivilityRef[]): { code: string; label: string }[] {
  return rows
    .filter((r) => r.is_active && !!r.extra && typeof r.extra === 'object'
      && (r.extra as Record<string, unknown>).professional === true)
    .map((r) => ({ code: r.code, label: r.label || r.code }));
}
