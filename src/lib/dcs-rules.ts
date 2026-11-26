/**
 * DCS certification rules (decided by Simon, 23/11/2026). Pure functions, no database:
 * tests/dcs-rules.test.ts.
 *
 *  - R1 factory data: the DCS replaces, the old value goes to `events` (origin `dcs`).
 *  - R2 variable data (plate, mileage, color, owner): nothing is replaced, both values are kept
 *    as a conflict to settle.
 *  - Empty field: filled from the DCS and traced.
 *  - Origin: « Garantie activée par », else « Moto facturée à », only when empty.
 */
import { isCarGarantie } from '@/modules/vehicles/warranty-types';
import { PLATE_LENGTH } from '@/lib/plate';

export const DCS_PAYLOAD_FORMAT = 2;

export type DcsFieldStatus = 'certifie' | 'carte_grise' | 'catalogue' | 'saisi' | 'conflit';
export type DcsRefusal =
  | 'old_extension' | 'not_connected' | 'no_vin' | 'vin_mismatch' | 'bad_read' | 'not_loaded' | 'company_mismatch' | 'duplicate_vin';

export type DcsEventRow = {
  kind: 'upcoming' | 'current' | 'past';
  event_category: string | null; service_type: string | null; reference: string | null;
  state: string | null; symptom: string | null; cause: string | null; km: number | null;
  event_date: string | null; due_date: string | null; dealer: string | null; ducati_event_id: string;
};

export type DcsPayloadV2 = {
  format?: number; vin?: string | null; read_vin?: string | null; requested_vin?: string | null;
  read_error?: string | null; issues?: string[];
  header?: { title?: string | null; descriptor?: string | null; year?: number | null; market?: string | null; plate?: string | null };
  vehicle?: Record<string, unknown>; contact?: Record<string, unknown>;
  maintenance?: DcsEventRow[]; maintenance_tables?: string[];
};

// ---------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------
export function dcsText(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return !s || /^[-–—?]+$/.test(s) ? null : s;
}

/** « 6/07/2022 » or « 2022-07-06 » → ISO date; an impossible date → null. */
export function parseDcsDate(v: unknown): string | null {
  const s = dcsText(v);
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dmy && !iso) return null;
  const [y, m, d] = dmy ? [+dmy[3], +dmy[2], +dmy[1]] : [+iso![1], +iso![2], +iso![3]];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** « 23.436 km » → 23436. Miles and hours are not kilometres. */
export function parseDcsKm(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < 1_000_000 ? v : null;
  const s = dcsText(v);
  const m = s?.match(/^(\d[\d\s.,]*)\s*(km)?$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\D/g, ''));
  return Number.isInteger(n) && n < 1_000_000 ? n : null;
}

const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const words = (v: unknown) => fold(v).split(/[^A-Z0-9]+/).filter(Boolean);

export const normalizeEngine = (v: unknown) => fold(v).replace(/[^A-Z0-9]/g, '');
export const normalizePlate = (v: unknown) => fold(v).replace(/[^A-Z0-9]/g, '');

const COLOR_WORDS: Record<string, string> = {
  ROUGE: 'RED', ROSSO: 'RED', RED: 'RED', BLANC: 'WHITE', BLANCHE: 'WHITE', BIANCO: 'WHITE', WHITE: 'WHITE',
  NOIR: 'BLACK', NOIRE: 'BLACK', NERO: 'BLACK', BLACK: 'BLACK', GRIS: 'GREY', GRISE: 'GREY', GRIGIO: 'GREY',
  GREY: 'GREY', GRAY: 'GREY', JAUNE: 'YELLOW', GIALLO: 'YELLOW', YELLOW: 'YELLOW', BLEU: 'BLUE', BLEUE: 'BLUE',
  BLU: 'BLUE', BLUE: 'BLUE', VERT: 'GREEN', VERTE: 'GREEN', VERDE: 'GREEN', GREEN: 'GREEN', ORANGE: 'ORANGE',
  ARGENT: 'SILVER', SILVER: 'SILVER', MAT: 'MATT', MATTE: 'MATT', MATT: 'MATT',
};
const colorTokens = (v: unknown) => new Set(words(v).filter((w) => w !== 'DUCATI').map((w) => COLOR_WORDS[w] ?? w));

