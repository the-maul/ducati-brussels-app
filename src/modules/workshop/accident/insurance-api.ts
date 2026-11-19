/**
 * M8 — OR accident cote assureur : acces base (rattrapage G8 du 18/11/2026).
 *
 * Table `insurance_parties` (cabinets d'assurance et experts) et colonnes « assureur » du dossier
 * accident (`accident_files`), migration 20261118130000 (non appliquee : appels non types).
 * Le dossier accident reste UNIQUE par OR (`openAccidentFile` / `ensureAccidentFileForOr`) :
 * ce volet le complete, il ne cree pas un second dossier.
 */
import { supabase } from '@/integrations/supabase/client';
import type { InsurancePartyKind, DeductibleKind } from './insurance-rules';

type LooseResult = { data: unknown; error: { code?: string; message: string } | null };
type LooseBuilder = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseBuilder;
  insert: (values: Record<string, unknown>) => LooseBuilder;
  update: (values: Record<string, unknown>) => LooseBuilder;
  eq: (col: string, value: unknown) => LooseBuilder;
  not: (col: string, op: string, value: unknown) => LooseBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => LooseBuilder;
  limit: (n: number) => LooseBuilder;
  single: () => Promise<LooseResult>;
};
const loose = supabase as unknown as { from: (table: string) => LooseBuilder };

const unwrap = <T,>(r: LooseResult): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};
const missing = (e: { code?: string; message: string } | null) =>
  !!e && (e.code === '42P01' || e.code === '42703' || e.code === 'PGRST200' || e.code === 'PGRST204' || e.code === 'PGRST205' || /does not exist|Could not find|schema cache/i.test(e.message));

export type InsuranceParty = {
  id: string; company_id: string; kind: InsurancePartyKind; code: string | null; name: string;
  address: string | null; postal_code: string | null; city: string | null; country: string | null;
  phone: string | null; phone2: string | null; fax: string | null; email: string | null;
  company_number: string | null; vat_number: string | null; contact_name: string | null; comments: string | null;
  accounting_account: string | null; price_list: string | null; is_active: boolean;
  /** T4 : tarif commun du cabinet (migration 20261119200000) ; absent avant elle. */
  price_list_id?: string | null;
  created_at: string; updated_at: string;
};
export type InsurancePartyInput = Omit<InsuranceParty, 'id' | 'company_id' | 'created_at' | 'updated_at'>;

let probe: Promise<boolean> | null = null;
/** true quand la migration 20261118130000 est appliquee (table insurance_parties). */
export function insuranceSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    const r = await loose.from('insurance_parties').select('id').limit(1);
    if (!r.error) return true;
    if (missing(r.error)) return false;
    throw new Error(r.error.message);
  })().catch(() => false);
  return probe;
}

let tariffProbe: Promise<boolean> | null = null;
/** true quand la migration 20261119200000 est appliquee (colonne insurance_parties.price_list_id). */
export function insurerTariffSchemaReady(): Promise<boolean> {
  tariffProbe ??= (async () => {
    const r = await loose.from('insurance_parties').select('price_list_id').limit(1);
    return !r.error;
  })().catch(() => false);
  return tariffProbe;
}

export async function listInsuranceParties(companyId: string, kind?: InsurancePartyKind): Promise<InsuranceParty[]> {
  let q = loose.from('insurance_parties').select('*').eq('company_id', companyId);
  if (kind) q = q.eq('kind', kind);
  const r = await q.order('name', { ascending: true }).limit(1000);
  return unwrap<InsuranceParty[]>(r) ?? [];
}

const clean = (p: Partial<InsurancePartyInput>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) out[k] = typeof v === 'string' ? (v.trim() || null) : v;
  if (typeof p.name === 'string') out.name = p.name.trim();
  return out;
};

export async function createInsuranceParty(companyId: string, p: InsurancePartyInput): Promise<string> {
  const r = await loose.from('insurance_parties').insert({ company_id: companyId, ...clean(p) }).select('id').single();
  return unwrap<{ id: string }>(r).id;
}

export async function updateInsuranceParty(id: string, p: Partial<InsurancePartyInput>): Promise<void> {
  unwrap(await loose.from('insurance_parties').update(clean(p)).eq('id', id));
}

// ---------------------------------------------------------------------------------------------
// Volet assureur du dossier accident
// ---------------------------------------------------------------------------------------------

export type AccidentInsurance = {
  insurer_id: string | null; expert_id: string | null; expert_visit_date: string | null;
  deductible_kind: DeductibleKind; deductible_value: number | null; market_value: number | null; argus_value: number | null;
  work_start_accepted: boolean; work_start_accepted_at: string | null; work_start_accepted_by: string | null;
};
export const ACCIDENT_INSURANCE_COLS = 'insurer_id, expert_id, expert_visit_date, deductible_kind, deductible_value, market_value, argus_value, work_start_accepted, work_start_accepted_at, work_start_accepted_by';

export async function getAccidentInsurance(fileId: string): Promise<AccidentInsurance | null> {
  const r = await loose.from('accident_files').select(ACCIDENT_INSURANCE_COLS).eq('id', fileId).limit(1);
  if (r.error && missing(r.error)) return null;
  const rows = unwrap<AccidentInsurance[]>(r) ?? [];
  return rows[0] ?? null;
}

type RpcResult = { error: { code?: string; message: string } | null };
const rpcLoose = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

/** Origine d'une saisie de l'expert (trace events, Q51). */
export type ExpertOrigin = 'OR' | 'dossier';

