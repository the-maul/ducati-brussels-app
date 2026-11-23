/**
 * M3 — Fiche moto (retour de Domenico, 23/11/2026) : les caractéristiques sont standard, on les
 * connaît par le modèle du catalogue et par nos factures pour ce VIN.
 * Rien n'est écrasé : seuls les champs vides sont complétés, et ils ne sont enregistrés qu'à la
 * prochaine sauvegarde de la fiche. Une moto bridée garde sa puissance à saisir.
 */
import { supabase } from '@/integrations/supabase/client';

type Cell = string | number | boolean | null | undefined;
export type VehicleLike = Record<string, unknown>;

export type ModelSpecRow = {
  model_year_id: string; displacement_cc: Cell; power_kw: Cell; power_cv: Cell; cylinders: Cell; euro: Cell;
};
export type VinFactsRow = Record<string, Cell>;

export const ENERGY_OPTIONS = ['Essence', 'Électrique'] as const;
export const COLOR_OPTIONS = [
  'ROUGE', 'NOIR', 'NOIR MAT', 'BLANC', 'GRIS', 'JAUNE', 'ARGENT', 'VERT', 'BLEU', 'ORANGE',
  'DARK STEALTH', 'AVIATOR GREY', 'STAR WHITE SILK', 'ICEBERG WHITE', 'THRILLING BLACK', 'PIKES PEAK',
] as const;

const FACT_KEYS = [
  'reference', 'engine_number', 'color', 'origin', 'plate', 'antipollution', 'displacement', 'power_cv', 'cylinders',
  'model_year', 'first_registration_date', 'warranty_end', 'mileage',
] as const;
const POWER_KEYS = new Set(['power_cv', 'power_kw']);