/** « ROUGE » and « DUCATI RED », « BLANCHE » and « ICEBERG WHITE » are the same color. */
export function sameColor(a: unknown, b: unknown): boolean {
  const x = colorTokens(a);
  const y = colorTokens(b);
  if (!x.size || !y.size) return false;
  return [...x].every((w) => y.has(w)) || [...y].every((w) => x.has(w));
}

// ---------------------------------------------------------------------------------------
// Exact model: the DCS title settles between the VIN's candidate versions
// ---------------------------------------------------------------------------------------
export type DcsModelCandidate = {
  model_year_id: string; family?: string | null; supermodel?: string | null;
  model?: string | null; name?: string | null; year?: number | null;
};
export type DcsModelMatch = {
  status: 'certified' | 'conflict';
  reason: 'unique' | 'no_title' | 'no_candidate' | 'year_mismatch' | 'no_match' | 'ambiguous';
  modelYearId: string | null; modelText: string | null; color: string | null; candidateIds: string[];
};

const COLOR_PHRASES = new Set([
  'DARK STEALTH', 'STAR WHITE SILK', 'WHITE SILK', 'LIQUID CONCRETE GREY', 'ORANGE SUNSHINE', 'BLACK COFFEE',
  'PIKES PEAK', 'PIKES PEAK LIVERY', 'SP LIVERY', 'RS LIVERY', 'LIVERY', 'CORSE', 'TRICOLORE',
]);
const BASE_COLORS = new Set(['RED', 'WHITE', 'BLACK', 'GREY', 'GRAY', 'YELLOW', 'BLUE', 'GREEN', 'ORANGE', 'SILVER']);
const VERSION_WORDS = new Set(['TOURING', 'SPORT', 'ENDURO', 'ABS', 'GT', 'GRANTURISMO', 'RALLY', 'TRAVEL', 'S', 'R', 'RS', 'SP', 'EVO', 'PLUS']);

function isColorPhrase(tokens: string[]): boolean {
  if (!tokens.length) return true;
  if (COLOR_PHRASES.has(tokens.join(' '))) return true;
  return tokens.length <= 2 && BASE_COLORS.has(tokens[tokens.length - 1]) && !VERSION_WORDS.has(tokens[0]);
}

/** Color at the end of a title, without the catalogue. */
function trailingColor(tokens: string[]): string | null {
  for (let n = Math.min(3, tokens.length - 1); n >= 1; n--) {
    const tail = tokens.slice(-n);
    if (isColorPhrase(tail)) return tail.join(' ');
  }
  return null;
}

const startsWith = (a: string[], b: string[]) => b.length > 0 && b.length <= a.length && b.every((w, i) => a[i] === w);

function joinNames(prefix: string[], name: string[]): string[] {
  if (!prefix.length || startsWith(name, prefix)) return name;
  if (prefix[0] === name[0]) return [...prefix, ...name.slice(1)]; // « 1299 PANIGALE » + « 1299 ABS »
  return [...prefix, ...name];
}

function candidateNames(c: DcsModelCandidate): string[][] {
  const base = [words(c.model), words(c.name)].filter((n) => n.length);
  const out = [...base];
  for (const b of base) for (const p of [words(c.family), words(c.supermodel)]) out.push(joinNames(p, b));
  return out;
}

