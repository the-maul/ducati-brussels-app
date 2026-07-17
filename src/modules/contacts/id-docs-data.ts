/**
 * M1 — Permis & ID : logique pure de la lecture automatique des documents
 * (permis de conduire / carte d'identité belges) — normalisation des données
 * extraites et remplissage des champs VIDES uniquement.
 * Testé dans tests/id-docs.test.ts (bun) + vérification JScript.
 */

/** Dossiers GED des 4 scans (un document par dossier, remplacé à chaque upload). */
export const ID_DOC_SLOTS = [
  { doc: 'license', side: 'recto', folder: 'Permis-recto' },
  { doc: 'license', side: 'verso', folder: 'Permis-verso' },
  { doc: 'idcard', side: 'recto', folder: 'CarteID-recto' },
  { doc: 'idcard', side: 'verso', folder: 'CarteID-verso' },
] as const;
export type IdDocKind = 'license' | 'idcard';
export type IdDocSide = 'recto' | 'verso';

/** Données renvoyées par la fonction serveur de lecture (null = non lisible). */
export type ExtractedIdData = {
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  national_register?: string | null;
  national_id_number?: string | null;
  license_number?: string | null;
  license_categories?: string[] | null;
  license_date?: string | null;
  license_place?: string | null;
};

/** Champs de la fiche que la lecture peut compléter. */
export type IdTargets = {
  first_name: string;
  last_name: string;
  birth_date: string;
  national_id: string;
  national_register: string;
  license_number: string;
  license_date: string;
  license_place: string;
  license_category: string;
};

/** « 17.11.1978 » / « 17/11/1978 » / « 1978-11-17 » → ISO « 1978-11-17 » ; sinon ''. */
export function parseAnyDate(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const eu = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (eu) return `${eu[3]}-${eu[2].padStart(2, '0')}-${eu[1].padStart(2, '0')}`;
  return '';
}

/**
 * Meilleure catégorie MOTO parmi les catégories du permis (A > A2 > A1 > AM),
 * sinon B, sinon 'autre' si une catégorie inconnue est présente, sinon ''.
 */
export function bestLicenseCategory(cats: string[] | null | undefined): string {
  const list = (cats ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  if (!list.length) return '';
  for (const pref of ['A', 'A2', 'A1', 'AM', 'B']) {
    if (list.includes(pref)) return pref;
  }
  return 'autre';
}

/**
 * Construit le patch de la fiche : UNIQUEMENT les champs actuellement vides
 * (jamais d'écrasement d'une donnée saisie). Renvoie aussi les libellés des
 * clés remplies pour le message utilisateur.
 */
export function buildIdPatch(current: IdTargets, d: ExtractedIdData): Partial<IdTargets> {
  const patch: Partial<IdTargets> = {};
  const fill = (key: keyof IdTargets, value: string | null | undefined) => {
    const v = (value ?? '').trim();
    if (v && !current[key].trim()) patch[key] = v;
  };
  fill('first_name', d.first_name);
  fill('last_name', d.last_name);
  fill('birth_date', parseAnyDate(d.birth_date));
  fill('national_id', d.national_id_number);
  fill('national_register', d.national_register);
  fill('license_number', d.license_number);
  fill('license_date', parseAnyDate(d.license_date));
  fill('license_place', d.license_place);
  fill('license_category', bestLicenseCategory(d.license_categories));
  return patch;
}
