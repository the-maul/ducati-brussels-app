/**
 * Mission 06, carte 4 — reconnaître la moto par son VIN, hors ligne.
 *
 * Fonctions PURES (aucun accès réseau) partagées par :
 *   - le générateur de la table de correspondance (`tools/vin-patterns/build.ts`),
 *     qui mesure aussi la précision par validation croisée ;
 *   - l'écran (remplissage automatique des champs, choix d'un candidat) ;
 *   - les tests (`tests/vin-identify.test.ts`).
 * La base applique les mêmes règles dans `public.vin_identify(text)` (migration
 * `20260921210000_m3_vin_reconnaissance.sql`, année et `unique` revus par
 * `20261123132000_m3_vin_annee_cycle.sql`) : toute modification ici doit y être reportée.
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
const YEAR_CYCLE = 30;
/**
 * First month in which a new bike can carry next year's code. Measured on DCS production dates:
 * code = production year + 1 only appears from July onwards.
 */
const NEXT_YEAR_CODE_MONTH = 7;

/** Calendar year and month in Brussels, so the browser and the database agree. */
function yearMonthAt(ref: number | Date): { year: number; month: number } {
  if (typeof ref === 'number') return { year: ref, month: 1 };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: 'numeric' }).formatToParts(ref);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month') };
}

/**
 * Year of the 10th VIN character. The code repeats every 30 years, so:
 *  - with catalogue years known for this VIN pattern, keep the cycle closest to them
 *    (a 916 of 1997 and a DesertX of 2027 both carry a V);
 *  - otherwise keep the latest year that is not in the future. Next year's code is only
 *    plausible from July: from then on, without evidence, both cycles are possible → null.
 * A plain number means "that year, before July". Same rules as `_vin_year` in the database.
 */
