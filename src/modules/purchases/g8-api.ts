/**
 * M4 — Accès Supabase du rattrapage G8 achats (18/11/2026). Toutes les écritures passent par les
 * fonctions SQL de 20261118200000 / 20261118201000 (une transaction, trace events) ; ces fonctions
 * et colonnes ne sont pas encore dans types.ts : client non typé, comme les modules orders / basket.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PurchaseDocType, PurchaseOrderType, SendChannel, InformChannel, VatRegimeCode } from './g8-rules';

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
const n = (v: unknown) => Number(v ?? 0) || 0;
const nOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

/* ------------------------------------------------------------------ Enregistrement atomique */
export type ChassisPayload = Record<string, string | number | boolean | null | undefined> & { vin: string };
export type DocLinePayload = {
  article_id?: string | null; designation: string; supplier_ref?: string | null; quantity: number; unit_price_ht: number;
  discount_pct: number; vat_rate: number; sale_price_ttc?: number | null; bin_location?: string | null; labels?: number;
  source_line_id?: string | null; contact_id?: string | null; origin_kind?: string | null; origin_id?: string | null;
  origin_ref?: string | null; chassis?: ChassisPayload | null;
};
export type DocHeaderPayload = {
  doc_type: PurchaseDocType; supplier_id: string | null; vat_regime: VatRegimeCode; order_type?: PurchaseOrderType | null;
  supplier_invoice_no?: string | null; supplier_bl_no?: string | null; intranet_no?: string | null;
  invoice_date?: string | null; bl_date?: string | null; receipt_date?: string | null; order_date?: string | null;
  expected_date?: string | null; shipping_ht?: number; shipping_taxed?: boolean; shipping_vat_rate?: number;
  global_discount_pct?: number; spread_costs?: boolean; notes?: string | null;
};
export type DocSaveResult = {
  id: string; number: string | null; status: string; doc_type: PurchaseDocType;
  warnings: { kind: string; designation?: string }[];
  orders?: { id: string; number?: string | null; status: string }[];
};

export function savePurchaseDoc(p: {
  companyId: string; id?: string | null; header: DocHeaderPayload; lines: DocLinePayload[];
  schedules?: { seq_no: number; due_date: string | null; amount: number; note?: string | null }[]; validate: boolean;
}): Promise<DocSaveResult> {
  return rpc<DocSaveResult>('purchase_doc_save', {
    _company: p.companyId, _id: p.id ?? null, _header: p.header, _lines: p.lines, _schedules: p.schedules ?? [], _validate: p.validate,
  });
}

export const deletePurchaseDraft = (id: string) => rpc<void>('purchase_draft_delete', { _id: id });

/* ------------------------------------------------------------------ Rappel / suivi */
export type OpenLine = {
  order_id: string; order_number: string | null; order_date: string | null; order_type: string | null; order_status: string;
  dcs_kind: string | null; line_id: string; article_id: string | null; reference: string | null; designation: string;
  supplier_ref: string | null; quantity: number; received: number; remaining: number; unit_price_ht: number;
  discount_pct: number; vat_rate: number; sale_price_ttc: number | null; bin_location: string | null; pack_qty: number;
  mgmt_type: string | null; contact_id: string | null; contact_name: string | null;
};
export async function listOpenLines(companyId: string, supplierId: string | null, docType: 'CMD' | 'PCF' = 'CMD', orderId: string | null = null): Promise<OpenLine[]> {
  const rows = await rpc<Record<string, unknown>[]>('purchase_open_lines', { _company: companyId, _supplier: supplierId, _doc_type: docType, _order: orderId });
  return (rows ?? []).map((r) => ({
    ...(r as unknown as OpenLine),
    quantity: n(r.quantity), received: n(r.received), remaining: n(r.remaining), unit_price_ht: n(r.unit_price_ht),
    discount_pct: n(r.discount_pct), vat_rate: n(r.vat_rate), sale_price_ttc: nOrNull(r.sale_price_ttc), pack_qty: n(r.pack_qty),
  }));
}

export type OrderFollow = {
  lines: { line_id: string; quantity: number; received: number; remaining: number }[];
  receipts: { id: string; number: string | null; date: string | null; invoice_no: string | null; status: string }[];
  orders: { id: string; number: string | null; status: string }[];
  sends: { sent_at: string; channel: SendChannel; note: string | null; sent_by: string | null }[];
  merged: { id: string; number: string | null }[];
};
export async function getOrderFollow(orderId: string): Promise<OrderFollow> {
  const f = await rpc<OrderFollow>('purchase_order_follow', { _order: orderId });
  return { ...f, lines: (f.lines ?? []).map((l) => ({ ...l, quantity: n(l.quantity), received: n(l.received), remaining: n(l.remaining) })) };
}

