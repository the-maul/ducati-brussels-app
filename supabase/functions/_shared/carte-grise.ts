// Mission 04, carte 7 — lecture du certificat d'immatriculation belge (« carte grise »,
// parties I et II) par Claude, puis MAPPAGE vers les champs du formulaire véhicule.
//
// Fichier autonome (aucun import) : utilisé par l'Edge Function read-id-doc (Deno, mode
// « carte_grise ») et par le test unitaire tests/carte-grise.test.ts (Bun).
//
// Codes des cases (directive 1999/37/CE, reprise par la carte grise belge) :
//   A   numéro d'immatriculation            B   date de première immatriculation
//   C.1 titulaire (C.1.1 nom, C.1.2 prénoms) D.1 marque
//   D.2 type / variante / version           D.3 dénomination commerciale (modèle)
//   E   numéro d'identification (VIN)       J   catégorie du véhicule (L3e = moto)
//   P.1 cylindrée (cm³)                     P.2 puissance nette maximale (kW)
//   P.3 carburant / source d'énergie        R   couleur
//   V.9 classe environnementale (norme Euro)
//
// Règle : Claude recopie ce qu'il lit case par case avec un indice de confiance ; ce
// fichier NORMALISE (majuscules, dates ISO, nombres, plaque belge) et BAISSE la confiance
// d'une valeur qui ne passe pas le contrôle. L'employé vérifie toujours avant d'enregistrer.

export type Confidence = 'high' | 'medium' | 'low';

export type RawField = { value: string | null; confidence: Confidence };

/** Cases lues sur la carte grise (clés sans point : D.1 → D1). */
export const CARTE_GRISE_KEYS = [
  'A', 'B', 'C11', 'C12', 'D1', 'D2', 'D3', 'E', 'J', 'P1', 'P2', 'P3', 'R', 'V9',
] as const;
export type CarteGriseKey = typeof CARTE_GRISE_KEYS[number];

export type RawCarteGrise = {
  is_registration_certificate: boolean;
  fields: Record<CarteGriseKey, RawField>;
};

/** Champs du formulaire véhicule que la lecture peut pré-remplir. */
export type VehicleField =
  | 'vin' | 'plate' | 'first_registration_date' | 'brand' | 'model' | 'displacement'
  | 'power_kw' | 'power_cv' | 'energy' | 'antipollution' | 'color';

export type MappedCarteGrise = {
  /** false : le document ne ressemble pas à une carte grise (aucune valeur renvoyée). */
  is_registration_certificate: boolean;
  /** Valeurs au format du formulaire (texte, comme les champs de saisie). */
  values: Partial<Record<VehicleField, string>>;
  confidence: Partial<Record<VehicleField, Confidence>>;
  /** Case lue mais non reprise telle quelle (ex. V.9 illisible pour la liste des normes). */
  unmapped: { code: string; raw: string }[];
  /** Titulaire (C.1) : à comparer au client, jamais écrit dans la fiche véhicule. */
  holder: string | null;
};

