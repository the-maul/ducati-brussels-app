/**
 * Mission 06, carte 4 — reconnaître la moto par son VIN, hors ligne.
 *
 * Fonctions PURES (aucun accès réseau) partagées par :
 *   - le générateur de la table de correspondance (`tools/vin-patterns/build.ts`),
 *     qui mesure aussi la précision par validation croisée ;
 *   - l'écran (remplissage automatique des champs, choix d'un candidat) ;
 *   - les tests (`tests/vin-identify.test.ts`).
 * La base applique les mêmes règles dans `public.vin_identify(text)` (migration
 * `20260921210000_m3_vin_reconnaissance.sql`) : toute modification ici doit y être reportée.
 *
 * Structure d'un VIN Ducati (ex. ZDM K100AA G B 012345) :
 *   1-3 constructeur (ZDM = Ducati) · 4-9 descripteur (famille, moteur, cadre, marché)
 *   10 année (code ISO 3779) · 11 usine (B = Bologne) · 12-17 n° de série.
 * Le descripteur donne la famille et la cylindrée ; il ne distingue PAS toujours la version
 * (ex. Scrambler Icon / Classic / Full Throttle partagent le même descripteur) : on renvoie
 * alors plusieurs candidats, classés, et l'utilisateur choisit.
 */

/** Niveaux de confiance, du plus sûr au moins sûr. */
export type VinConfidence = 'unique' | 'probable' | 'plusieurs' | 'modele' | 'famille' | 'inconnu';

/** Une ligne de la table de correspondance `ducati_vin_patterns`. */
export type VinPatternRow = {
  /** Caractères 1 à 9 + caractère 10 (année) : 10 caractères. */
  pattern: string;
  model_year_id: string;
  /** Plage de n° de série observée, arrondie à la centaine (jamais un n° exact). */
  serial_from: number;
  serial_to: number;
  samples: number;
};

export type RankedCandidate = {
  model_year_id: string;
  samples: number;
  /** Part des motos connues de ce motif (0 à 1). */
  share: number;
  /** Le n° de série tombe dans la plage observée de ce candidat. */
  in_range: boolean;
  /** Écart entre le n° de série et la plage (0 si dedans). */
  distance: number;
};