/**
 * Q51 (decision client du 19/11) : expert (table des experts, null = aucun) et date de passage,
 * saisis depuis l'OR ou depuis le dossier. Une seule source, le dossier accident ; la base met
 * l'OR a jour et trace le changement (ancien / nouveau, origine). false = migration
 * 20261119200000 absente (l'appelant prend l'ancien chemin).
 */
export async function setAccidentExpert(p: { fileId: string; expertId: string | null; visitDate: string | null; origin: ExpertOrigin }): Promise<boolean> {
  const r = await rpcLoose('accident_file_set_expert', { _file: p.fileId, _expert_id: p.expertId, _visit_date: p.visitDate || null, _origin: p.origin });
  if (!r.error) return true;
  if (missing(r.error) || r.error.code === 'PGRST202' || r.error.code === '42883') return false;
  throw new Error(r.error.message);
}

/**
 * Enregistre le volet assureur. Le nom du cabinet est recopie dans le champ texte du dossier
 * (`insurer` : repris dans le mail et le formulaire Ducati). Expert et date de passage (envoyes
 * ensemble) passent par `setAccidentExpert` : la base recopie le nom et l'e-mail de l'expert sur
 * le dossier et tient l'OR a jour. Sans la migration 20261119200000 : ancien chemin (copie a la main).
 */
export async function saveAccidentInsurance(p: {
  fileId: string; repairOrderId: string | null; patch: Partial<AccidentInsurance>;
  insurerName?: string | null; expertName?: string | null; expertEmail?: string | null;
  /** Ecran d'ou vient la saisie (Q51) : OR ou dossier. */
  origin?: ExpertOrigin;
}): Promise<void> {
  const touchesExpert = 'expert_id' in p.patch || 'expert_visit_date' in p.patch;
  if (touchesExpert) {
    const { expert_id: _e, expert_visit_date: _d, ...rest } = p.patch;
    const restPatch: Record<string, unknown> = { ...rest };
    if (p.insurerName !== undefined) restPatch.insurer = p.insurerName;
    if (Object.keys(restPatch).length) unwrap(await loose.from('accident_files').update(restPatch).eq('id', p.fileId));
    const done = await setAccidentExpert({
      fileId: p.fileId, expertId: p.patch.expert_id ?? null, visitDate: p.patch.expert_visit_date ?? null, origin: p.origin ?? 'dossier',
    });
    if (done) return;
  }
  const filePatch: Record<string, unknown> = { ...p.patch };
  if (p.insurerName !== undefined) filePatch.insurer = p.insurerName;
  if (p.expertName !== undefined) filePatch.expert_name = p.expertName;
  if (p.expertEmail) filePatch.expert_email = p.expertEmail;
  unwrap(await loose.from('accident_files').update(filePatch).eq('id', p.fileId));
  if (p.repairOrderId && (p.expertName !== undefined || p.patch.expert_visit_date !== undefined)) {
    const orPatch: Record<string, unknown> = {};
    if (p.expertName !== undefined) orPatch.expert_name = p.expertName;
    if (p.patch.expert_visit_date !== undefined) orPatch.expert_date = p.patch.expert_visit_date;
    unwrap(await loose.from('repair_orders').update(orPatch).eq('id', p.repairOrderId));
  }
}

// ---------------------------------------------------------------------------------------------
// Vue « O.R. accident » de la liste des OR
// ---------------------------------------------------------------------------------------------

export type AccidentOrRow = {
  id: string; status: string; repair_order_id: string | null; insurer: string | null; expert_name: string | null;
  expert_visit_date: string | null; deductible_kind: string | null; deductible_value: number | null;
  work_start_accepted: boolean; created_at: string;
  insurer_party: { name: string } | null; expert_party: { name: string } | null;
  repair_order: { id: string; number: string | null; status: string; created_at: string; total_ttc: number; expert_name: string | null; expert_date: string | null } | null;
  contact: { id: string; code: string | null; first_name: string | null; last_name: string | null; company_name: string | null; type: string | null } | null;
  vehicle: { id: string; vin: string | null; plate: string | null; brand: string | null; model: string | null } | null;
};

const ACC_SELECT = `id, status, repair_order_id, insurer, expert_name, expert_visit_date, deductible_kind, deductible_value, work_start_accepted, created_at,
  insurer_party:insurance_parties!accident_files_insurer_id_fkey(name), expert_party:insurance_parties!accident_files_expert_id_fkey(name),
  repair_order:repair_orders(id, number, status, created_at, total_ttc, expert_name, expert_date),
  contact:contacts(id, code, first_name, last_name, company_name, type), vehicle:vehicles(id, vin, plate, brand, model)`;

/** OR accident (un dossier accident par OR) ; schemaReady = false si la migration manque. */
export async function listAccidentOrs(companyId: string, opts: { includeInvoiced?: boolean } = {}): Promise<{ rows: AccidentOrRow[]; schemaReady: boolean }> {
  const r = await loose.from('accident_files').select(ACC_SELECT.replace(/\s+/g, ' ')).eq('company_id', companyId)
    .not('repair_order_id', 'is', null).order('created_at', { ascending: false }).limit(300);
  if (r.error && missing(r.error)) return { rows: [], schemaReady: false };
  const rows = (unwrap<AccidentOrRow[]>(r) ?? []).filter((x) => x.repair_order && x.repair_order.status !== 'annule' && (opts.includeInvoiced || x.repair_order.status !== 'facture'));
  return { rows, schemaReady: true };
}
