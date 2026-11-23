/**
 * M8 — Fiche de la moto dans la fenêtre du rendez-vous (retour de Domenico, 23/11/2026) : comme
 * l'assistant de planification de G8, on voit d'un coup d'œil ce qui est rempli et on le complète
 * sur place. Règles pures.
 * Tracker, PIN, type de garantie et code d'exposition n'existent pas sur toutes les motos : vides,
 * ils ne comptent pas comme « à compléter ».
 */
export const VEHICLE_SHEET_COLUMNS = [
  'id', 'ducati_model_year_id', 'vin', 'reference', 'brand', 'model', 'plate', 'engine_number', 'origin', 'key_number', 'gps_tracker_id', 'pin_tracker',
  'displacement', 'power_cv', 'is_restricted', 'energy', 'antipollution', 'color', 'category', 'cylinders',
  'first_registration_date', 'mileage', 'last_service_km', 'tpms_av', 'tpms_ar', 'warranty_end', 'warranty_type', 'model_year', 'exposition_code',
].join(', ');

type Cell = string | number | boolean | null | undefined;
export type VehicleSheetRow = Record<string, Cell>;
export type SheetInput = 'read' | 'text' | 'number' | 'date' | 'bool' | 'spec' | 'specNumber';
export type SheetOptionsKey = 'displacement' | 'power_cv' | 'energy' | 'antipollution' | 'color' | 'category' | 'cylinders';
export type SheetField = {
  key: string; labelKey: string; value: string | null; optional: boolean;
  input: SheetInput; optionsKey?: SheetOptionsKey;
};
export type SheetGroup = { titleKey: string; fields: SheetField[] };

const text = (v: Cell): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const num = (v: Cell): string | null => {
  const s = text(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
};
const day = (v: Cell): string | null => {
  const s = text(v);
  return s ? s.slice(0, 10).split('-').reverse().join('/') : null;
};
const km = (v: Cell): string | null => {
  const s = num(v);
  if (s === null) return null;
  return `${s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km`;
};

export function vehicleSheetGroups(v: VehicleSheetRow, words: { yes: string; no: string }): SheetGroup[] {
  const f = (key: string, labelKey: string, value: string | null, input: SheetInput, optional = false, optionsKey?: SheetOptionsKey): SheetField =>
    ({ key, labelKey, value, optional, input, optionsKey });
  return [
    {
      titleKey: 'vehicles.secId',
      fields: [
        f('vin', 'vehicles.vin', text(v.vin), 'read'),
        f('reference', 'vehicles.reference', text(v.reference), 'text'),
        f('brand', 'vehicles.brand', text(v.brand), 'text'),
        f('model', 'vehicles.model', text(v.model), 'text'),
        f('plate', 'vehicles.plate', text(v.plate), 'text'),
        f('engine_number', 'vehicles.engineNumber', text(v.engine_number), 'text'),
        f('origin', 'vehicles.origin', text(v.origin), 'text'),
        f('key_number', 'vehicles.keyNumber', text(v.key_number), 'text'),
      ],
    },
    {
      titleKey: 'vehicles.secInfo',
      fields: [
        f('first_registration_date', 'vehicles.firstRegistration', day(v.first_registration_date), 'date'),
        f('warranty_end', 'vehicles.warrantyEnd', day(v.warranty_end), 'date'),
        f('warranty_type', 'vehicles.warrantyType', text(v.warranty_type), 'text', true),
        // Comme G8 : le dernier kilométrage connu de la moto.
        f('last_visit', 'dossier.sheetLastVisit', km(v.last_service_km ?? v.mileage), 'read', true),
        f('model_year', 'vehicles.modelYear', text(v.model_year), 'number'),
        f('tpms_av', 'vehicles.tpmsAv', text(v.tpms_av), 'text'),
        f('tpms_ar', 'vehicles.tpmsAr', text(v.tpms_ar), 'text'),
        f('gps_tracker_id', 'vehicles.gpsTracker', text(v.gps_tracker_id), 'text', true),
        f('pin_tracker', 'vehicles.pinTracker', text(v.pin_tracker), 'text', true),
        f('exposition_code', 'vehicles.expositionCode', text(v.exposition_code), 'text', true),
      ],
    },
    {
      titleKey: 'vehicles.secCarac',
      fields: [
        f('displacement', 'vehicles.displacement', num(v.displacement), 'specNumber', false, 'displacement'),
        f('power_cv', 'vehicles.powerCv', num(v.power_cv), 'specNumber', false, 'power_cv'),
        f('is_restricted', 'vehicles.restricted', v.is_restricted ? words.yes : words.no, 'bool', true),
        f('energy', 'vehicles.energy', text(v.energy), 'spec', false, 'energy'),
        f('antipollution', 'vehicles.antipollution', text(v.antipollution), 'spec', false, 'antipollution'),
        f('color', 'vehicles.color', text(v.color), 'spec', false, 'color'),
        f('category', 'vehicles.category', text(v.category), 'spec', false, 'category'),
        f('cylinders', 'vehicles.cylinders', num(v.cylinders), 'specNumber', false, 'cylinders'),
      ],
    },
  ];
}

export function sheetMissingCount(groups: readonly SheetGroup[]): number {
  return groups.reduce((n, g) => n + g.fields.filter((x) => !x.optional && x.value === null).length, 0);
}

/** Valeur d'un champ dans sa zone de saisie. */
export function sheetInputValue(field: SheetField, row: VehicleSheetRow): string {
  const v = row[field.key];
  if (v === null || v === undefined) return '';
  if (field.input === 'date') return String(v).slice(0, 10);
  if (field.input === 'number' || field.input === 'specNumber') return num(v) ?? '';
  return String(v);
}

/** Valeur à enregistrer : un champ vidé redevient vide en base. */
export function sheetParseValue(field: SheetField, raw: string | boolean): string | number | boolean | null {
  if (field.input === 'bool') return raw === true;
  const s = String(raw).trim();
  if (!s) return null;
  if (field.input === 'number' || field.input === 'specNumber') {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return s;
}
