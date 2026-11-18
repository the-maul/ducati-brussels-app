/**
 * M8 — OR garantie (B10) : acces base (rattrapage G8 du 18/11/2026).
 *
 * Colonnes, tables, vue et fonction de la migration 20261118130000 (non appliquee a l'ecriture :
 * `types.ts` ne les connait pas, d'ou les appels non types — meme parade que `accident/api.ts`).
 * Chaque lecture sait dire « migration absente » pour que l'ecran l'explique au lieu de planter.
 */
import { supabase } from '@/integrations/supabase/client';
import { listRef } from '@/modules/settings/reference-api';
import {
  DEFAULT_WARRANTY_CESSION_LABELS, WARRANTY_CESSION_CODES, WARRANTY_SETTINGS_TABLE_KEY, parseWarrantyRate,
  type WarrantyCessionCode, type WarrantyReturnStatus, type WarrantyStatRow,
} from './rules';

type LooseResult = { data: unknown; error: { code?: string; message: string } | null };
type LooseBuilder = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseBuilder;
  update: (values: Record<string, unknown>) => LooseBuilder;
  delete: () => LooseBuilder;
  eq: (col: string, value: unknown) => LooseBuilder;
  neq: (col: string, value: unknown) => LooseBuilder;
  in: (col: string, values: unknown[]) => LooseBuilder;
  or: (filter: string) => LooseBuilder;
  gte: (col: string, value: unknown) => LooseBuilder;
  lte: (col: string, value: unknown) => LooseBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => LooseBuilder;
  limit: (n: number) => LooseBuilder;
};
const loose = supabase as unknown as {
  from: (table: string) => LooseBuilder;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<LooseResult>;
};

const unwrap = <T,>(r: LooseResult): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

/** Erreur « table / colonne / fonction inconnue » : la migration n'est pas posee. */
export const isMissingSchemaError = (e: { code?: string; message?: string } | null | undefined): boolean => {
  const code = e?.code ?? '';
  return code === '42P01' || code === '42703' || code === '42883' || code === 'PGRST200' || code === 'PGRST202' || code === 'PGRST204' || code === 'PGRST205'
    || /does not exist|Could not find|schema cache/i.test(e?.message ?? '');
};

/** Taux MO garantie HT (Parametres → Tables → Garantie atelier) ; null = prix de la ligne. */
export async function loadWarrantyRate(companyId: string): Promise<number | null> {
  try {
    return parseWarrantyRate(await listRef(companyId, WARRANTY_SETTINGS_TABLE_KEY));
  } catch {
    return null;
  }
}

/** Types de cession garantie proposes sur l'OR (libelles de la table, sinon ceux de G8). */
export async function listWarrantyCessionTypes(companyId: string): Promise<{ code: WarrantyCessionCode; label: string }[]> {
  let rows: { code: string; label: string; is_active: boolean }[] = [];
  try { rows = await listRef(companyId, 'cession_type'); } catch { rows = []; }
  return WARRANTY_CESSION_CODES
    .filter((code) => rows.find((r) => r.code === code)?.is_active !== false)
    .map((code) => ({ code, label: rows.find((r) => r.code === code)?.label || DEFAULT_WARRANTY_CESSION_LABELS[code] }));
}

// ---------------------------------------------------------------------------------------------
// Vues de la liste des OR : « O.R. garantie »
// ---------------------------------------------------------------------------------------------

export type OrListContact = { id: string; code: string | null; first_name: string | null; last_name: string | null; company_name: string | null; type: string | null };
export type OrListVehicle = { id: string; vin: string | null; plate: string | null; brand: string | null; model: string | null };

export type WarrantyOrRow = {
  id: string; number: string | null; status: string; warranty_status: string;
  warranty_cession_code: string | null; warranty_note: string | null;
  total_ttc: number; created_at: string; operator: string | null;
  contact: OrListContact | null; vehicle: OrListVehicle | null;
};

const OR_JOINS = 'contact:contacts(id,code,first_name,last_name,company_name,type), vehicle:vehicles(id,vin,plate,brand,model)';

/** OR garantie (prise en charge engagee ou type de cession choisi), les plus recents d'abord. */
export async function listWarrantyOrs(companyId: string, opts: { includeInvoiced?: boolean } = {}): Promise<{ rows: WarrantyOrRow[]; schemaReady: boolean }> {
  const cols = `id, number, status, warranty_status, warranty_cession_code, warranty_note, total_ttc, created_at, operator, ${OR_JOINS}`;
  let q = loose.from('repair_orders').select(cols).eq('company_id', companyId)
    .or('warranty_status.neq.aucune,warranty_cession_code.not.is.null');
  if (!opts.includeInvoiced) q = q.neq('status', 'facture');
  const r = await q.neq('status', 'annule').order('created_at', { ascending: false }).limit(300);
  if (!r.error) return { rows: (r.data as WarrantyOrRow[]) ?? [], schemaReady: true };
  if (!isMissingSchemaError(r.error)) throw new Error(r.error.message);
  // Migration absente : la vue se contente du statut de prise en charge.
  const colsOld = `id, number, status, warranty_status, total_ttc, created_at, operator, ${OR_JOINS}`;
  let q2 = loose.from('repair_orders').select(colsOld).eq('company_id', companyId).neq('warranty_status', 'aucune');
  if (!opts.includeInvoiced) q2 = q2.neq('status', 'facture');
  const r2 = await q2.neq('status', 'annule').order('created_at', { ascending: false }).limit(300);
  const rows = (unwrap<Omit<WarrantyOrRow, 'warranty_cession_code' | 'warranty_note'>[]>(r2) ?? [])
    .map((x) => ({ ...x, warranty_cession_code: null, warranty_note: null }));
  return { rows, schemaReady: false };
}