export function matchDcsModel(descriptor: unknown, year: unknown, candidates: DcsModelCandidate[]): DcsModelMatch {
  const title = words(descriptor);
  const candidateIds = candidates.map((c) => c.model_year_id);
  const conflict = (reason: DcsModelMatch['reason']): DcsModelMatch => ({
    status: 'conflict', reason, modelYearId: null, candidateIds,
    modelText: title.length ? (trailingColor(title) ? title.slice(0, -trailingColor(title)!.split(' ').length) : title).join(' ') : null,
    color: title.length ? trailingColor(title) : null,
  });
  if (!title.length) return conflict('no_title');
  if (!candidates.length) return conflict('no_candidate');
  const sameYear = typeof year === 'number' ? candidates.filter((c) => c.year === year) : candidates;
  if (!sameYear.length) return conflict('year_mismatch');

  const matches = sameYear.flatMap((c) => {
    const lengths = candidateNames(c).filter((n) => startsWith(title, n)).map((n) => n.length);
    return lengths.length ? [{ c, len: Math.max(...lengths) }] : [];
  });
  if (!matches.length) return conflict('no_match');

  // The rest of the title must be a color; otherwise a shorter version would swallow a variant word.
  const withColor = matches.filter((m) => isColorPhrase(title.slice(m.len)));
  // A single candidate may have a color we do not know yet, but never a leftover version word.
  const loneIsCoherent = matches.length === 1 && !title.slice(matches[0].len).some((w) => VERSION_WORDS.has(w));
  const pool = withColor.length ? withColor : loneIsCoherent ? matches : [];
  if (!pool.length) return conflict('ambiguous');
  const best = Math.max(...pool.map((m) => m.len));
  const top = pool.filter((m) => m.len === best);
  if (new Set(top.map((m) => m.c.model_year_id)).size !== 1) return conflict('ambiguous');
  const rest = title.slice(best);
  return {
    status: 'certified', reason: 'unique', modelYearId: top[0].c.model_year_id, candidateIds,
    modelText: title.slice(0, best).join(' '), color: rest.length ? rest.join(' ') : null,
  };
}

// ---------------------------------------------------------------------------------------
// Payload and company checks
// ---------------------------------------------------------------------------------------
export function checkDcsPayload(p: DcsPayloadV2 | null | undefined): DcsRefusal | null {
  if (!p || p.format !== DCS_PAYLOAD_FORMAT) return 'old_extension';
  // The portal sent the tab to its sign-in page: nobody is connected to the DCS in this Chrome.
  if (p.read_error === 'not_connected') return 'not_connected';
  if (p.read_error === 'vin_mismatch') return 'vin_mismatch';
  if (p.read_error === 'vin_not_found' || !p.read_vin) return 'no_vin';
  if (p.read_error === 'details_not_loaded') return 'not_loaded';
  if (p.read_error) return 'bad_read';
  if ((p.issues ?? []).some((i) => i.startsWith('label_as_value:') || i === 'vin_ambiguous')) return 'bad_read';
  const read = String(p.read_vin).toUpperCase();
  if (p.vin && String(p.vin).toUpperCase() !== read) return 'vin_mismatch';
  if (p.requested_vin && String(p.requested_vin).toUpperCase() !== read) return 'vin_mismatch';
  return null;
}

/**
 * Which record receives the DCS reading. One record: that one. Several records with the same VIN
 * (old G8 record + trade-in record, for instance): the record the update was launched from, never
 * a guess.
 */
export function pickDcsVehicle<T extends { id: string }>(found: T[], requestedVehicleId?: string | null): T | 'duplicate' | null {
  if (found.length === 0) return null;
  if (found.length === 1) return found[0];
  return found.find((v) => v.id === requestedVehicleId) ?? 'duplicate';
}

/**
 * Company of the request vs. company active on arrival.
 * No known request (manual button, reloaded page) = the user must confirm the company.
 */
export function dcsCompanyCheck(requested: string | null | undefined, active: string | null | undefined): 'ok' | 'mismatch' | 'confirm' {
  if (!active) return 'mismatch';
  if (!requested) return 'confirm';
  return requested === active ? 'ok' : 'mismatch';
}

// ---------------------------------------------------------------------------------------
// Field-by-field plan
// ---------------------------------------------------------------------------------------
export type DcsChange = { field: string; old: string | null; new: string | number; action: 'filled' | 'replaced' };
export type DcsStatusRow = { field: string; status: DcsFieldStatus; dcs_value: string | null; previous_value: string | null; source: 'dcs' | 'decision' };
/** DCS values already settled by a user (field -> value read at that time): not asked again. */
export type DcsDecisions = Record<string, string | null | undefined>;
export type DcsCounts = { confirmed: number; replaced: number; filled: number; conflicts: number };
export type DcsPlan = { changes: DcsChange[]; statuses: DcsStatusRow[]; invalid: string[]; counts: DcsCounts };
export type DcsOwnerCheck = { name: string | null; currentName: string | null; matches: boolean };

const asText = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const isEmpty = (v: unknown) => (typeof v === 'number' ? false : dcsText(v) === null);
const sameText = (a: unknown, b: unknown) => words(a).join(' ') === words(b).join(' ');

