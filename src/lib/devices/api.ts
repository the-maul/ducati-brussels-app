/**
 * Postes et peripheriques (PDV030) — lecture / ecriture en base (migration
 * 20261103250000_m6_postes_peripheriques.sql). Tant que la migration n'est pas appliquee, les
 * tables sont absentes : tout se lit comme « aucun poste », la caisse imprime comme avant (A4 du
 * navigateur) et l'ecran Parametres le dit. Ecriture reservee aux administrateurs (RLS).
 */
import { supabase } from '@/integrations/supabase/client';
import {
  DEFAULT_COMPANY_DEVICE_SETTINGS, WORKSTATION_KINDS, isConnection, isRole, parseDeviceConfig,
  type CompanyDeviceSettings, type Connection, type DeviceConfig, type DeviceRole, type Workstation,
  type WorkstationDevice, type WorkstationKind,
} from './types';

type LooseResult<T> = Promise<{ data: T | null; error: { code?: string; message?: string } | null }>;
type LooseQuery = {
  select(cols?: string): LooseQuery;
  insert(v: unknown): LooseQuery;
  update(v: unknown): LooseQuery;
  upsert(v: unknown, o?: { onConflict?: string }): LooseQuery;
  delete(): LooseQuery;
  eq(col: string, v: unknown): LooseQuery;
  order(col: string, o?: { ascending?: boolean }): LooseQuery;
  maybeSingle(): LooseResult<Record<string, unknown>>;
  single(): LooseResult<Record<string, unknown>>;
  then: LooseResult<Record<string, unknown>[]>['then'];
};
const loose = supabase as unknown as {
  from: (table: string) => LooseQuery;
  rpc: (fn: string, args?: Record<string, unknown>) => LooseResult<unknown>;
};

/** Table ou colonne absente (migration non appliquee) : PGRST205 / 42P01 / 42703 / PGRST204. */
export function isMissingSchema(e: { code?: string } | null | undefined): boolean {
  const c = e?.code;
  return c === 'PGRST205' || c === '42P01' || c === '42703' || c === 'PGRST204' || c === 'PGRST202' || c === '42883';
}

export type DeviceSetup = {
  /** false = migration non appliquee (tables absentes). */
  available: boolean;
  workstations: Workstation[];
  devices: WorkstationDevice[];
  settings: CompanyDeviceSettings;
};

const toWorkstation = (r: Record<string, unknown>): Workstation => ({
  id: String(r.id), company_id: String(r.company_id), name: String(r.name ?? ''),
  kind: (WORKSTATION_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as WorkstationKind) : 'autre',
  register_code: (r.register_code as string | null) ?? null, is_active: r.is_active !== false,
  sort_order: Number(r.sort_order ?? 0), notes: (r.notes as string | null) ?? null,
});

const toDevice = (r: Record<string, unknown>): WorkstationDevice | null => {
  if (!isRole(r.role) || !isConnection(r.connection)) return null;
  return {
    id: String(r.id), company_id: String(r.company_id), workstation_id: String(r.workstation_id),
    role: r.role, connection: r.connection, label: (r.label as string | null) ?? null,
    config: parseDeviceConfig(r.config), is_active: r.is_active !== false,
    last_test_at: (r.last_test_at as string | null) ?? null,
    last_test_ok: (r.last_test_ok as boolean | null) ?? null,
    last_test_message: (r.last_test_message as string | null) ?? null,
  };
};

const toSettings = (r: Record<string, unknown> | null): CompanyDeviceSettings => (r ? {
  receipt_width_mm: Number(r.receipt_width_mm) === 58 ? 58 : 80,
  auto_print_receipt: r.auto_print_receipt === true,
  open_drawer_on_cash: r.open_drawer_on_cash !== false,
  receipt_footer: (r.receipt_footer as string | null) ?? null,
} : { ...DEFAULT_COMPANY_DEVICE_SETTINGS });