export const closeOrderRemainder = (orderId: string, note: string | null) => rpc<void>('purchase_order_close_remainder', { _order: orderId, _note: note });
export const logOrderSend = (orderId: string, channel: SendChannel, note: string | null) => rpc<number>('purchase_order_log_send', { _order: orderId, _channel: channel, _note: note });
export const mergeOrders = (companyId: string, ids: string[], note: string | null) =>
  rpc<{ id: string; number: string | null; merged: number }>('purchase_orders_merge', { _company: companyId, _ids: ids, _note: note });
export const proposalToOrder = (proposalId: string) => rpc<string>('purchase_proposal_to_order', { _proposal: proposalId });

export type ProposalItem = { article_id: string; qty: number; supplier_id?: string | null; contact_id?: string | null; designation?: string | null };
export function addToProposal(p: {
  companyId: string; orderType: PurchaseOrderType; items: ProposalItem[]; originKind: 'article' | 'document' | 'repair_order' | 'reorder';
  originId?: string | null; originRef?: string | null; note?: string | null;
}) {
  return rpc<{ items: { proposal_id: string; article_id: string; qty: number; supplier_id: string }[] }>('purchase_proposal_add', {
    _company: p.companyId, _order_type: p.orderType, _items: p.items, _origin_kind: p.originKind,
    _origin_id: p.originId ?? null, _origin_ref: p.originRef ?? null, _note: p.note ?? null,
  });
}

/* ------------------------------------------------------------------ Infos commandes client */
export type CustomerInfoRow = {
  receipt_line_id: string; article_id: string; reference: string | null; designation: string; qty_received: number;
  bin_location: string | null; source_kind: 'part_order' | 'document' | 'repair_order'; source_id: string;
  source_number: string | null; source_type: string | null; source_status: string | null; source_date: string | null;
  contact_id: string | null; contact_name: string | null; contact_phone: string | null; qty_needed: number;
  ordered_for: boolean; informed_at: string | null; informed_channel: string | null;
  /** PIE-05 : par quoi la pièce est arrivée (commande fournisseur, panier Ducati, classeur Excel). */
  via_kind?: 'cmd' | 'basket' | 'excel' | null; via_number?: string | null;
};
export async function getReceiptCustomerInfos(receiptId: string): Promise<CustomerInfoRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('receipt_customer_infos', { _receipt: receiptId });
  return (rows ?? []).map((r) => ({ ...(r as unknown as CustomerInfoRow), qty_received: n(r.qty_received), qty_needed: n(r.qty_needed) }));
}
export const markCustomerInformed = (p: { receiptId: string; articleId: string | null; sourceKind: string; sourceId: string; contactId: string | null; channel: InformChannel; note?: string | null }) =>
  rpc<number>('receipt_customer_informed', {
    _receipt: p.receiptId, _article: p.articleId, _source_kind: p.sourceKind, _source_id: p.sourceId,
    _contact: p.contactId, _channel: p.channel, _note: p.note ?? null,
  });

/* ------------------------------------------------------------------ Fournisseur */
export type SupplierConditions = {
  supplier_customer_no: string | null; supplier_franco_min: number | null; supplier_order_min: number | null;
  supplier_order_min_qty: number | null; supplier_shipping_fixed: number | null; supplier_shipping_vat_rate: number | null;
  supplier_rush_discount_pct: number | null; supplier_vat_regime: VatRegimeCode | null; supplier_website: string | null;
  supplier_b2b_url: string | null; supplier_order_footer: string | null; supplier_rfa_rate: number | null;
};
export const SUPPLIER_CONDITION_KEYS: (keyof SupplierConditions)[] = [
  'supplier_customer_no', 'supplier_franco_min', 'supplier_order_min', 'supplier_order_min_qty', 'supplier_shipping_fixed',
  'supplier_shipping_vat_rate', 'supplier_rush_discount_pct', 'supplier_vat_regime', 'supplier_website', 'supplier_b2b_url',
  'supplier_order_footer', 'supplier_rfa_rate',
];
const NUMERIC_KEYS = new Set<keyof SupplierConditions>(['supplier_franco_min', 'supplier_order_min', 'supplier_order_min_qty',
  'supplier_shipping_fixed', 'supplier_shipping_vat_rate', 'supplier_rush_discount_pct', 'supplier_rfa_rate']);

export async function getSupplierConditions(supplierId: string): Promise<SupplierConditions> {
  const { data, error } = await sb.from('contacts').select('*').eq('id', supplierId).single();
  if (error) throw error;
  const out = {} as Record<string, unknown>;
  for (const k of SUPPLIER_CONDITION_KEYS) out[k] = NUMERIC_KEYS.has(k) ? nOrNull(data?.[k]) : (data?.[k] ?? null);
  return out as SupplierConditions;
}
export async function updateSupplierConditions(supplierId: string, c: SupplierConditions): Promise<void> {
  const { error } = await sb.from('contacts').update(c).eq('id', supplierId);
  if (error) throw error;
}
export const getSupplierOpenOrders = (supplierId: string) =>
  rpc<{ amount_ht: number; orders: number; lines: number }>('supplier_open_orders', { _supplier: supplierId });