type Rule = 'factory' | 'variable';
type FieldDef = { field: string; rule: Rule; read: (v: Record<string, unknown>) => string | number | null; same: (a: unknown, b: unknown) => boolean; valid?: (x: string) => boolean };

const sameDate = (a: unknown, b: unknown) => parseDcsDate(a) === parseDcsDate(b);
const text = (k: string) => (v: Record<string, unknown>) => dcsText(v[k]);
const date = (k: string) => (v: Record<string, unknown>) => parseDcsDate(v[k]);

const FIELDS: FieldDef[] = [
  { field: 'engine_number', rule: 'factory', read: text('engine_number'), same: (a, b) => normalizeEngine(a) === normalizeEngine(b), valid: (x) => /^[A-Z0-9]{4,24}$/.test(normalizeEngine(x)) },
  { field: 'production_date', rule: 'factory', read: date('production_date'), same: sameDate },
  { field: 'ship_date', rule: 'factory', read: date('ship_date'), same: sameDate },
  { field: 'warranty_start', rule: 'factory', read: date('warranty_start'), same: sameDate },
  { field: 'warranty_end', rule: 'factory', read: date('warranty_end'), same: sameDate },
  { field: 'warranty_state', rule: 'factory', read: text('warranty_state'), same: sameText },
  { field: 'warranty_activated_by', rule: 'factory', read: text('warranty_activated_by'), same: sameText },
  { field: 'invoiced_to', rule: 'factory', read: text('invoiced_to'), same: sameText },
  { field: 'ducati_state', rule: 'factory', read: text('ducati_state'), same: sameText },
  { field: 'ducati_usage', rule: 'factory', read: text('ducati_usage'), same: sameText },
  { field: 'mileage', rule: 'variable', read: (v) => parseDcsKm(v.last_km), same: (a, b) => Number(a) === Number(b) },
];