/** Un candidat « unique » doit avoir été vu au moins 5 fois (précision mesurée : voir build.ts). */
export const UNIQUE_MIN_SAMPLES = 5;
/** Les plages de n° de série sont arrondies à la centaine (aucun VIN complet dans la table). */
export const SERIAL_ROUNDING = 100;

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** VIN complet utilisable : 17 caractères, lettres et chiffres, sans I, O ni Q. */
export function isFullVin(vin: string | null | undefined): boolean {
  return VIN_RE.test((vin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

/** VIN Ducati complet (constructeur ZDM). */
export function isDucatiFullVin(vin: string | null | undefined): boolean {
  const v = (vin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return isFullVin(v) && v.startsWith('ZDM');
}

// Code année ISO 3779 (10e caractère) : cycle de 30 ans. A = 1980 ou 2010, 1 = 2001 ou 2031…
const YEAR_LETTERS = 'ABCDEFGHJKLMNPRSTVWXY';
/**
 * Année du 10e caractère. Le cycle est ambigu (30 ans) : on garde l'année la plus récente
 * qui ne dépasse pas l'année de référence + 1 (une moto « 2027 » se vend dès 2026).
 */
export function vinYear(code: string | null | undefined, refYear = new Date().getFullYear()): number | null {
  const c = (code ?? '').toUpperCase();
  if (c.length !== 1) return null;
  let base: number;
  const li = YEAR_LETTERS.indexOf(c);
  if (li >= 0) base = 1980 + li;
  else if (/^[1-9]$/.test(c)) base = 2000 + Number(c);
  else return null;
  let y = base;
  while (y + 30 <= refYear + 1) y += 30;
  return y;
}

/** Clé du motif : caractères 1 à 9 + caractère 10 (année). null si le VIN n'est pas complet. */
export function vinPatternKey(vin: string | null | undefined): string | null {
  const v = (vin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!isFullVin(v)) return null;
  return v.slice(0, 9) + v[9];
}

/** N° de série (caractères 12 à 17) en nombre ; null s'il contient des lettres. */
export function vinSerial(vin: string | null | undefined): number | null {
  const v = (vin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length !== 17) return null;
  const s = v.slice(11);
  return /^\d{6}$/.test(s) ? Number(s) : null;
}

/** Constructeurs courants à l'atelier (code WMI, 3 premiers caractères), au format de la fiche. */
const WMI_BRANDS: Record<string, string> = {
  ZDM: 'Ducati', ZD4: 'Aprilia', ZAP: 'Piaggio', ZCG: 'MV Agusta', ZGU: 'Moto Guzzi',
  JYA: 'Yamaha', JH2: 'Honda', JKA: 'Kawasaki', JS1: 'Suzuki', VTT: 'Suzuki', WB1: 'BMW', VBK: 'KTM',
  SMT: 'Triumph', '1HD': 'Harley-Davidson', '5HD': 'Harley-Davidson', ZDT: 'Benelli',
};
export function vinBrand(vin: string | null | undefined): string | null {
  const v = (vin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return WMI_BRANDS[v.slice(0, 3)] ?? null;
}

const roundDown = (n: number, r: number) => Math.floor(n / r) * r;
const roundUp = (n: number, r: number) => Math.ceil((n + 1) / r) * r - 1;

/**
 * Construit la table de correspondance à partir de VIN reconnus par l'e-catalog.
 * Une ligne par (motif, modèle-année) : nombre de motos et plage de série ARRONDIE.
 */
export function buildVinPatterns(
  samples: { vin: string; modelYearId: string }[],
  rounding = SERIAL_ROUNDING,
): VinPatternRow[] {
  const acc = new Map<string, { pattern: string; model_year_id: string; min: number; max: number; samples: number }>();
  for (const s of samples) {
    const key = vinPatternKey(s.vin);
    if (!key || !s.modelYearId) continue;
    const serial = vinSerial(s.vin);
    const id = `${key}|${s.modelYearId}`;
    const r = acc.get(id) ?? { pattern: key, model_year_id: s.modelYearId, min: Infinity, max: -Infinity, samples: 0 };
    r.samples++;
    if (serial != null) { r.min = Math.min(r.min, serial); r.max = Math.max(r.max, serial); }
    acc.set(id, r);
  }
  return [...acc.values()]
    .map((r) => ({
      pattern: r.pattern, model_year_id: r.model_year_id, samples: r.samples,
      serial_from: Number.isFinite(r.min) ? roundDown(r.min, rounding) : 0,
      serial_to: Number.isFinite(r.max) ? roundUp(r.max, rounding) : 999_999,
    }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern) || b.samples - a.samples || a.model_year_id.localeCompare(b.model_year_id));
}

/**
 * Classe les candidats d'un motif exact (lignes de même `pattern`) pour un VIN :
 * d'abord ceux dont la plage de série contient le n° de série, puis le plus proche,
 * puis le plus fréquent. Confiance :
 *   - `unique`   : un seul modèle-année connu pour ce motif, vu au moins 5 fois ;
 *   - `probable` : un seul modèle-année mais peu vu, ou le n° de série ne tombe que dans
 *                  la plage d'un seul des candidats ;
 *   - `plusieurs`: plusieurs candidats possibles (versions d'un même modèle) ;
 *   - null       : motif inconnu.
 */
export function rankPatternCandidates(
  vin: string,
  rows: VinPatternRow[],
): { confidence: 'unique' | 'probable' | 'plusieurs' | null; candidates: RankedCandidate[] } {
  const live = rows.filter((r) => r.samples > 0);
  if (!live.length) return { confidence: null, candidates: [] };
  const serial = vinSerial(vin);
  const total = live.reduce((n, r) => n + r.samples, 0);
  const dist = (r: VinPatternRow) =>
    serial == null ? 0 : serial < r.serial_from ? r.serial_from - serial : serial > r.serial_to ? serial - r.serial_to : 0;
  const candidates = live
    .map((r) => ({
      model_year_id: r.model_year_id, samples: r.samples, share: r.samples / total,
      in_range: serial != null && dist(r) === 0, distance: dist(r),
    }))
    .sort((a, b) => a.distance - b.distance || b.samples - a.samples || a.model_year_id.localeCompare(b.model_year_id));
  if (candidates.length === 1) {
    return { confidence: candidates[0].samples >= UNIQUE_MIN_SAMPLES ? 'unique' : 'probable', candidates };
  }
  const inRange = candidates.filter((c) => c.in_range);
  return { confidence: inRange.length === 1 ? 'probable' : 'plusieurs', candidates };
}

/** Modèle-année du catalogue, réduit à ce qui sert à la reconnaissance. */
export type CatalogYear = { id: string; model_id: string; supermodel_id: string; family_id: string; year: number | null };

export type VinIdentification = {
  confidence: VinConfidence;
  /** Modèle-année retenu (`unique` ou `probable`), sinon null. */
  modelYearId: string | null;
  /** Candidats classés (le premier est le plus probable). */
  candidates: string[];
  familyId: string | null;
  supermodelId: string | null;
};

/**
 * Reconnaissance complète avec replis (même logique que `vin_identify` en base) :
 *   1. motif exact (1-9 + année) → unique / probable / plusieurs ;
 *   2. même descripteur (1-9) vu d'autres années → modèles projetés sur l'année du VIN
 *      (`modele` si une seule cylindrée, sinon `famille`) ;
 *   3. mêmes 6 premiers caractères → famille seule (`famille`) ;
 *   4. sinon `inconnu`.
 */
export function identifyVin(
  vin: string,
  rows: VinPatternRow[],
  catalog: Map<string, CatalogYear>,
  refYear = new Date().getFullYear(),
): VinIdentification {
  const v = (vin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const none: VinIdentification = { confidence: 'inconnu', modelYearId: null, candidates: [], familyId: null, supermodelId: null };
  const key = vinPatternKey(v);
  if (!key) return none;
  const known = rows.filter((r) => catalog.has(r.model_year_id));
  const only = <T,>(xs: (T | null | undefined)[]): T | null => {
    const s = new Set(xs.filter((x): x is T => x != null));
    return s.size === 1 ? [...s][0] : null;
  };

  // 1. Motif exact.
  const exact = rankPatternCandidates(v, known.filter((r) => r.pattern === key));
  if (exact.confidence) {
    const ids = exact.candidates.map((c) => c.model_year_id);
    const cat = ids.map((id) => catalog.get(id));
    return {
      confidence: exact.confidence,
      modelYearId: exact.confidence === 'plusieurs' ? null : ids[0],
      candidates: ids,
      familyId: only(cat.map((c) => c?.family_id)),
      supermodelId: only(cat.map((c) => c?.supermodel_id)),
    };
  }

  // 2. Même descripteur, autres années : on projette chaque modèle sur l'année du VIN.
  const year = vinYear(v[9], refYear);
  const sameVds = known.filter((r) => r.pattern.slice(0, 9) === key.slice(0, 9));
  if (sameVds.length) {
    const counts = new Map<string, number>();
    for (const r of sameVds) {
      const m = catalog.get(r.model_year_id)!.model_id;
      counts.set(m, (counts.get(m) ?? 0) + r.samples);
    }
    // Même ordre que la base : fréquence décroissante, puis identifiant du modèle.
    const models = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([m]) => m);
    const years = [...catalog.values()];
    const projected: string[] = [];
    for (const m of models) {
      const hits = years
        .filter((y) => y.model_id === m && y.year != null && year != null && (y.year === year || y.year === year + 1))
        .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
      for (const h of hits) if (!projected.includes(h.id)) projected.push(h.id);
    }
    const src = sameVds.map((r) => catalog.get(r.model_year_id)!);
    const supermodelId = only(src.map((c) => c.supermodel_id));
    return {
      confidence: supermodelId ? 'modele' : 'famille',
      modelYearId: null, candidates: projected,
      familyId: only(src.map((c) => c.family_id)), supermodelId,
    };
  }

  // 3. Mêmes 6 premiers caractères : la famille.
  const prefix = known.filter((r) => r.pattern.slice(0, 6) === key.slice(0, 6));
  const familyId = only(prefix.map((r) => catalog.get(r.model_year_id)!.family_id));
  if (familyId) return { ...none, confidence: 'famille', familyId };
  return none;
}

// ---------------------------------------------------------------------------------------------
// Écran : nom commercial et remplissage sans écrasement
// ---------------------------------------------------------------------------------------------

/** Familles dont le nom fait partie du nom commercial (« MONSTER 821 », pas « SUPERBIKE 1299S »). */
const NAMED_FAMILIES = new Set([
  'MONSTER', 'MULTISTRADA', 'SCRAMBLER', 'HYPERMOTARD', 'DIAVEL', 'SUPERSPORT', 'STREETFIGHTER', 'DESERT X',
]);

const words = (s: string) => s.toUpperCase().split(/\s+/).filter(Boolean);

/**
 * Nom commercial lisible à partir du catalogue : famille + cylindrée + version, sans répétition.
 * ex. (SCRAMBLER, 800, ICON) → « SCRAMBLER 800 ICON » ; (MONSTER, 1200, 1200 S) → « MONSTER 1200 S » ;
 * (MULTISTRADA, MULTISTRADA V4, MULTISTRADA V4 S) → « MULTISTRADA V4 S ».
 */
export function ducatiCommercialName(family: string | null, supermodel: string | null, model: string | null): string {
  const m = words(model ?? '');
  const fam = words(family ?? '');
  const sm = words(supermodel ?? '');
  const startsWithFam = fam.length > 0 && fam.every((w, i) => m[i] === w);
  const containsFam = fam.length > 0 && fam.every((w) => m.includes(w));
  const head = startsWithFam ? fam : !containsFam && NAMED_FAMILIES.has(fam.join(' ')) ? fam : [];
  const tail = startsWithFam ? m.slice(fam.length) : m;
  // Mots de la cylindrée absents du nom (« 1299 » est couvert par « 1299S »).
  const covered = (w: string) => head.includes(w) || tail.some((x) => x === w || x.startsWith(w));
  const middle = sm.filter((w) => !covered(w));
  return [...head, ...middle, ...tail].join(' ');
}

/** Norme antipollution au format de la fiche : « EURO4 » → « EURO 4 », « EURO5+ » → « EURO 5+ ». */
export function normalizeEuro(raw: string | null | undefined): string | null {
  const m = /^EURO\s*([0-9])\s*(\+?)$/i.exec((raw ?? '').trim());
  return m ? `EURO ${m[1]}${m[2]}` : null;
}

/**
 * Remplit les champs vides avec les valeurs déduites du VIN, sans jamais écraser une saisie.
 * Un champ déjà rempli et différent est rendu en `conflicts` (« D'après le VIN : … — Utiliser »).
 */
export function mergeVinSuggestions<T extends Record<string, unknown>>(
  current: T,
  suggested: Partial<Record<keyof T & string, string | number | null | undefined>>,
): { next: T; filled: string[]; conflicts: Record<string, string> } {
  const next: Record<string, unknown> = { ...current };
  const filled: string[] = [];
  const conflicts: Record<string, string> = {};
  const same = (a: string, b: string) => a.trim().toUpperCase().replace(/\s+/g, ' ') === b.trim().toUpperCase().replace(/\s+/g, ' ')
    || (a.trim() !== '' && b.trim() !== '' && !Number.isNaN(Number(a)) && Number(a) === Number(b));
  for (const [k, raw] of Object.entries(suggested)) {
    if (raw == null || raw === '') continue;
    const val = String(raw);
    const cur = current[k];
    const curStr = cur == null ? '' : String(cur);
    if (curStr.trim() === '') { next[k] = val; filled.push(k); }
    else if (!same(curStr, val)) conflicts[k] = val;
  }
  return { next: next as T, filled, conflicts };
}

// ---------------------------------------------------------------------------------------------
// Résultat de `vin_identify` (base) → valeurs proposées pour les champs d'une fiche
// ---------------------------------------------------------------------------------------------

/** Caractéristiques techniques portées par le résultat et par chaque candidat. */
type Specs = {
  displacement_cc?: number | null; power_kw?: number | null; power_cv?: number | null;
  cylinders?: number | null; euro?: string | null;
};

export type VinCandidateInfo = Specs & {
  model_year_id: string; family: string | null; supermodel: string | null; model: string | null;
  name?: string | null; code?: string | null; year: number | null;
  samples: number; share?: number; in_range: boolean; drawings_count: number;
};

export type VinIdentifyResult = Specs & {
  vin: string; valid: boolean; ducati: boolean; brand?: string | null;
  vin_year?: number | null; plant?: string | null;
  confidence: VinConfidence; model_year_id: string | null;
  family_id?: string | null; family?: string | null; supermodel_id?: string | null; supermodel?: string | null;
  model?: string | null; name?: string | null; code?: string | null; year?: number | null;
  drawings_count?: number | null;
  maintenance_plans: { id: string; family: string; model_text: string; usage: string; year_from: number | null; year_to: number | null }[];
  candidates: VinCandidateInfo[]; candidates_total?: number; samples?: number;
};

/** Champs qu'une identification peut remplir (clés « métier », traduites par chaque écran). */
export type VinSuggestKey =
  | 'brand' | 'family' | 'model' | 'model_year' | 'displacement' | 'power_cv' | 'power_kw' | 'cylinders' | 'antipollution';

const numStr = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0 ? undefined : String(Number(n)));

/**
 * Valeurs proposées : celles du candidat choisi par l'utilisateur, sinon du modèle-année
 * reconnu (unique / probable), sinon ce qui est commun à tous les candidats (famille,
 * cylindrée, année du VIN…). Jamais de version devinée quand plusieurs sont possibles.
 */
export function vinSuggestedFields(
  r: VinIdentifyResult | null | undefined,
  chosenId?: string | null,
): Partial<Record<VinSuggestKey, string>> {
  if (!r || !r.valid) return {};
  const out: Partial<Record<VinSuggestKey, string>> = {};
  const brand = vinBrand(r.vin);
  if (brand) out.brand = brand;
  if (!r.ducati) {
    if (r.vin_year) out.model_year = String(r.vin_year);
    return out;
  }
  const chosen = chosenId ? r.candidates.find((c) => c.model_year_id === chosenId) ?? null : null;
  const src: (Specs & { family?: string | null; supermodel?: string | null; model?: string | null; year?: number | null }) | null =
    chosen ?? (r.model_year_id ? r : null);
  const family = src?.family ?? r.family ?? null;
  if (family) out.family = family.toUpperCase();
  if (src?.model) out.model = ducatiCommercialName(family, src.supermodel ?? r.supermodel ?? null, src.model);
  else if (r.supermodel) out.model = ducatiCommercialName(family, r.supermodel, null);
  const year = src?.year ?? r.year ?? r.vin_year;
  if (year) out.model_year = String(year);
  const spec: Specs = src ?? r;
  const disp = numStr(spec.displacement_cc ?? r.displacement_cc);
  if (disp) out.displacement = disp;
  const cv = numStr(spec.power_cv ?? (src ? null : r.power_cv));
  if (cv) out.power_cv = cv;
  const kw = numStr(spec.power_kw ?? (src ? null : r.power_kw));
  if (kw) out.power_kw = kw;
  const cyl = numStr(spec.cylinders ?? r.cylinders);
  if (cyl) out.cylinders = cyl;
  const euro = normalizeEuro(spec.euro ?? r.euro);
  if (euro) out.antipollution = euro;
  return out;
}

/** Candidats à proposer en liste : plusieurs versions possibles, ou reconnaissance à confirmer. */
export function vinNeedsChoice(r: VinIdentifyResult | null | undefined): boolean {
  if (!r || !r.valid || !r.ducati) return false;
  if (r.confidence === 'plusieurs' || r.confidence === 'modele') return r.candidates.length > 0;
  return r.confidence === 'probable' && r.candidates.length > 1;
}

/** Libellé court d'un candidat : « SCRAMBLER 800 ICON 2016 ». */
export function vinCandidateLabel(c: Pick<VinCandidateInfo, 'family' | 'supermodel' | 'model' | 'year'>): string {
  return [ducatiCommercialName(c.family, c.supermodel, c.model), c.year ?? ''].join(' ').trim();
}
