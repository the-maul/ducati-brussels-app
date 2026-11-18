/**
 * M7 — Dépôt-vente complet (18/11/2026, VEN007 / VEN008) : accès base.
 * Toute écriture passe par les fonctions SQL transactionnelles de la migration
 * 20261118270000_m7_depot_vente_complet.sql (consignment_create / _update / _sell /
 * _pay_depositor / _return). Colonnes et fonctions absentes de `types.ts` tant que la migration
 * n'est pas posée : appels non typés, et `ConsignmentUnavailableError` quand elle manque.
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingSchema } from '@/modules/articles/api';
import type { CommissionMode, DepositorKind, ConsignmentStatus } from './consignment-rules';

// Fonctions et colonnes récentes, absentes du type généré : appels non typés (liés au client).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any).call(supabase, fn, args) as Promise<{ data: unknown; error: unknown }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

export class ConsignmentUnavailableError extends Error {
  constructor() { super('consignment_unavailable'); }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) {
    if (isMissingSchema(error)) throw new ConsignmentUnavailableError();
    throw new Error((error as { message?: string }).message ?? String(error));
  }
  return data as T;
}

export type PartyBrief = { id: string; first_name: string | null; last_name: string | null; company_name: string | null; code: string | null };
export type VehicleBrief = {
  id: string; vin: string | null; plate: string | null; brand: string | null; model: string | null;
  model_year: number | null; reference: string | null; mileage: number | null; color: string | null;
  first_registration_date: string | null;
};
export type DocBrief = { id: string; number: string | null; total_ttc: number; paid_amount: number; status: string };

export type Consignment = {
  id: string; company_id: string; number: string | null; status: ConsignmentStatus;
  depositor_id: string | null; depositor_kind: DepositorKind; vehicle_id: string | null; article_id: string | null;
  agreed_price: number; asked_price: number; min_price: number;
  commission_mode: CommissionMode; commission_pct: number; commission_amount: number | null; deposit_fee: number;
  conditions: string | null; legal_mention: string | null; police_book_number: string | null;
  checklist: Record<string, boolean> | null; entry_date: string; expected_delivery_date: string | null; notes: string | null;
  buyer_id: string | null; sold_at: string | null; sold_price: number | null;
  sold_commission: number | null; sold_commission_ht: number | null; sold_commission_vat: number | null;
  sold_fees: number | null; sold_repairs: number | null; sold_vat_rate: number | null;
  sold_invoice_ht: number | null; sold_invoice_vat: number | null; sold_reversal: number | null;
  sale_document_id: string | null; commission_document_id: string | null; credit_note_document_id: string | null;
  payout_at: string | null; payout_method: string | null; payout_amount: number | null; payout_reference: string | null;
  returned_at: string | null; return_reason: string | null; return_fee: number | null; return_document_id: string | null;
  created_at: string;
};
export type ConsignmentFull = Consignment & {
  depositor: PartyBrief | null; buyer: PartyBrief | null; vehicle: VehicleBrief | null;
  article: { reference: string | null } | null;
  sale_doc: DocBrief | null; commission_doc: DocBrief | null; credit_doc: DocBrief | null; return_doc: DocBrief | null;
};

const PARTY = 'id, first_name, last_name, company_name, code';
const DOC = 'id, number, total_ttc, paid_amount, status';
const SELECT = `*, depositor:contacts!consignments_depositor_id_fkey(${PARTY}), buyer:contacts!consignments_buyer_id_fkey(${PARTY}),
  vehicle:vehicles!consignments_vehicle_id_fkey(id, vin, plate, brand, model, model_year, reference, mileage, color, first_registration_date),
  article:articles!consignments_article_id_fkey(reference),
  sale_doc:documents!consignments_sale_document_id_fkey(${DOC}), commission_doc:documents!consignments_commission_document_id_fkey(${DOC}),
  credit_doc:documents!consignments_credit_note_document_id_fkey(${DOC}), return_doc:documents!consignments_return_document_id_fkey(${DOC})`;

export async function listConsignmentsFull(companyId: string): Promise<ConsignmentFull[]> {
  const { data, error } = await db.from('consignments').select(SELECT)
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(1000);
  if (error) {
    if (isMissingSchema(error) || (error as { code?: string }).code === 'PGRST200') throw new ConsignmentUnavailableError();
    throw error;
  }
  return (data ?? []) as ConsignmentFull[];
}

export async function getConsignment(id: string): Promise<ConsignmentFull> {
  const { data, error } = await db.from('consignments').select(SELECT).eq('id', id).single();
  if (error) throw error;
  return data as ConsignmentFull;
}

/** Réglages « Dépôt-vente — réglages » (code → valeur), Paramètres → Tables. */
export async function loadConsignmentSettings(companyId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('reference_values').select('code, label')
    .eq('company_id', companyId).eq('table_key', 'consignment_settings').eq('is_active', true);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.code, r.label]));
}