export function planDcsImport(input: {
  current: Record<string, unknown>;
  payload: DcsPayloadV2;
  model: DcsModelMatch;
  owner?: DcsOwnerCheck | null;
  decisions?: DcsDecisions;
}): DcsPlan {
  const { current, payload, model, owner, decisions } = input;
  const v = payload.vehicle ?? {};
  const plan: DcsPlan = { changes: [], statuses: [], invalid: [], counts: { confirmed: 0, replaced: 0, filled: 0, conflicts: 0 } };

  const status = (field: string, s: DcsFieldStatus, dcs: unknown, previous: unknown, source: DcsStatusRow['source'] = 'dcs') =>
    plan.statuses.push({ field, status: s, dcs_value: asText(dcs), previous_value: asText(previous), source });
  const settled = (field: string, dcs: unknown, same: (a: unknown, b: unknown) => boolean) => {
    const value = decisions?.[field];
    return value !== null && value !== undefined && same(value, dcs);
  };

  const decide = (field: string, rule: Rule, dcs: string | number, same: (a: unknown, b: unknown) => boolean) => {
    const cur = current[field];
    if (isEmpty(cur)) {
      plan.changes.push({ field, old: asText(cur), new: dcs, action: 'filled' });
      plan.counts.filled++;
      status(field, 'certifie', dcs, cur);
    } else if (same(cur, dcs)) {
      plan.counts.confirmed++;
      status(field, 'certifie', dcs, cur);
    } else if (rule === 'factory') {
      plan.changes.push({ field, old: asText(cur), new: dcs, action: 'replaced' });
      plan.counts.replaced++;
      status(field, 'certifie', dcs, cur);
    } else if (settled(field, dcs, same)) {
      status(field, 'saisi', dcs, cur, 'decision');
    } else {
      plan.counts.conflicts++;
      status(field, 'conflit', dcs, cur);
    }
  };

  for (const f of FIELDS) {
    const dcs = f.read(v);
    if (dcs === null) {
      if (dcsText(f.field === 'mileage' ? v.last_km : v[f.field])) plan.invalid.push(f.field);
      continue;
    }
    if (f.valid && !f.valid(String(dcs))) { plan.invalid.push(f.field); continue; }
    decide(f.field, f.rule, dcs, f.same);
  }

  // Warranty type: factory data, except a CarGarantie already chosen in the DMS.
  const warrantyType = dcsText(v.warranty_type);
  if (warrantyType) {
    if (isCarGarantie(current.warranty_type)) status('warranty_type', 'saisi', warrantyType, current.warranty_type);
    else decide('warranty_type', 'factory', warrantyType, sameText);
  }

  // Plate and color: variable data, compared once normalized. The DCS shows « M-ACN-057 »:
  // the plate is kept and written without dashes, and an empty plate is only filled with
  // exactly 7 characters (same rule as dcs_resolve_field and the vehicle form).
  const plate = dcsText(payload.header?.plate);
  if (plate) {
    const clean = normalizePlate(plate);
    const fillable = !isEmpty(current.plate) || clean.length === PLATE_LENGTH;
    if (/^[A-Z0-9]{2,12}$/.test(clean) && fillable) decide('plate', 'variable', clean, (a, b) => normalizePlate(a) === normalizePlate(b));
    else plan.invalid.push('plate');
  }
  if (model.color) decide('color', 'variable', model.color, sameColor);

  // Exact model: only when a single candidate agrees with the title.
  if (model.status === 'certified' && model.modelYearId && model.modelText) {
    decide('model', 'factory', model.modelText, sameText);
    decide('ducati_model_year_id', 'factory', model.modelYearId, (a, b) => String(a) === String(b));
  } else if (model.modelText && settled('model', model.modelText, sameText)) {
    status('model', 'saisi', model.modelText, current.model, 'decision');
    status('ducati_model_year_id', 'saisi', current.ducati_model_year_id, current.ducati_model_year_id, 'decision');
  } else if (model.modelText) {
    plan.counts.conflicts++;
    status('model', 'conflit', model.modelText, current.model);
    status('ducati_model_year_id', 'conflit', model.candidateIds.join(',') || null, current.ducati_model_year_id);
  }

  // Origin: never replaces a known value.
  const origin = dcsText(v.warranty_activated_by) ?? dcsText(v.invoiced_to);
  if (origin) {
    if (isEmpty(current.origin)) {
      plan.changes.push({ field: 'origin', old: asText(current.origin), new: origin, action: 'filled' });
      plan.counts.filled++;
      status('origin', 'certifie', origin, current.origin);
    } else if (sameText(current.origin, origin)) {
      plan.counts.confirmed++;
      status('origin', 'certifie', origin, current.origin);
    } else {
      status('origin', 'saisi', origin, current.origin);
    }
  }

  // Owner: variable data, never written from the DCS.
  if (owner?.name) {
    if (owner.matches) { plan.counts.confirmed++; status('owner', 'certifie', owner.name, owner.currentName); }
    else if (settled('owner', owner.name, sameText)) status('owner', 'saisi', owner.name, owner.currentName, 'decision');
    else { plan.counts.conflicts++; status('owner', 'conflit', owner.name, owner.currentName); }
  }
  return plan;
}

/**
 * What may be written on the customer record: `my_ducati_*` only, never the main contact details
 * or the DMS marketing consents. The rest of the DCS block stays in `my_ducati_data`.
 */
export function buildDcsContactPatch(c: Record<string, unknown>, first: string, last: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const put = (k: string, value: unknown) => { const s = dcsText(value); if (s) patch[k] = s; };
  put('my_ducati_first_name', first);
  put('my_ducati_last_name', last);
  const email = dcsText(c.my_ducati_email);
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) patch.my_ducati_email = email;
  put('my_ducati_phone', c.my_ducati_phone);
  put('my_ducati_city', c.my_ducati_city);
  put('my_ducati_country', c.my_ducati_country);
  for (const k of ['my_ducati_marketing', 'my_ducati_profiling', 'my_ducati_is_current_owner']) {
    if (typeof c[k] === 'boolean') patch[k] = c[k];
  }
  const score = c.my_ducati_score;
  if (typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 7) patch.my_ducati_score = score;
  const extra: Record<string, string> = {};
  for (const k of ['ducati_code', 'birth_date', 'address', 'postal_code', 'region']) {
    const s = dcsText(c[k]);
    if (s) extra[k] = s;
  }
  if (Object.keys(extra).length) patch.my_ducati_data = extra;
  return patch;
}

