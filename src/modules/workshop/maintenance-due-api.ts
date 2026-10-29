/**
 * M8 / M3 — Prochain entretien de chaque moto (mission 07, cartes 4 et 5) — accès base.
 *
 * Migration 20261031100000_m8_prochain_entretien.sql (NON appliquée le 31/10) : tant qu'elle ne l'est
 * pas, les appels ci-dessous échouent proprement (table ou fonction absente) et les écrans le disent.
 * Les fonctions SQL sont appelées sans typage généré (types.ts à régénérer après application).
 */
import { supabase } from '@/integrations/supabase/client';
import { dedupeDcsRows, parseDcsRows, type DcsRow, type DueKind, type DueSource } from './maintenance-due';

export type MaintenanceDue = {
  id: string;
  vehicle_id: string;
  kind: DueKind;
  due_date: string | null;
  due_km: number | null;
  source: DueSource;
  source_ref: string | null;
  last_service_at: string | null;
  last_service_km: number | null;
  computed_at: string;
};

type LooseResult = { data: unknown; error: { message: string; code?: string } | null };
type LooseQuery = {
  select: (cols: string) => LooseQuery;
  eq: (col: string, value: unknown) => LooseQuery;
  order: (col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => LooseQuery;
  limit: (n: number) => LooseQuery;
  maybeSingle: () => Promise<LooseResult>;
};
// Table et fonctions créées par une migration non appliquée : accès sans le typage généré.
const loose = supabase as unknown as {
  from: (table: string) => LooseQuery;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<LooseResult>;
};
const rpc = loose.rpc;

/** La migration n'est pas appliquée : table ou fonction inconnue. */
export function isMissingSchema(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const m = err?.message ?? '';
  return err?.code === '42P01' || err?.code === '42883' || err?.code === 'PGRST202' || err?.code === 'PGRST205'
    || /does not exist|Could not find the (function|table)/i.test(m);
}

/** Échéance courante d'une moto (null si aucune). */
export async function getVehicleDue(vehicleId: string): Promise<MaintenanceDue | null> {
  const { data, error } = await loose.from('vehicle_maintenance_due')
    .select('id, vehicle_id, kind, due_date, due_km, source, source_ref, last_service_at, last_service_km, computed_at')
    .eq('vehicle_id', vehicleId).eq('is_current', true)
    .order('due_date', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data as MaintenanceDue | null) ?? null;
}

export type RecomputeResult = { vehicle_id: string; kind: DueKind | null; due_date: string | null; due_km: number | null; source: DueSource | null; changed: boolean };

export async function recomputeVehicleDue(companyId: string, vehicleId: string): Promise<RecomputeResult> {
  const { data, error } = await rpc('vehicle_maintenance_recompute', { _company: companyId, _vehicle: vehicleId });
  if (error) throw error;
  return data as RecomputeResult;
}

export type BatchResult = { done: number; last_id: string | null; with_due: number; by_source: Record<string, number> };

/** Recalcule toutes les motos de la société par lots ; `onProgress` reçoit le cumul. */
export async function recomputeAllDue(companyId: string, onProgress?: (done: number) => void, batch = 200): Promise<BatchResult> {
  let after: string | null = null;
  const total: BatchResult = { done: 0, last_id: null, with_due: 0, by_source: {} };
  for (let i = 0; i < 1000; i++) {
    const { data, error } = await rpc('vehicle_maintenance_recompute_batch', { _company: companyId, _after: after, _limit: batch });
    if (error) throw error;
    const r = data as BatchResult;
    total.done += r.done; total.with_due += r.with_due; total.last_id = r.last_id;
    for (const [k, v] of Object.entries(r.by_source ?? {})) total.by_source[k] = (total.by_source[k] ?? 0) + v;
    onProgress?.(total.done);
    if (!r.done || !r.last_id) break;
    after = r.last_id;
  }
  return total;
}

/** Ce que le client (ou l'équipe pour lui) déclare : km actuel et dernier entretien ; puis recalcul. */
export type ServiceDeclaration = {
  declared_km?: number | null;
  last_service_at?: string | null;
  last_service_km?: number | null;
  last_service_where?: 'ici' | 'ailleurs' | null;
};

export async function saveServiceDeclaration(companyId: string, vehicleId: string, d: ServiceDeclaration): Promise<RecomputeResult> {
  const patch: Record<string, unknown> = {};
  if ('declared_km' in d) { patch.declared_km = d.declared_km ?? null; patch.declared_km_at = d.declared_km != null ? new Date().toISOString() : null; }
  if ('last_service_at' in d) patch.last_service_at = d.last_service_at ?? null;
  if ('last_service_km' in d) patch.last_service_km = d.last_service_km ?? null;
  if ('last_service_where' in d) patch.last_service_where = d.last_service_where ?? null;
  const { error } = await supabase.from('vehicles').update(patch as never).eq('id', vehicleId);
  if (error) throw error;
  return recomputeVehicleDue(companyId, vehicleId);
}

// ---------------------------------------------------------------- extract DCS
export type DcsImportReport = {
  rows: number; known: number; unknown: number; unknown_vins: string[]; inserted: number; duplicates: number;
  invalid: number; vehicles: number; owners_with_email: number; recomputed: number; applied: boolean;
};

/** Lit l'extract DCS (.xlsx) dans le navigateur : SheetJS en import dynamique, comme l'import de tarif. */
export async function parseDcsArrayBuffer(buf: ArrayBuffer): Promise<ReturnType<typeof parseDcsRows>> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const name = wb.SheetNames.find((n) => n.toLowerCase() === 'export') ?? wb.SheetNames[0];
  const ws = wb.Sheets[name];
  // raw: true → les dates restent des séries Excel, que parseDcsRows convertit.
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
  return parseDcsRows(aoa);
}

export async function readDcsFile(file: File): Promise<{ rows: DcsRow[]; duplicates: DcsRow[]; ignored: number }> {
  const parsed = await parseDcsArrayBuffer(await file.arrayBuffer());
  const { kept, duplicates } = dedupeDcsRows(parsed.rows);
  return { rows: kept, duplicates, ignored: parsed.ignored.length };
}

export async function importDcsRows(companyId: string, fileName: string, rows: DcsRow[], apply: boolean): Promise<DcsImportReport> {
  const payload = rows.map((r) => ({
    row: r.row, vin: r.vin, warranty_start: r.warrantyStart, planned_date: r.plannedDate,
    maintenance_type: r.maintenanceType, days_before: r.daysBefore, dealer: r.dealer,
  }));
  const { data, error } = await rpc('dcs_maintenance_import', { _company: companyId, _file: fileName, _rows: payload, _apply: apply });
  if (error) throw error;
  return data as DcsImportReport;
}

export type DcsImportFile = { file_name: string; imported_at: string; rows_count: number; known_count: number; next_min: string | null; next_max: string | null };

export async function listDcsImportFiles(companyId: string): Promise<DcsImportFile[]> {
  const { data, error } = await rpc('dcs_maintenance_import_files', { _company: companyId });
  if (error) throw error;
  return (data ?? []) as DcsImportFile[];
}
