/**
 * M7 — Cessions internes / O.R.O (rattrapage G8, 18/11/2026) : ACCES BASE.
 * Tables `internal_cessions`, `internal_cession_lines`, `vehicle_cost_changes` et RPC de la
 * migration 20261118240000 (non appliquee a l'ecriture : `types.ts` ne les connait pas, d'ou
 * les appels non types — meme parade que `workshop/accident/api.ts`). Regles : `rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { listRef, upsertRef, type RefRow } from '@/modules/settings/reference-api';
import type { CessionLineKind, CessionStatus, CostBasis } from './rules';
import { schemaProbe as batchedSchemaProbe } from '@/lib/schema-probe';

type LooseResult = { data: unknown; error: { code?: string; message: string } | null };
type LooseBuilder = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseBuilder;
  update: (values: Record<string, unknown>) => LooseBuilder;
  delete: () => LooseBuilder;
  eq: (col: string, value: unknown) => LooseBuilder;
  in: (col: string, values: unknown[]) => LooseBuilder;
  is: (col: string, value: unknown) => LooseBuilder;
  gte: (col: string, value: unknown) => LooseBuilder;
  lte: (col: string, value: unknown) => LooseBuilder;
  or: (filter: string) => LooseBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => LooseBuilder;
  limit: (n: number) => LooseBuilder;
  maybeSingle: () => Promise<LooseResult>;
  single: () => Promise<LooseResult>;
};
type LooseClient = {
  from: (table: string) => LooseBuilder;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<LooseResult>;
};
const loose = supabase as unknown as LooseClient;

const unwrap = <T,>(r: LooseResult): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export type CessionRow = {
  id: string;
  company_id: string;
  number: string | null;
  cession_type: string;
  type_label: string | null;
  accounted: boolean;
  account: string | null;
  journal: string | null;
  vehicle_id: string | null;
  oro_id: string | null;
  contact_id: string | null;
  operator_id: string | null;
  operator_name: string | null;
  work_description: string | null;
  internal_note: string | null;
  cost_basis: CostBasis;
  status: CessionStatus;
  origin: string;
  total_cost: number;
  total_pamp: number;
  total_pa: number;
  total_sale_ht: number;
  options_amount: number;
  cost_before: number | null;
  cost_after: number | null;
  validated_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
};

export type CessionVehicle = {
  id: string; vin: string | null; plate: string | null; brand: string | null; model: string | null;
  reference: string | null; mileage: number | null; purchase_price: number | null; cost_price: number | null;
  display_price: number | null; status: string | null;
};
export type CessionContact = {
  id: string; code: string | null; first_name: string | null; last_name: string | null; company_name: string | null;
  address: string | null; zip: string | null; city: string | null; phone: string | null; email: string | null;
};
export type CessionListRow = CessionRow & { vehicle: CessionVehicle | null; contact: CessionContact | null };

export type CessionLine = {
  id: string;
  cession_id: string;
  sort_order: number;
  kind: CessionLineKind;
  article_id: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
  hours_spent: number | null;
  mechanic_id: string | null;
  mechanic_name: string | null;
  work_date: string | null;
  unit_pamp: number | null;
  unit_pa: number | null;
  unit_sale_ht: number | null;
  unit_cost: number;
  cost_locked: boolean;
  line_cost: number;
  line_sale_ht: number;
  stock_move_id: number | null;
};

export type CessionFull = CessionListRow & { lines: CessionLine[] };

const SELECT_HEAD =
  '*, vehicle:vehicle_id(id, vin, plate, brand, model, reference, mileage, purchase_price, cost_price, display_price, status), ' +
  'contact:contact_id(id, code, first_name, last_name, company_name, address, zip, city, phone, email)';

let schemaProbe: Promise<boolean> | null = null;
/** true quand la migration 20261118240000 est en base (table `internal_cessions`). */
export function cessionsSchemaReady(): Promise<boolean> {
  schemaProbe ??= batchedSchemaProbe('internal_cessions.id', async () => {
    try {
      const r = await loose.from('internal_cessions').select('id').limit(1);
      return !r.error;
    } catch {
      return false;
    }
  });
  return schemaProbe;
}