// ---------------------------------------------------------------------------------------
// Customer read at the DCS, kept for the bike
// ---------------------------------------------------------------------------------------
export type DcsClientSnapshot = {
  full_name: string | null; first_name: string | null; last_name: string | null; email: string | null;
  mobile: string | null; address: string | null; postal_code: string | null; city: string | null;
  region: string | null; country: string | null; country_code: string | null; birth_date: string | null;
  ducati_code: string | null;
};

const COUNTRY_CODES: Record<string, string> = {
  BE: 'BE', BELGIUM: 'BE', BELGIQUE: 'BE', BELGIE: 'BE', BELGIO: 'BE', FR: 'FR', FRANCE: 'FR', FRANKRIJK: 'FR', FRANCIA: 'FR',
  LU: 'LU', LUXEMBOURG: 'LU', LUXEMBURG: 'LU', LUSSEMBURGO: 'LU', NL: 'NL', NETHERLANDS: 'NL', 'THE NETHERLANDS': 'NL',
  'PAYS BAS': 'NL', NEDERLAND: 'NL', 'PAESI BASSI': 'NL', DE: 'DE', GERMANY: 'DE', ALLEMAGNE: 'DE', DUITSLAND: 'DE',
  DEUTSCHLAND: 'DE', GERMANIA: 'DE', IT: 'IT', ITALY: 'IT', ITALIE: 'IT', ITALIA: 'IT', ES: 'ES', SPAIN: 'ES',
  ESPAGNE: 'ES', SPANJE: 'ES', SPAGNA: 'ES', PT: 'PT', PORTUGAL: 'PT', PORTOGALLO: 'PT', CH: 'CH', SWITZERLAND: 'CH',
  SUISSE: 'CH', ZWITSERLAND: 'CH', SVIZZERA: 'CH', GB: 'GB', UK: 'GB', 'UNITED KINGDOM': 'GB', 'ROYAUME UNI': 'GB',
  AT: 'AT', AUSTRIA: 'AT', AUTRICHE: 'AT', OOSTENRIJK: 'AT',
};

/** ISO code of a country read at the DCS; an unknown name stays empty rather than being guessed. */
export function dcsCountryCode(v: unknown): string | null {
  const key = words(v).join(' ');
  return key ? COUNTRY_CODES[key] ?? null : null;
}

/**
 * The customer block kept for the bike. Marketing and profiling flags are left out on purpose:
 * DCS consents are never carried over to the DMS.
 */
export function buildDcsClientSnapshot(c: Record<string, unknown> | null | undefined, first: string, last: string): DcsClientSnapshot | null {
  if (!c) return null;
  const firstName = dcsText(first);
  const lastName = dcsText(last);
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;
  const code = dcsText(c.ducati_code);
  if (!fullName && !code) return null;
  const email = dcsText(c.my_ducati_email);
  const country = dcsText(c.my_ducati_country);
  return {
    full_name: fullName, first_name: firstName, last_name: lastName,
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    mobile: dcsText(c.my_ducati_phone), address: dcsText(c.address), postal_code: dcsText(c.postal_code),
    city: dcsText(c.my_ducati_city), region: dcsText(c.region), country, country_code: dcsCountryCode(country),
    birth_date: parseDcsDate(c.birth_date), ducati_code: code,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rows actually sent to the database: dates checked, one row per Ducati id. */
export function cleanDcsEvents(rows: unknown): DcsEventRow[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, DcsEventRow>();
  const rank = { upcoming: 0, current: 1, past: 2 } as const;
  for (const raw of rows as DcsEventRow[]) {
    if (!raw || !['upcoming', 'current', 'past'].includes(raw.kind)) continue;
    const id = dcsText(raw.ducati_event_id);
    if (!id) continue;
    const row: DcsEventRow = {
      ...raw, ducati_event_id: id,
      event_date: raw.event_date && ISO_DATE.test(raw.event_date) ? parseDcsDate(raw.event_date) : null,
      due_date: raw.due_date && ISO_DATE.test(raw.due_date) ? parseDcsDate(raw.due_date) : null,
      km: parseDcsKm(raw.km),
    };
    const old = byId.get(id);
    if (!old || rank[row.kind] >= rank[old.kind]) byId.set(id, row);
  }
  return [...byId.values()];
}