export async function loadDeviceSetup(companyId: string): Promise<DeviceSetup> {
  const [ws, dv, st] = await Promise.all([
    loose.from('workstations').select('*').eq('company_id', companyId).order('sort_order').order('name'),
    loose.from('workstation_devices').select('*').eq('company_id', companyId),
    loose.from('company_device_settings').select('*').eq('company_id', companyId).maybeSingle(),
  ]);
  const missing = [ws.error, dv.error, st.error].some(isMissingSchema);
  if (missing) return { available: false, workstations: [], devices: [], settings: { ...DEFAULT_COMPANY_DEVICE_SETTINGS } };
  const err = ws.error ?? dv.error ?? st.error;
  if (err) throw err;
  return {
    available: true,
    workstations: ((ws.data ?? []) as Record<string, unknown>[]).map(toWorkstation),
    devices: ((dv.data ?? []) as Record<string, unknown>[]).map(toDevice).filter((d): d is WorkstationDevice => !!d),
    settings: toSettings(st.data as Record<string, unknown> | null),
  };
}

export type WorkstationInput = {
  id?: string; companyId: string; name: string; kind: WorkstationKind; registerCode: string | null;
  isActive: boolean; sortOrder?: number; notes?: string | null;
};

export async function saveWorkstation(i: WorkstationInput): Promise<string> {
  const row = {
    company_id: i.companyId, name: i.name.trim(), kind: i.kind,
    register_code: i.registerCode?.trim() ? i.registerCode.trim().toUpperCase() : null,
    is_active: i.isActive, sort_order: i.sortOrder ?? 0, notes: i.notes ?? null,
  };
  const q = i.id
    ? loose.from('workstations').update(row).eq('id', i.id).select('id').single()
    : loose.from('workstations').insert(row).select('id').single();
  const { data, error } = await q;
  if (error) throw error;
  return String(data?.id ?? i.id);
}

export async function deleteWorkstation(id: string): Promise<void> {
  const { error } = await loose.from('workstations').delete().eq('id', id);
  if (error) throw error;
}

export type DeviceInput = {
  companyId: string; workstationId: string; role: DeviceRole; connection: Connection;
  label: string | null; config: DeviceConfig; isActive: boolean;
};

/** Un appareil par role et par poste : enregistre (ou remplace) la ligne du role. */
export async function saveDevice(i: DeviceInput): Promise<void> {
  const { error } = await loose.from('workstation_devices').upsert({
    company_id: i.companyId, workstation_id: i.workstationId, role: i.role, connection: i.connection,
    label: i.label?.trim() || null, config: parseDeviceConfig(i.config), is_active: i.isActive,
  }, { onConflict: 'workstation_id,role' });
  if (error) throw error;
}

export async function recordDeviceTest(deviceId: string, okFlag: boolean, message: string | null): Promise<void> {
  const { error } = await loose.from('workstation_devices')
    .update({ last_test_at: new Date().toISOString(), last_test_ok: okFlag, last_test_message: message })
    .eq('id', deviceId);
  if (error && !isMissingSchema(error)) throw error;
}

export async function saveCompanyDeviceSettings(companyId: string, s: CompanyDeviceSettings): Promise<void> {
  const { error } = await loose.from('company_device_settings').upsert({
    company_id: companyId, receipt_width_mm: s.receipt_width_mm, auto_print_receipt: s.auto_print_receipt,
    open_drawer_on_cash: s.open_drawer_on_cash, receipt_footer: s.receipt_footer?.trim() || null,
  }, { onConflict: 'company_id' });
  if (error) throw error;
}

export type DeviceEventAction = 'drawer_opened' | 'receipt_printed' | 'receipt_reprinted' | 'device_tested';

/**
 * Trace dans `events` (ouverture du tiroir, ticket imprime / duplicata, test). Jamais bloquant :
 * une trace manquee (migration absente, hors ligne) n'empeche ni l'impression ni le tiroir.
 */
export async function logDeviceEvent(
  companyId: string, action: DeviceEventAction, workstationId: string | null, detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await loose.rpc('device_event', { _company: companyId, _action: action, _workstation: workstationId, _detail: detail });
  } catch { /* trace facultative */ }
}