export type ConsignmentInput = {
  depositor_id: string; depositor_kind: DepositorKind;
  vehicle_id?: string | null;
  vehicle?: { vin: string; brand?: string; model?: string; model_year?: string; plate?: string; mileage?: string; color?: string; first_registration_date?: string } | null;
  agreed_price: number; asked_price: number; min_price: number;
  commission_mode: CommissionMode; commission_pct: number; commission_amount?: number | null; deposit_fee: number;
  conditions?: string | null; legal_mention?: string | null; police_book_number?: string | null;
  checklist: Record<string, boolean>; entry_date?: string | null; notes?: string | null;
};

export const createConsignment = (companyId: string, data: ConsignmentInput) =>
  call<string>('consignment_create', { _company: companyId, _data: data });

export const updateConsignment = (id: string, data: Partial<ConsignmentInput>) =>
  call<void>('consignment_update', { _consignment: id, _data: data });

export type SaleInput = {
  buyer_id: string; sale_price: number; fees: number; repairs: number;
  expected_delivery_date?: string | null; force_below_min?: boolean;
  buyer_invoice?: boolean; commission_invoice?: boolean; credit_note?: boolean; receipt_method?: string | null;
};
export type SaleResult = {
  sale_document_id: string | null; sale_number: string | null;
  commission_document_id: string | null; commission_number: string | null;
  credit_note_id: string | null; credit_note_number: string | null;
  sale_price: number; commission_ttc: number; fees: number; repairs: number; invoice_ttc: number; net: number;
};
export const sellConsignment = (id: string, data: SaleInput) =>
  call<SaleResult>('consignment_sell', { _consignment: id, _data: data });

export const payDepositor = (id: string, method: string, reference?: string | null) =>
  call<void>('consignment_pay_depositor', { _consignment: id, _method: method, _reference: reference ?? null });

export const returnConsignment = (id: string, reason: string, fee: number) =>
  call<{ document_id: string | null; document_number: string | null }>('consignment_return', { _consignment: id, _reason: reason, _fee: fee });

/** Réparations liées à la moto du dépôt (G8 « Voir réparations ») : OR et cessions depuis l'entrée. */
export type LinkedRepair = { id: string; kind: 'or' | 'cession'; number: string | null; status: string; date: string; amount: number; invoiced: boolean };
export async function listLinkedRepairs(vehicleId: string, sinceIso: string): Promise<LinkedRepair[]> {
  const out: LinkedRepair[] = [];
  const { data: ors, error } = await supabase.from('repair_orders')
    .select('id, number, status, created_at, total_ttc, invoice_document_id')
    .eq('vehicle_id', vehicleId).gte('created_at', sinceIso).order('created_at', { ascending: false });
  if (error) throw error;
  for (const o of ors ?? []) {
    out.push({ id: o.id, kind: 'or', number: o.number, status: o.status, date: o.created_at, amount: Number(o.total_ttc ?? 0), invoiced: !!o.invoice_document_id });
  }
  // Cessions internes (lot cessions, migration 20261118240000) : lues si la table existe.
  const { data: ces, error: ce } = await db.from('internal_cessions')
    .select('id, number, status, created_at, total_cost').eq('vehicle_id', vehicleId).gte('created_at', sinceIso);
  if (!ce) {
    for (const c of (ces ?? []) as { id: string; number: string | null; status: string; created_at: string; total_cost: number }[]) {
      out.push({ id: c.id, kind: 'cession', number: c.number, status: c.status, date: c.created_at, amount: Number(c.total_cost ?? 0), invoiced: false });
    }
  }
  return out;
}

/** Total des OR non facturés : proposé comme réparations à déduire du reversement. */
export const uninvoicedRepairsTotal = (rows: LinkedRepair[]): number =>
  Math.round(rows.filter((r) => r.kind === 'or' && !r.invoiced && r.status !== 'annule').reduce((s, r) => s + r.amount, 0) * 100) / 100;
