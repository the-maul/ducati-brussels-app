/**
 * M8 — Rattrapage G8 « OR de base » (18/11/2026) : acces base.
 * - liste des OR paginee, recherche n° / immat / client / chassis, vues, filtres, export ;
 * - releves de kilometrage d'une moto (OR, fiche moto, dernier entretien, declaration client) ;
 * - historique atelier d'une moto (fiche moto) ;
 * - colonnes de la migration 20261118100000 (promis le, 30 points, km confirme) : ecrites seulement
 *   si la base les connait (sonde), sinon l'OR s'enregistre comme avant.
 * Regles pures : `rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  OR_LIST_PAGE_SIZE, combineOrFilters, pageRange, periodBounds, sanitizeSearch, searchFilter, viewFilter,
  OR_OPEN_STATUSES, type MileageReading, type OrListRow, type OrListView,
} from './rules';
import { schemaProbe as batchedSchemaProbe } from '@/lib/schema-probe';

// ---------------------------------------------------------------------------------------------
// Sonde de la migration 20261118100000
// ---------------------------------------------------------------------------------------------
let orBaseProbe: Promise<boolean> | null = null;

/** true quand la migration 20261118100000 est en base (colonne repair_orders.promised_at). */
export function orBaseSchemaReady(): Promise<boolean> {
  orBaseProbe ??= batchedSchemaProbe('repair_orders.promised_at', async () => {
    try {
      const { error } = await supabase.from('repair_orders').select('promised_at' as never).limit(1);
      return !error;
    } catch {
      return false;
    }
  });
  return orBaseProbe;
}

let apptMileageProbe: Promise<boolean> | null = null;
/** true quand workshop_appointments.mileage existe (meme migration). */
export function appointmentMileageReady(): Promise<boolean> {
  apptMileageProbe ??= batchedSchemaProbe('workshop_appointments.mileage', async () => {
    try {
      const { error } = await supabase.from('workshop_appointments').select('mileage' as never).limit(1);
      return !error;
    } catch {
      return false;
    }
  });
  return apptMileageProbe;
}

// ---------------------------------------------------------------------------------------------
// Liste des OR
// ---------------------------------------------------------------------------------------------
export type OrListQuery = {
  companyId: string;
  view: OrListView;
  /** 'all' | 'open' | un statut. */
  status: string;
  search: string;
  from: string;
  to: string;
  operator: string;
  repairType: string;
  page: number;
};

type RawRow = Record<string, unknown> & {
  contacts?: { first_name: string | null; last_name: string | null; company_name: string | null } | null;
  vehicles?: { vin: string | null; plate: string | null; brand: string | null; model: string | null; reference: string | null } | null;
};