export type SupplierTurnoverRow = { fiscal_year: number; purchases_ht: number; returns_ht: number; receipts: number; sales_ht: number; margin_ht: number };
export async function getSupplierTurnover(supplierId: string): Promise<SupplierTurnoverRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('supplier_turnover', { _supplier: supplierId });
  return (rows ?? []).map((r) => ({
    fiscal_year: n(r.fiscal_year), purchases_ht: n(r.purchases_ht), returns_ht: n(r.returns_ht), receipts: n(r.receipts),
    sales_ht: n(r.sales_ht), margin_ht: n(r.margin_ht),
  }));
}

export type YearEndRebate = {
  id: string; company_id: string; supplier_id: string; family_code: string | null; label: string; rebate_pct: number | null;
  amount: number; rebate_date: string; note: string | null;
};
export async function listYearEndRebates(companyId: string, supplierId?: string | null): Promise<YearEndRebate[]> {
  let q = sb.from('supplier_year_end_rebates').select('*').eq('company_id', companyId).order('rebate_date', { ascending: false });
  if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as YearEndRebate), amount: n(r.amount), rebate_pct: nOrNull(r.rebate_pct) }));
}
export async function saveYearEndRebate(r: Omit<YearEndRebate, 'id'> & { id?: string | null }): Promise<void> {
  const { id, ...row } = r;
  const { error } = id
    ? await sb.from('supplier_year_end_rebates').update(row).eq('id', id)
    : await sb.from('supplier_year_end_rebates').insert(row);
  if (error) throw error;
}
export async function deleteYearEndRebate(id: string): Promise<void> {
  const { error } = await sb.from('supplier_year_end_rebates').delete().eq('id', id);
  if (error) throw error;
}

/* ------------------------------------------------------------------ Liste des documents fournisseurs */
export type PurchaseDocRow = {
  id: string; doc_type: PurchaseDocType; number: string | null; status: string; order_type: string | null; doc_date: string | null;
  supplier_id: string | null; supplier_name: string | null; operator_name: string | null; supplier_invoice_no: string | null;
  invoice_date: string | null; supplier_bl_no: string | null; bl_date: string | null; total_ht: number; total_vat: number;
  total_ttc: number; shipping_ht: number; shipping_ttc: number; dcs_kind: string | null; validated_at: string | null;
  last_sent_at: string | null; receipts: string | null;
};
export type ListFilter = { from: string | null; to: string | null; supplierId: string | null };
export async function listPurchaseDocuments(companyId: string, docType: PurchaseDocType | null, f: ListFilter): Promise<PurchaseDocRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('purchase_documents', {
    _company: companyId, _doc_type: docType, _from: f.from, _to: f.to, _supplier: f.supplierId, _limit: 1000,
  });
  return (rows ?? []).map((r) => ({
    ...(r as unknown as PurchaseDocRow),
    total_ht: n(r.total_ht), total_vat: n(r.total_vat), total_ttc: n(r.total_ttc), shipping_ht: n(r.shipping_ht), shipping_ttc: n(r.shipping_ttc),
  }));
}

export type DueRow = {
  order_id: string; number: string | null; doc_type: string; receipt_date: string | null; due_date: string | null; amount: number;
  supplier_id: string | null; supplier_name: string | null; supplier_code: string | null; accounting_account: string | null;
  supplier_invoice_no: string | null; invoice_date: string | null; chassis: string | null;
};
export async function listDueSchedules(companyId: string, f: ListFilter): Promise<DueRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('purchase_due_schedules', { _company: companyId, _from: f.from, _to: f.to, _supplier: f.supplierId });
  return (rows ?? []).map((r) => ({ ...(r as unknown as DueRow), amount: n(r.amount) }));
}

export type VatRow = { supplier_id: string | null; supplier_name: string | null; vat_number: string | null; vat_rate: number; base_ht: number; vat: number; ttc: number; receipts: number };
export async function listVatBySupplier(companyId: string, f: ListFilter, basis: 'receipt' | 'invoice'): Promise<VatRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('purchase_vat_by_supplier', { _company: companyId, _from: f.from, _to: f.to, _basis: basis });
  return (rows ?? [])
    .filter((r) => !f.supplierId || r.supplier_id === f.supplierId)
    .map((r) => ({ ...(r as unknown as VatRow), vat_rate: n(r.vat_rate), base_ht: n(r.base_ht), vat: n(r.vat), ttc: n(r.ttc), receipts: n(r.receipts) }));
}

export type HistoryRow = {
  order_id: string; number: string | null; order_type: string | null; status: string; sent_at: string; channel: string; note: string | null;
  sent_by_name: string | null; supplier_id: string | null; supplier_code: string | null; supplier_name: string | null; receipts: string | null;
};
export const listOrderHistory = (companyId: string, f: ListFilter) =>
  rpc<HistoryRow[]>('purchase_order_history', { _company: companyId, _from: f.from, _to: f.to, _supplier: f.supplierId }).then((r) => r ?? []);