// ---------------------------------------------------------------------------------------------
// Liste « Garanties » (lignes imputees) et « Garanties / CA »
// ---------------------------------------------------------------------------------------------

export type WarrantyLineRow = {
  line_id: string; repair_order_id: string; or_number: string | null; warranty_cession_code: string | null;
  warranty_status: string; imputed_on: string; contact_id: string | null; client_code: string | null; client_name: string | null;
  vehicle_id: string | null; vin: string | null; plate: string | null; vehicle_label: string | null; mileage: number | null;
  kind: string; reference: string | null; designation: string; quantity: number;
  labour_hours: number; parts_cost_ht: number; parts_pa_ht: number; labour_cost_ht: number; cost_ht: number; sale_ht: number;
};

export async function listWarrantyLines(companyId: string, from: string, to: string, cession?: string | null): Promise<WarrantyLineRow[]> {
  let q = loose.from('warranty_lines_v').select('*').eq('company_id', companyId).gte('imputed_on', from).lte('imputed_on', to);
  if (cession) q = q.eq('warranty_cession_code', cession);
  const r = await q.order('imputed_on', { ascending: false }).limit(2000);
  return unwrap<WarrantyLineRow[]>(r) ?? [];
}

export async function warrantyStatsByClient(companyId: string, from: string, to: string): Promise<WarrantyStatRow[]> {
  const r = await loose.rpc('warranty_stats_by_client', { _company: companyId, _from: from, _to: to });
  return unwrap<WarrantyStatRow[]>(r) ?? [];
}

// ---------------------------------------------------------------------------------------------
// Retours / remboursements constructeur
// ---------------------------------------------------------------------------------------------

export type WarrantyReturnRow = {
  id: string; company_id: string; supplier_id: string | null; contact_id: string | null; vehicle_id: string | null;
  repair_order_id: string | null; repair_order_line_id: string | null; article_id: string | null;
  reference: string | null; designation: string; quantity: number; unit_cost_ht: number; amount_ht: number;
  status: WarrantyReturnStatus; taken_at: string | null; received_at: string | null; settled_at: string | null;
  purchase_invoice_number: string | null; purchase_invoice_date: string | null;
  delivery_note_number: string | null; delivery_note_date: string | null; ticket_number: string | null; notes: string | null;
  created_at: string; updated_at: string;
  supplier: { id: string; company_name: string | null; last_name: string | null; first_name: string | null; code: string | null } | null;
  contact: OrListContact | null;
  vehicle: OrListVehicle | null;
  repair_order: { id: string; number: string | null } | null;
};

export type WarrantyReturnsFilter = {
  supplierId?: string | null; contactId?: string | null; status?: WarrantyReturnStatus | 'en_attente' | null;
  dateField?: 'taken_at' | 'received_at' | 'settled_at'; from?: string | null; to?: string | null;
};

const RETURN_SELECT = '*, supplier:contacts!warranty_returns_supplier_id_fkey(id,company_name,last_name,first_name,code), contact:contacts!warranty_returns_contact_id_fkey(id,code,first_name,last_name,company_name,type), vehicle:vehicles(id,vin,plate,brand,model), repair_order:repair_orders(id,number)';

/** Historique garantie (tous fournisseurs) ou fiche fournisseur › Garantie (un fournisseur). */
export async function listWarrantyReturns(companyId: string, f: WarrantyReturnsFilter = {}): Promise<{ rows: WarrantyReturnRow[]; schemaReady: boolean }> {
  let q = loose.from('warranty_returns').select(RETURN_SELECT).eq('company_id', companyId);
  if (f.supplierId) q = q.eq('supplier_id', f.supplierId);
  if (f.contactId) q = q.eq('contact_id', f.contactId);
  if (f.status === 'en_attente') q = q.in('status', ['attente_remboursement', 'attente_echange']);
  else if (f.status) q = q.eq('status', f.status);
  const field = f.dateField ?? 'taken_at';
  if (f.from) q = q.gte(field, f.from);
  if (f.to) q = q.lte(field, f.to);
  const r = await q.order('created_at', { ascending: false }).limit(1000);
  if (r.error && isMissingSchemaError(r.error)) return { rows: [], schemaReady: false };
  return { rows: unwrap<WarrantyReturnRow[]>(r) ?? [], schemaReady: true };
}

export type WarrantyReturnPatch = Partial<Pick<WarrantyReturnRow,
  'status' | 'taken_at' | 'received_at' | 'settled_at' | 'purchase_invoice_number' | 'purchase_invoice_date'
  | 'delivery_note_number' | 'delivery_note_date' | 'ticket_number' | 'amount_ht' | 'notes' | 'supplier_id'>>;

export async function updateWarrantyReturn(id: string, patch: WarrantyReturnPatch): Promise<void> {
  unwrap(await loose.from('warranty_returns').update(patch as Record<string, unknown>).eq('id', id));
}

/** Supprimer une ligne de suivi (G8 : bouton Supprimer) ; tracee dans le journal (audit). */
export async function deleteWarrantyReturn(id: string): Promise<void> {
  unwrap(await loose.from('warranty_returns').delete().eq('id', id));
}