const fieldSchema = {
  type: 'object',
  properties: {
    value: { type: ['string', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['value', 'confidence'],
  additionalProperties: false,
} as const;

/** Schéma de sortie structurée demandé à Claude. */
export const CARTE_GRISE_SCHEMA = {
  type: 'object',
  properties: {
    is_registration_certificate: { type: 'boolean' },
    fields: {
      type: 'object',
      properties: Object.fromEntries(CARTE_GRISE_KEYS.map((k) => [k, fieldSchema])),
      required: [...CARTE_GRISE_KEYS],
      additionalProperties: false,
    },
  },
  required: ['is_registration_certificate', 'fields'],
  additionalProperties: false,
} as const;

export const CARTE_GRISE_PROMPT =
  "Ces images (ou ce PDF) sont un certificat d'immatriculation belge (carte grise, partie I " +
  "et/ou partie II) d'une moto. Recopie EXACTEMENT ce qui est imprime dans chaque case, sans " +
  "rien deviner ni completer : A (numero d'immatriculation), B (date de premiere immatriculation), " +
  "C11 (C.1.1 nom du titulaire), C12 (C.1.2 prenoms du titulaire), D1 (D.1 marque), " +
  "D2 (D.2 type/variante/version), D3 (D.3 denomination commerciale), E (numero d'identification " +
  "du vehicule, 17 caracteres), J (categorie), P1 (P.1 cylindree en cm3), P2 (P.2 puissance nette " +
  "maximale en kW), P3 (P.3 carburant ou source d'energie), R (couleur), V9 (V.9 classe " +
  "environnementale / norme Euro). Dates au format JJ/MM/AAAA telles qu'imprimees. " +
  "confidence = high si la case est nette, medium si un caractere est douteux, low si tu " +
  "n'es pas sur. value = null si la case est absente, vide ou illisible. " +
  "is_registration_certificate = false si le document n'est pas un certificat d'immatriculation.";

// ------------------------------------------------------------------ normalisation
const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

const lower = (a: Confidence, b: Confidence): Confidence => {
  const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  return rank[a] <= rank[b] ? a : b;
};

/** VIN : majuscules, lettres et chiffres (même règle que src/lib/vin.ts). */
export function normalizeVinValue(raw: string): { value: string; suspicious: boolean } | null {
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!v) return null;
  return { value: v, suspicious: v.length !== 17 || /[IOQ]/.test(v) };
}

/** Plaque belge : 1-ABC-123 ou M-ABC-123 (moto) ; sinon majuscules sans espaces superflus. */
export function normalizePlate(raw: string): { value: string; suspicious: boolean } | null {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;
  const m = compact.match(/^([0-9M])([A-Z]{3})([0-9]{3})$/);
  if (m) return { value: `${m[1]}-${m[2]}-${m[3]}`, suspicious: false };
  return { value: clean(raw).toUpperCase(), suspicious: true };
}

/** Date imprimée (JJ/MM/AAAA, JJ.MM.AAAA, JJ-MM-AAAA ou AAAA-MM-JJ) → AAAA-MM-JJ, sinon null. */
export function normalizeDate(raw: string, today: Date = new Date()): string | null {
  const s = clean(raw);
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || dt.getTime() > today.getTime() + 86_400_000) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Nombre imprimé : « 1262 », « 1.262 » (milliers), « 84,0 », « 84.00 kW » → nombre, sinon null. */
export function parseNumber(raw: string): number | null {
  let s = clean(raw).toLowerCase().replace(/(cm3|cm³|cc|kw|ch|cv)$/i, '').replace(/\s/g, '');
  if (/^\d{1,3}[.,]\d{3}$/.test(s)) s = s.replace(/[.,]/, '');        // séparateur de milliers
  s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** P.3 → libellé du DMS (les fiches existantes portent « ESSENCE »). */
export function normalizeEnergy(raw: string): string {
  const s = clean(raw).toUpperCase();
  if (/HYBR/.test(s)) return 'HYBRIDE';
  if (/[EÉ]LE[CK]/.test(s)) return 'ÉLECTRIQUE';
  if (/DIES|GAZOLE|GASOIL/.test(s)) return 'DIESEL';
  if (/ESS|BENZ|PETROL|GASOLINE|^E$/.test(s)) return 'ESSENCE';
  return s;
}

/** V.9 → valeur de la liste du formulaire (NA, EURO 3, EURO 4, EURO 5, EURO 5+) ou null. */
export function normalizeEuro(raw: string): string | null {
  const s = clean(raw).toUpperCase().replace(/\s+/g, '');
  const m = s.match(/(?:EURO|EU|^E)([2-5])(\+)?/);
  if (m) {
    const n = +m[1];
    if (n < 3) return null;
    return `EURO ${n}${m[2] && n === 5 ? '+' : ''}`;
  }
  return null;
}

/** Puissance en CV (ch DIN) déduite des kW : 1 kW = 1,35962 ch. */
export const kwToCv = (kw: number) => Math.round(kw * 1.35962);

// ------------------------------------------------------------------ mappage
export function mapCarteGrise(raw: RawCarteGrise | null | undefined, today: Date = new Date()): MappedCarteGrise {
  const out: MappedCarteGrise = {
    is_registration_certificate: !!raw?.is_registration_certificate,
    values: {}, confidence: {}, unmapped: [], holder: null,
  };
  if (!raw || !raw.is_registration_certificate || !raw.fields) return out;
  const f = raw.fields;
  const read = (k: CarteGriseKey): { v: string; c: Confidence } | null => {
    const x = f[k];
    const v = clean(x?.value);
    if (!x || !v) return null;
    const c: Confidence = x.confidence === 'high' || x.confidence === 'medium' ? x.confidence : 'low';
    return { v, c };
  };
  const put = (field: VehicleField, value: string, c: Confidence) => {
    out.values[field] = value;
    out.confidence[field] = c;
  };

  const e = read('E');
  if (e) { const n = normalizeVinValue(e.v); if (n) put('vin', n.value, n.suspicious ? 'low' : e.c); }

  const a = read('A');
  if (a) { const n = normalizePlate(a.v); if (n) put('plate', n.value, n.suspicious ? lower(a.c, 'medium') : a.c); }

  const b = read('B');
  if (b) {
    const d = normalizeDate(b.v, today);
    if (d) put('first_registration_date', d, b.c);
    else out.unmapped.push({ code: 'B', raw: b.v });
  }

  const d1 = read('D1');
  if (d1) put('brand', d1.v.toUpperCase(), d1.c);
  const d3 = read('D3');
  if (d3) put('model', d3.v.toUpperCase(), d3.c);

  const p1 = read('P1');
  if (p1) {
    const n = parseNumber(p1.v);
    if (n != null && n >= 40 && n <= 3000) put('displacement', fmt(n), p1.c);
    else out.unmapped.push({ code: 'P.1', raw: p1.v });
  }

  const p2 = read('P2');
  if (p2) {
    const n = parseNumber(p2.v);
    if (n != null && n > 0 && n <= 400) {
      put('power_kw', fmt(n), p2.c);
      put('power_cv', String(kwToCv(n)), p2.c);          // calculée, la carte grise ne porte que les kW
    } else out.unmapped.push({ code: 'P.2', raw: p2.v });
  }

  const p3 = read('P3');
  if (p3) put('energy', normalizeEnergy(p3.v), p3.c);

  const v9 = read('V9');
  if (v9) {
    const n = normalizeEuro(v9.v);
    if (n) put('antipollution', n, v9.c);
    else out.unmapped.push({ code: 'V.9', raw: v9.v });
  }

  const r = read('R');
  if (r) put('color', r.v.toUpperCase(), r.c);

  const holder = [read('C11')?.v, read('C12')?.v].filter(Boolean).join(' ').trim();
  out.holder = holder || null;
  return out;
}