export function vinYear(
  code: string | null | undefined,
  ref: number | Date = new Date(),
  knownYears?: readonly number[] | null,
): number | null {
  const c = (code ?? '').toUpperCase();
  if (c.length !== 1) return null;
  let base: number;
  const li = YEAR_LETTERS.indexOf(c);
  if (li >= 0) base = 1980 + li;
  else if (/^[1-9]$/.test(c)) base = 2000 + Number(c);
  else return null;
  const { year: refYear, month } = yearMonthAt(ref);
  let latest = base;
  while (latest + YEAR_CYCLE <= refYear + 1) latest += YEAR_CYCLE;

  const known = (knownYears ?? []).filter((y) => Number.isFinite(y));
  if (known.length) {
    let best = latest;
    let bestGap = Infinity;
    // From the most recent cycle down: on a tie the most recent one wins.
    for (let y = latest; y >= base; y -= YEAR_CYCLE) {
      const gap = Math.min(...known.map((k) => Math.abs(k - y)));
      if (gap < bestGap) { best = y; bestGap = gap; }
    }
    return best;
  }
  if (latest <= refYear) return latest;
  if (month >= NEXT_YEAR_CODE_MONTH) return null;
  return latest - YEAR_CYCLE >= base ? latest - YEAR_CYCLE : null;
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
 *   - `unique`   : un seul modèle-année connu pour ce motif, vu au moins 5 fois, et le n° de
 *                  série tombe dans sa plage ;
 *   - `probable` : un seul modèle-année mais peu vu ou hors plage, ou le n° de série ne tombe
 *                  que dans la plage d'un seul des candidats ;
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
    // Outside the serial range seen so far, a single known version is not proof (82 % exact vs 97.5 %).
    const sure = candidates[0].samples >= UNIQUE_MIN_SAMPLES && candidates[0].in_range;
    return { confidence: sure ? 'unique' : 'probable', candidates };
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
  ref: number | Date = new Date(),
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
  const sameVds = known.filter((r) => r.pattern.slice(0, 9) === key.slice(0, 9));
  const year = vinYear(v[9], ref, sameVds.map((r) => catalog.get(r.model_year_id)!.year).filter((y): y is number => y != null));
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

/** The value shared by every candidate; null if one differs, is missing, or the list is cut. */
function commonValue<T>(r: VinIdentifyResult, pick: (c: VinCandidateInfo) => T | null | undefined): T | null {
  const list = r.candidates;
  if (!list.length || (r.candidates_total ?? list.length) > list.length) return null;
  const values = list.map(pick);
  if (values.some((x) => x == null)) return null;
  return new Set(values).size === 1 ? (values[0] as T) : null;
}

/** The VIN alone settles the exact model-year: it can be filled in without a click. */
export function vinIsCertain(r: VinIdentifyResult | null | undefined): boolean {
  return !!r && r.valid && r.ducati && r.confidence === 'unique' && !!r.model_year_id;
}

/**
 * Values to propose: those of the candidate chosen by the user, or of a certain match.
 * When the VIN hesitates, only what every candidate shares (brand, family, displacement):
 * never a model, a version, a year or specs that have not been confirmed.
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
    chosen ?? (vinIsCertain(r) ? r : null);
  if (!src) {
    const hasCandidates = r.candidates.length > 0;
    const family = hasCandidates ? commonValue(r, (c) => c.family) : r.family;
    if (family) out.family = family.toUpperCase();
    const disp = numStr(hasCandidates ? commonValue(r, (c) => c.displacement_cc) : r.displacement_cc);
    if (disp) out.displacement = disp;
    return out;
  }
  const family = src.family ?? r.family ?? null;
  if (family) out.family = family.toUpperCase();
  if (src.model) out.model = ducatiCommercialName(family, src.supermodel ?? r.supermodel ?? null, src.model);
  if (src.year) out.model_year = String(src.year);
  const disp = numStr(src.displacement_cc);
  if (disp) out.displacement = disp;
  const cv = numStr(src.power_cv);
  if (cv) out.power_cv = cv;
  const kw = numStr(src.power_kw);
  if (kw) out.power_kw = kw;
  const cyl = numStr(src.cylinders);
  if (cyl) out.cylinders = cyl;
  const euro = normalizeEuro(src.euro);
  if (euro) out.antipollution = euro;
  return out;
}

/** The user must click a candidate: every answer that is not certain and has candidates. */
export function vinNeedsChoice(r: VinIdentifyResult | null | undefined): boolean {
  if (!r || !r.valid || !r.ducati) return false;
  return (r.confidence === 'plusieurs' || r.confidence === 'modele' || r.confidence === 'probable') && r.candidates.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Preselection from a registration certificate or the DCS title (never a validation)
// ---------------------------------------------------------------------------------------------

export type VinPreselectSource = 'carte_grise' | 'dcs';
export type VinPreselectHints = { carteGrise?: string | null; dcsTitle?: string | null };

/** Words that say nothing about the version. */
const LABEL_NOISE = new Set(['DUCATI', 'ABS', 'MY', 'DE', 'THE']);

function labelTokens(s: string | null | undefined): string[] {
  const up = (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/\+/g, ' PLUS ')
    .replace(/\b(V[24]|\d{3,4})(SP2|SP|SL|RS|S|R)\b/g, '$1 $2')
    .replace(/\bSTRIPE\b/g, 'STRIPES');
  return up.split(/[^A-Z0-9]+/).filter((w) => w && !LABEL_NOISE.has(w) && !/^(19|20)\d\d$/.test(w));
}

/** Words of the version itself: the model name minus family, displacement and generation. */
function versionTokens(c: Pick<VinCandidateInfo, 'family' | 'supermodel' | 'model'>): string[] {
  const shared = new Set([...labelTokens(c.family), ...labelTokens(c.supermodel)]);
  return labelTokens(c.model).filter((w) => !shared.has(w) && !/^\dG$/.test(w));
}

function bestCandidateFor(text: string | null | undefined, candidates: VinCandidateInfo[]): string | null {
  const words = new Set(labelTokens(text));
  if (!words.size) return null;
  let best: string | null = null;
  let bestScore = 0;
  let tied = false;
  for (const c of candidates) {
    const version = versionTokens(c);
    if (!version.length || !version.every((w) => words.has(w))) continue;
    if (version.length > bestScore) { best = c.model_year_id; bestScore = version.length; tied = false; }
    else if (version.length === bestScore) tied = true;
  }
  return tied ? null : best;
}

/**
 * Candidate named without ambiguity by the registration certificate, else by the DCS title.
 * It is only highlighted: the user still has to click it.
 */
export function vinPreselect(
  r: VinIdentifyResult | null | undefined,
  hints: VinPreselectHints | null | undefined,
): { id: string; source: VinPreselectSource } | null {
  if (!vinNeedsChoice(r) || !hints) return null;
  const candidates = r!.candidates;
  const fromCard = bestCandidateFor(hints.carteGrise, candidates);
  if (fromCard) return { id: fromCard, source: 'carte_grise' };
  const fromDcs = bestCandidateFor(hints.dcsTitle, candidates);
  return fromDcs ? { id: fromDcs, source: 'dcs' } : null;
}

/** Libellé court d'un candidat : « SCRAMBLER 800 ICON 2016 ». */
export function vinCandidateLabel(c: Pick<VinCandidateInfo, 'family' | 'supermodel' | 'model' | 'year'>): string {
  return [ducatiCommercialName(c.family, c.supermodel, c.model), c.year ?? ''].join(' ').trim();
}
