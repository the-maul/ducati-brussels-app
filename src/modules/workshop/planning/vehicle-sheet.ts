/**
 * M8 — Fiche de la moto dans la fenêtre du rendez-vous (retour de Domenico, 23/11/2026) : comme
 * l'assistant de planification de G8, on voit d'un coup d'œil ce qui est rempli. Règles pures.
 * Tracker, PIN et code d'exposition n'existent pas sur toutes les motos : vides, ils ne comptent
 * pas comme « à compléter ».
 */
export const VEHICLE_SHEET_COLUMNS = [
  'id', 'ducati_model_year_id', 'vin', 'reference', 'brand', 'model', 'plate', 'engine_number', 'origin', 'key_number', 'gps_tracker_id', 'pin_tracker',
  'displacement', 'power_cv', 'is_restricted', 'energy', 'antipollution', 'color', 'category', 'cylinders',
  'first_registration_date', 'mileage', 'last_service_km', 'tpms_av', 'tpms_ar', 'warranty_end', 'model_year', 'exposition_code',
].join(', ');

type Cell = string | number | boolean | null | undefined;
export type VehicleSheetRow = Record<string, Cell>;
export type SheetField = { key: string; labelKey: string; value: string | null; optional: boolean };
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
  const f = (key: string, labelKey: string, value: string | null, optional = false): SheetField => ({ key, labelKey, value, optional });
  return [
    {
      titleKey: 'vehicles.secId',
      fields: [
        f('vin', 'vehicles.vin', text(v.vin)),
        f('reference', 'vehicles.reference', text(v.reference)),
        f('brand', 'vehicles.brand', text(v.brand)),
        f('model', 'vehicles.model', text(v.model)),
        f('plate', 'vehicles.plate', text(v.plate)),
        f('engine_number', 'vehicles.engineNumber', text(v.engine_number)),
        f('origin', 'vehicles.origin', text(v.origin)),
        f('key_number', 'vehicles.keyNumber', text(v.key_number)),
      ],
    },
    {
      titleKey: 'vehicles.secCarac',
      fields: [
        f('displacement', 'vehicles.displacement', num(v.displacement)),
        f('power_cv', 'vehicles.powerCv', num(v.power_cv)),
        f('is_restricted', 'vehicles.restricted', v.is_restricted ? words.yes : words.no, true),
        f('energy', 'vehicles.energy', text(v.energy)),
        f('antipollution', 'vehicles.antipollution', text(v.antipollution)),
        f('color', 'vehicles.color', text(v.color)),
        f('category', 'vehicles.category', text(v.category)),
        f('cylinders', 'vehicles.cylinders', num(v.cylinders)),
      ],
    },
    {
      titleKey: 'vehicles.secInfo',
      fields: [
        f('first_registration_date', 'vehicles.firstRegistration', day(v.first_registration_date)),
        // Comme G8 : le dernier kilométrage connu de la moto.
        f('last_visit', 'dossier.sheetLastVisit', km(v.last_service_km ?? v.mileage), true),
        f('tpms_av', 'vehicles.tpmsAv', text(v.tpms_av)),
        f('tpms_ar', 'vehicles.tpmsAr', text(v.tpms_ar)),
        f('warranty_end', 'vehicles.warrantyEnd', day(v.warranty_end)),
        f('model_year', 'vehicles.modelYear', text(v.model_year)),
        f('gps_tracker_id', 'vehicles.gpsTracker', text(v.gps_tracker_id), true),
        f('pin_tracker', 'vehicles.pinTracker', text(v.pin_tracker), true),
        f('exposition_code', 'vehicles.expositionCode', text(v.exposition_code), true),
      ],
    },
  ];
}

export function sheetMissingCount(groups: readonly SheetGroup[]): number {
  return groups.reduce((n, g) => n + g.fields.filter((x) => !x.optional && x.value === null).length, 0);
}