const isEmpty = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
const usable = (v: Cell) => !isEmpty(v) && String(v).trim() !== '?' && String(v).trim() !== '/';
const num = (v: Cell): number | null => {
  if (!usable(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Valeurs du catalogue : le modèle-année, sinon l'année la plus proche du même modèle. */
export function catalogSpecValues(input: {
  own: ModelSpecRow | null;
  siblings: Array<ModelSpecRow & { year: number | null }>;
  year: number | null;
  family: string | null;
}): Record<string, string | number> {
  const near = [...input.siblings].sort((a, b) =>
    Math.abs((a.year ?? 9999) - (input.year ?? 0)) - Math.abs((b.year ?? 9999) - (input.year ?? 0)));
  const pick = (k: 'displacement_cc' | 'power_cv' | 'power_kw' | 'cylinders') =>
    num(input.own?.[k]) ?? near.map((s) => num(s[k])).find((x) => x != null) ?? null;
  const out: Record<string, string | number> = {};
  const cc = pick('displacement_cc');
  const cv = pick('power_cv');
  const kw = pick('power_kw') ?? (cv != null ? Math.round((cv / 1.35962) * 10) / 10 : null);
  const cyl = pick('cylinders');
  if (cc != null) { out.displacement = cc; out.energy = 'Essence'; }
  if (cv != null) out.power_cv = cv;
  if (kw != null) out.power_kw = kw;
  if (cyl != null) out.cylinders = cyl;
  // La norme change d'une année à l'autre : seulement celle du modèle-année exact.
  if (usable(input.own?.euro)) out.antipollution = String(input.own!.euro);
  if (input.family) out.category = input.family;
  if (input.year != null) out.model_year = input.year;
  return out;
}

/** Complète les champs vides : d'abord nos factures pour ce VIN, puis le catalogue. */
export function fillEmptyVehicleFields<V extends VehicleLike>(
  vehicle: V, facts: VinFactsRow | null, spec: Record<string, string | number> | null,
): { vehicle: V; filled: string[] } {
  const out: VehicleLike = { ...vehicle };
  const filled: string[] = [];
  const put = (k: string, val: Cell) => {
    if (!usable(val) || !isEmpty(out[k])) return;
    if (POWER_KEYS.has(k) && out.is_restricted === true) return;
    out[k] = val;
    filled.push(k);
  };
  if (facts) for (const k of FACT_KEYS) put(k, facts[k]);
  if (spec) for (const [k, v] of Object.entries(spec)) put(k, v);
  return { vehicle: out as V, filled };
}

const loose = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => PromiseLike<{ data: unknown; error: unknown }> & { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
      in: (c: string, v: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
      limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};
const SPEC_COLS = 'model_year_id, displacement_cc, power_kw, power_cv, cylinders, euro';

export async function loadCatalogSpec(modelYearId: string): Promise<Record<string, string | number> | null> {
  const my = (await loose.from('ducati_catalog_model_years').select('id, model_id, year').eq('id', modelYearId).maybeSingle()).data as
    { id: string; model_id: string; year: number | null } | null;
  if (!my) return null;
  const [model, years] = await Promise.all([
    loose.from('ducati_catalog_models').select('family_id').eq('id', my.model_id).maybeSingle(),
    loose.from('ducati_catalog_model_years').select('id, year').eq('model_id', my.model_id),
  ]);
  const familyId = (model.data as { family_id: string | null } | null)?.family_id ?? null;
  const family = familyId
    ? ((await loose.from('ducati_catalog_families').select('description').eq('id', familyId).maybeSingle()).data as { description: string | null } | null)?.description ?? null
    : null;
  const yearRows = (years.data as Array<{ id: string; year: number | null }> | null) ?? [];
  const ids = [...new Set([modelYearId, ...yearRows.map((y) => y.id)])];
  const specs = ((await loose.from('ducati_vin_model_specs').select(SPEC_COLS).in('model_year_id', ids)).data as ModelSpecRow[] | null) ?? [];
  const yearOf = new Map(yearRows.map((y) => [y.id, y.year]));
  return catalogSpecValues({
    own: specs.find((s) => s.model_year_id === modelYearId) ?? null,
    siblings: specs.filter((s) => s.model_year_id !== modelYearId).map((s) => ({ ...s, year: yearOf.get(s.model_year_id) ?? null })),
    year: my.year, family,
  });
}

/** La fiche telle qu'on la connaît. Une lecture en échec laisse simplement la fiche d'origine. */
export async function loadVehicleFill<V extends VehicleLike>(vehicle: V): Promise<{ vehicle: V; filled: string[] }> {
  try {
    const vin = typeof vehicle.vin === 'string' ? vehicle.vin : '';
    const myId = vehicle.ducati_model_year_id != null ? String(vehicle.ducati_model_year_id) : '';
    const [facts, spec] = await Promise.all([
      vin ? loose.from('ducati_vin_facts').select('*').eq('vin', vin).maybeSingle().then((r) => r.data as VinFactsRow | null) : Promise.resolve(null),
      myId ? loadCatalogSpec(myId) : Promise.resolve(null),
    ]);
    return fillEmptyVehicleFields(vehicle, facts, spec);
  } catch {
    return { vehicle, filled: [] };
  }
}

/** Valeurs connues au catalogue pour les listes de cylindrée et de puissance. */
export async function loadSpecOptions(): Promise<{ displacement: string[]; power_cv: string[]; power_kw: string[] }> {
  const rows = ((await loose.from('ducati_vin_model_specs').select('displacement_cc, power_cv').limit(1000)).data as
    Array<{ displacement_cc: Cell; power_cv: Cell }> | null) ?? [];
  const sorted = (vals: Array<number | null>) =>
    [...new Set(vals.filter((x): x is number => x != null))].sort((a, b) => a - b).map(String);
  const cvs = rows.map((r) => num(r.power_cv));
  return {
    displacement: sorted(rows.map((r) => num(r.displacement_cc))),
    power_cv: sorted(cvs),
    power_kw: sorted(cvs.map((c) => (c != null ? Math.round((c / 1.35962) * 10) / 10 : null))),
  };
}