function toRow(r: RawRow): OrListRow {
  const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
  const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
  const client = c ? (c.company_name?.trim() || [c.first_name, c.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ')) : '';
  return {
    id: String(r.id), number: (r.number as string | null) ?? null, status: String(r.status ?? ''),
    warranty_status: String(r.warranty_status ?? 'aucune'), repair_type: (r.repair_type as string | null) ?? null,
    created_at: String(r.created_at ?? ''), promised_at: (r.promised_at as string | null | undefined) ?? null,
    operator: (r.operator as string | null) ?? null, total_ttc: Number(r.total_ttc ?? 0),
    mileage: r.mileage == null ? null : Number(r.mileage),
    expert_name: (r.expert_name as string | null) ?? null, expert_date: (r.expert_date as string | null) ?? null,
    client, vehicleRef: v?.reference ?? null,
    vehicleModel: v ? ([v.brand, v.model].filter(Boolean).join(' ') || null) : null,
    plate: v?.plate ?? null, vin: v?.vin ?? null,
  };
}

/** Clients et motos qui correspondent au texte cherche (200 au plus chacun). */
async function searchTargets(companyId: string, term: string): Promise<{ contactIds: string[]; vehicleIds: string[] }> {
  const s = sanitizeSearch(term);
  if (s.length < 2) return { contactIds: [], vehicleIds: [] };
  const like = `*${s}*`;
  const [cq, vq] = await Promise.all([
    supabase.from('contacts').select('id').eq('company_id', companyId)
      .or(`last_name.ilike.${like},first_name.ilike.${like},company_name.ilike.${like},code.ilike.${like}`).limit(200),
    supabase.from('vehicles').select('id').eq('company_id', companyId)
      .or(`plate.ilike.${like},vin.ilike.${like},model.ilike.${like},reference.ilike.${like}`).limit(200),
  ]);
  return {
    contactIds: (cq.data ?? []).map((r) => r.id as string),
    vehicleIds: (vq.data ?? []).map((r) => r.id as string),
  };
}

const SELECT = '*, contacts(first_name, last_name, company_name), vehicles(vin, plate, brand, model, reference)';

async function runListQuery(q: OrListQuery, range: { from: number; to: number }, withApproval: boolean) {
  const targets = q.search.trim() ? await searchTargets(q.companyId, q.search) : { contactIds: [], vehicleIds: [] };
  let query = supabase.from('repair_orders').select(SELECT, { count: 'exact' })
    .eq('company_id', q.companyId).order('created_at', { ascending: false }).range(range.from, range.to);
  const filter = combineOrFilters(viewFilter(q.view, withApproval), q.search.trim() ? searchFilter(q.search, targets.contactIds, targets.vehicleIds) : null);
  if (filter) query = query.or(filter);
  if (q.status === 'open') query = query.in('status', [...OR_OPEN_STATUSES]);
  else if (q.status && q.status !== 'all') query = query.eq('status', q.status);
  const { gte, lt } = periodBounds(q.from, q.to);
  if (gte) query = query.gte('created_at', gte);
  if (lt) query = query.lt('created_at', lt);
  if (q.operator) query = query.eq('operator', q.operator);
  if (q.repairType) query = query.eq('repair_type', q.repairType);
  return query;
}

/** Une page de la liste (50 OR) + le nombre total, pour la pagination au-dela de 100. */
export async function listRepairOrdersPage(q: OrListQuery): Promise<{ rows: OrListRow[]; total: number }> {
  const range = pageRange(q.page, OR_LIST_PAGE_SIZE);
  let res = await runListQuery(q, range, true);
  // Vue « devis » avant la migration du check-up (customer_approval absente) : statut seul.
  if (res.error && q.view === 'devis') res = await runListQuery(q, range, false);
  if (res.error) throw res.error;
  return { rows: ((res.data ?? []) as unknown as RawRow[]).map(toRow), total: res.count ?? 0 };
}

/** Tous les OR du filtre courant (export Excel), par paquets de 1 000, 10 000 au plus. */
export async function listRepairOrdersForExport(q: OrListQuery): Promise<OrListRow[]> {
  const out: OrListRow[] = [];
  const size = 1000;
  for (let i = 0; i < 10; i++) {
    const range = { from: i * size, to: (i + 1) * size - 1 };
    let res = await runListQuery(q, range, true);
    if (res.error && q.view === 'devis') res = await runListQuery(q, range, false);
    if (res.error) throw res.error;
    const rows = ((res.data ?? []) as unknown as RawRow[]).map(toRow);
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/** Operateurs deja saisis sur les OR de la societe (filtre « opérateur » de la liste). */
export async function listOrOperators(companyId: string): Promise<string[]> {
  // Perf 2 (20/11/2026) : les noms distincts sont tires en base (or_operators, memes 1 000 derniers
  // OR) au lieu de rapatrier 1 000 lignes ; repli sur l'ancienne lecture si la migration manque.
  const viaRpc = await (supabase as unknown as {
    rpc: (fn: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  }).rpc('or_operators', { _company: companyId });
  if (!viaRpc.error && Array.isArray(viaRpc.data)) {
    return [...new Set((viaRpc.data as unknown[]).map((s) => String(s ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  }
  const { data, error } = await supabase.from('repair_orders').select('operator')
    .eq('company_id', companyId).not('operator', 'is', null).order('created_at', { ascending: false }).limit(1000);
  if (error) return [];
  const set = new Set<string>();
  for (const r of data ?? []) { const s = String(r.operator ?? '').trim(); if (s) set.add(s); }
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

// ---------------------------------------------------------------------------------------------
// Kilometrage et historique d'une moto
// ---------------------------------------------------------------------------------------------
export type VehicleOrRow = {
  id: string; number: string | null; status: string; created_at: string; mileage: number | null;
  work_description: string | null; repair_type: string | null; reason_code: string | null; service_code: string | null;
  total_ttc: number; invoice_document_id: string | null;
};

/** Les OR d'une moto, du plus recent au plus ancien (fiche moto, controle du km). */
export async function listVehicleRepairOrders(vehicleId: string): Promise<VehicleOrRow[]> {
  const { data, error } = await supabase.from('repair_orders').select('*')
    .eq('vehicle_id', vehicleId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as unknown as Record<string, unknown>;
    return {
      id: String(x.id), number: (x.number as string | null) ?? null, status: String(x.status ?? ''),
      created_at: String(x.created_at ?? ''), mileage: x.mileage == null ? null : Number(x.mileage),
      work_description: (x.work_description as string | null) ?? null, repair_type: (x.repair_type as string | null) ?? null,
      reason_code: (x.reason_code as string | null | undefined) ?? null, service_code: (x.service_code as string | null | undefined) ?? null,
      total_ttc: Number(x.total_ttc ?? 0), invoice_document_id: (x.invoice_document_id as string | null) ?? null,
    };
  });
}

/**
 * Tous les releves connus d'une moto : OR non annules, km de la fiche moto, dernier entretien et
 * km declare par le client (colonnes de la migration du 31/10, lues seulement si elles existent).
 */
export async function vehicleMileageReadings(vehicleId: string): Promise<MileageReading[]> {
  const [ors, veh] = await Promise.all([
    listVehicleRepairOrders(vehicleId).catch(() => [] as VehicleOrRow[]),
    supabase.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
  ]);
  const out: MileageReading[] = [];
  for (const o of ors) {
    if (o.status === 'annule' || o.mileage == null) continue;
    out.push({ km: o.mileage, at: o.created_at, source: 'or', ref: o.number, orId: o.id });
  }
  const v = (veh.data ?? null) as Record<string, unknown> | null;
  if (v) {
    const num = (x: unknown) => (x == null || x === '' ? null : Number(x));
    const km = num(v.mileage);
    if (km != null) out.push({ km, at: (v.updated_at as string | null) ?? null, source: 'vehicle' });
    const svc = num(v.last_service_km);
    if (svc != null) out.push({ km: svc, at: (v.last_service_at as string | null) ?? null, source: 'service' });
    const decl = num(v.declared_km);
    if (decl != null) out.push({ km: decl, at: (v.declared_km_at as string | null) ?? null, source: 'declared' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Commentaire de la fiche client (popup G8 a l'ouverture de l'OR)
// ---------------------------------------------------------------------------------------------
export async function getContactComment(contactId: string): Promise<{ name: string; notes: string } | null> {
  const { data, error } = await supabase.from('contacts').select('id, notes, first_name, last_name, company_name').eq('id', contactId).maybeSingle();
  if (error || !data) return null;
  const name = data.company_name?.trim() || [data.first_name, data.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  return { name, notes: data.notes ?? '' };
}

export async function saveContactComment(contactId: string, notes: string): Promise<void> {
  const { error } = await supabase.from('contacts').update({ notes: notes.trim() || null }).eq('id', contactId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------------------------
// Statut seul (bouton « Client informé » apres le message « moto prête »)
// ---------------------------------------------------------------------------------------------
export async function setOrStatus(orId: string, status: string): Promise<void> {
  const { error } = await supabase.from('repair_orders').update({ status }).eq('id', orId);
  if (error) throw error;
}