export type CessionFilters = {
  statuses?: CessionStatus[];
  type?: string | null;
  from?: string | null;   // date AAAA-MM-JJ
  to?: string | null;
  vehicleId?: string | null;
};

/** Documents de cession (rappel / liste / archives) ; la recherche texte se fait a l'ecran. */
export async function listCessionDocs(companyId: string, f: CessionFilters = {}): Promise<CessionListRow[]> {
  let q = loose.from('internal_cessions').select(SELECT_HEAD).eq('company_id', companyId);
  if (f.statuses && f.statuses.length) q = q.in('status', f.statuses);
  if (f.type) q = q.eq('cession_type', f.type);
  if (f.vehicleId) q = q.eq('vehicle_id', f.vehicleId);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00`);
  if (f.to) q = q.lte('created_at', `${f.to}T23:59:59`);
  const rows = unwrap<CessionListRow[]>(await q.order('created_at', { ascending: false }).limit(1000));
  return rows ?? [];
}

export async function getCession(id: string): Promise<CessionFull | null> {
  const head = unwrap<CessionListRow | null>(await loose.from('internal_cessions').select(SELECT_HEAD).eq('id', id).maybeSingle());
  if (!head) return null;
  const lines = unwrap<CessionLine[]>(
    await loose.from('internal_cession_lines').select('*').eq('cession_id', id).order('sort_order', { ascending: true }),
  );
  return { ...head, lines: lines ?? [] };
}

export async function openCession(p: {
  companyId: string; type: string; vehicleId?: string | null; operatorId?: string | null;
  operatorName?: string | null; work?: string | null; costBasis?: CostBasis | null;
}): Promise<string> {
  return unwrap<string>(await loose.rpc('open_internal_cession', {
    _company: p.companyId, _type: p.type, _vehicle: p.vehicleId ?? null, _operator_id: p.operatorId ?? null,
    _operator_name: p.operatorName ?? null, _work: p.work ?? null, _cost_basis: p.costBasis ?? null,
  }));
}

export async function updateCessionHeader(id: string, patch: {
  cession_type?: string; operator_id?: string | null; operator_name?: string | null;
  work_description?: string | null; internal_note?: string | null;
}): Promise<void> {
  unwrap(await loose.from('internal_cessions').update(patch).eq('id', id));
}

export type AddLineInput = {
  kind: CessionLineKind;
  articleId?: string | null;
  designation?: string | null;
  quantity?: number;
  hoursSpent?: number | null;
  mechanicId?: string | null;
  mechanicName?: string | null;
  unitCost?: number | null;
  workDate?: string | null;
};

export async function addCessionLine(cessionId: string, l: AddLineInput): Promise<string> {
  return unwrap<string>(await loose.rpc('add_internal_cession_line', {
    _cession: cessionId, _kind: l.kind, _article: l.articleId ?? null, _designation: l.designation ?? null,
    _quantity: l.quantity ?? 1, _hours_spent: l.hoursSpent ?? null, _mechanic_id: l.mechanicId ?? null,
    _mechanic_name: l.mechanicName ?? null, _unit_cost: l.unitCost ?? null, _work_date: l.workDate ?? null,
  }));
}

export async function deleteCessionLine(lineId: string): Promise<void> {
  unwrap(await loose.from('internal_cession_lines').delete().eq('id', lineId));
}

export async function setCessionCostBasis(cessionId: string, basis: CostBasis): Promise<void> {
  unwrap(await loose.rpc('set_internal_cession_cost_basis', { _cession: cessionId, _basis: basis }));
}

export type CostContext = {
  purchase_price: number; cost_price: number | null; legacy_oro: number; other_cessions: number;
  sale_price_ttc: number | null; vat_rate: number | null; current_cost: number; current_sale_ht: number; accounted: boolean;
};

export async function getCostContext(cessionId: string): Promise<CostContext> {
  const r = unwrap<Record<string, unknown>>(await loose.rpc('internal_cession_cost_context', { _cession: cessionId }));
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    purchase_price: Number(r.purchase_price ?? 0), cost_price: n(r.cost_price), legacy_oro: Number(r.legacy_oro ?? 0),
    other_cessions: Number(r.other_cessions ?? 0), sale_price_ttc: n(r.sale_price_ttc), vat_rate: n(r.vat_rate),
    current_cost: Number(r.current_cost ?? 0), current_sale_ht: Number(r.current_sale_ht ?? 0), accounted: Boolean(r.accounted),
  };
}

export type ValidationResult = { number: string; total_cost: number; cost_before: number | null; cost_after: number | null };

export async function validateCession(cessionId: string, options: number): Promise<ValidationResult> {
  return unwrap<ValidationResult>(await loose.rpc('validate_internal_cession', { _cession: cessionId, _options: options }));
}

export async function archiveCession(id: string): Promise<void> {
  unwrap(await loose.rpc('archive_internal_cession', { _cession: id }));
}
export async function unarchiveCession(id: string): Promise<void> {
  unwrap(await loose.rpc('unarchive_internal_cession', { _cession: id }));
}
export async function cancelCession(id: string): Promise<void> {
  unwrap(await loose.rpc('cancel_internal_cession', { _cession: id }));
}

export type CessionReportRow = {
  cession_id: string; number: string | null; cession_type: string; type_label: string | null; accounted: boolean;
  status: CessionStatus; cession_date: string; vehicle_id: string | null; vin: string | null; plate: string | null;
  vehicle_label: string | null; contact_name: string | null; line_id: string; kind: CessionLineKind;
  article_id: string | null; reference: string | null; designation: string; category_path: string | null;
  quantity: number; hours_spent: number | null; mechanic_name: string | null;
  amount_pamp: number; amount_pa: number; amount_sale_ht: number; amount_cost: number;
};

/** Lignes de cessions validees sur une periode (listes par rayon et detaillees). */
export async function cessionReport(companyId: string, from: string | null, to: string | null, type: string | null): Promise<CessionReportRow[]> {
  const rows = unwrap<CessionReportRow[]>(await loose.rpc('internal_cession_report', {
    _company: companyId, _from: from || null, _to: to || null, _type: type || null, _include_open: false,
  }));
  return (rows ?? []).map((r) => ({
    ...r, quantity: Number(r.quantity), amount_pamp: Number(r.amount_pamp), amount_pa: Number(r.amount_pa),
    amount_sale_ht: Number(r.amount_sale_ht), amount_cost: Number(r.amount_cost),
  }));
}

export type CostChange = { id: number; occurred_at: string; source: string; source_ref: string | null; old_cost: number | null; delta: number | null; new_cost: number };

/** Historique append-only du cout de revient d'une moto. */
export async function listVehicleCostChanges(vehicleId: string): Promise<CostChange[]> {
  const rows = unwrap<CostChange[]>(
    await loose.from('vehicle_cost_changes').select('id, occurred_at, source, source_ref, old_cost, delta, new_cost')
      .eq('vehicle_id', vehicleId).order('occurred_at', { ascending: false }).limit(50),
  );
  return rows ?? [];
}

// ------------------------------------------------------------------ pointeuse
export type WorkedMinutes = { mechanic_id: string | null; mechanic_name: string | null; minutes: number };

export async function cessionWorkedMinutes(cessionId: string): Promise<WorkedMinutes[]> {
  const rows = unwrap<WorkedMinutes[]>(await loose.rpc('cession_worked_minutes', { _cession: cessionId }));
  return (rows ?? []).map((r) => ({ ...r, minutes: Number(r.minutes) }));
}

async function uid(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

type OpenEntry = { id: string; started_at: string; cession_id: string | null };

async function openWorkEntry(companyId: string): Promise<OpenEntry | null> {
  const u = await uid();
  // Un seul pointage actif par mecanicien (lot A parcours mecanicien, 19/11) : travail OU tache
  // improductive, toutes societes du compte (sinon le nouveau pointage serait refuse en base).
  let q = loose.from('workshop_time_entries').select('id, started_at, cession_id')
    .in('kind', ['travail', 'improductif']).is('ended_at', null);
  q = u ? q.eq('mechanic_id', u).is('mechanic_code', null) : q.eq('company_id', companyId);
  const rows = unwrap<OpenEntry[]>(await q.order('started_at', { ascending: false }).limit(1));
  return rows?.[0] ?? null;
}

async function closeEntry(e: OpenEntry): Promise<void> {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(e.started_at).getTime()) / 600) / 100);
  unwrap(await loose.from('workshop_time_entries').update({ ended_at: new Date().toISOString(), minutes }).eq('id', e.id));
}

/** Pointage en cours de l'utilisateur (null si aucun). */
export async function myOpenWork(companyId: string): Promise<OpenEntry | null> {
  return openWorkEntry(companyId);
}

/** Pointe le travail sur la cession (cloture le pointage de travail precedent, comme la pointeuse). */
export async function startCessionWork(companyId: string, cessionId: string, mechanicName: string | null): Promise<void> {
  const open = await openWorkEntry(companyId);
  if (open) await closeEntry(open);
  const ins = supabase.from('workshop_time_entries').insert({
    company_id: companyId, mechanic_id: await uid(), mechanic_name: mechanicName || null, kind: 'travail',
    cession_id: cessionId,
  } as never);
  const { error } = await ins;
  if (error) throw new Error(error.message);
}

export async function stopCessionWork(companyId: string): Promise<void> {
  const open = await openWorkEntry(companyId);
  if (open) await closeEntry(open);
}

// ------------------------------------------------------------------ reglages
export const CESSION_SETTINGS_KEY = 'cession_settings';
export type CessionSettingCode = 'cost_basis' | 'auto_archive_on_sale' | 'auto_open_on_reprise' | 'reprise_cession_type' | 'internal_hourly_rate';
export const CESSION_SETTING_CODES: CessionSettingCode[] = ['cost_basis', 'auto_archive_on_sale', 'auto_open_on_reprise', 'reprise_cession_type', 'internal_hourly_rate'];
const SETTING_DEFAULTS: Record<CessionSettingCode, string> = {
  cost_basis: 'pamp', auto_archive_on_sale: 'oui', auto_open_on_reprise: 'oui', reprise_cession_type: '01', internal_hourly_rate: '0',
};

export async function readCessionSettings(companyId: string): Promise<{ values: Record<CessionSettingCode, string>; rows: RefRow[] }> {
  const rows = await listRef(companyId, CESSION_SETTINGS_KEY);
  const values = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if ((CESSION_SETTING_CODES as string[]).includes(r.code) && r.is_active && r.label.trim()) {
      values[r.code as CessionSettingCode] = r.label.trim();
    }
  }
  return { values, rows };
}

export async function saveCessionSetting(companyId: string, rows: RefRow[], code: CessionSettingCode, value: string): Promise<void> {
  const existing = rows.find((r) => r.code === code);
  await upsertRef({
    id: existing?.id, company_id: companyId, table_key: CESSION_SETTINGS_KEY, code, label: value,
    sort_order: existing?.sort_order ?? CESSION_SETTING_CODES.indexOf(code) + 1, is_active: true,
    extra: (existing?.extra as Record<string, string | number | boolean | null> | undefined) ?? {},
  });
}

// ------------------------------------------------------------------ recherche d'article
export type CessionArticle = { id: string; reference: string; designation: string; mgmt_type: string; pamp: number; purchase_price: number };

/** Pieces (A, M, N, F) ou main-d'oeuvre (T) ; jamais une moto (V, O, P, D, R). */
export async function searchCessionArticles(companyId: string, term: string, kind: 'piece' | 'mo'): Promise<CessionArticle[]> {
  const s = term.replace(/[,()%*]/g, ' ').trim();
  if (s.length < 2) return [];
  const types = kind === 'mo' ? ['T'] : ['A', 'M', 'N', 'F'];
  const r = await loose.from('articles').select('id, reference, designation, mgmt_type, pamp, purchase_price')
    .eq('company_id', companyId).in('mgmt_type', types)
    .or(`reference.ilike.%${s}%,designation.ilike.%${s}%,supplier_ref.ilike.%${s}%`).limit(10);
  const rows = unwrap<CessionArticle[]>(r) ?? [];
  return rows.map((a) => ({ ...a, pamp: Number(a.pamp ?? 0), purchase_price: Number(a.purchase_price ?? 0) }));
}
