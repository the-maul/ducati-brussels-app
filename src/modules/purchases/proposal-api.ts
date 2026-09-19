/**
 * M4 — Proposition de commande (mission 02, carte 4) : accès Supabase.
 * Lecture : `supplier_order_proposal` ; écritures uniquement par fonctions SQL tracées dans `events` :
 * `supplier_proposal_set_supplier`, `supplier_order_from_proposal` (CMD + liens + états),
 * `supplier_proposal_log_mail` (mail réellement envoyé). Réception : `purchase_order_destinations`.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProposalRow } from './proposal';

const num = (v: unknown) => Number(v ?? 0) || 0;
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export async function getSupplierProposal(companyId: string): Promise<ProposalRow[]> {
  const { data, error } = await supabase.rpc('supplier_order_proposal', { _company: companyId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    supplier_order_min: numOrNull(r.supplier_order_min),
    supplier_franco_min: numOrNull(r.supplier_franco_min),
    supplier_is_dcs: !!r.supplier_is_dcs,
    paid: !!r.paid,
    qty_client: num(r.qty_client), qty_shop: num(r.qty_shop),
    purchase_price: numOrNull(r.purchase_price),
    sale_price_ht: num(r.sale_price_ht), vat_rate: num(r.vat_rate),
  })) as ProposalRow[];
}

export async function setProposalLineSupplier(lineId: string, supplierId: string | null): Promise<void> {
  const { error } = await supabase.rpc('supplier_proposal_set_supplier', { _line: lineId, _supplier: supplierId as string });
  if (error) throw error;
}

export type SupplierOrderResult = {
  orders: { id: string; number: string; dcs_kind: 'STANDARD' | 'URGENTE' | null; lines: number }[];
  part_orders_sent: { id: string; number: string | null }[];
  part_orders_kept: { id: string; number: string | null; status: string; reason: 'partial' | 'unpaid' | 'rules'; message?: string }[];
};

export async function createSupplierOrder(companyId: string, supplierId: string, lineIds: string[], note?: string): Promise<SupplierOrderResult> {
  const { data, error } = await supabase.rpc('supplier_order_from_proposal', {
    _company: companyId, _supplier: supplierId, _line_ids: lineIds, _note: note ?? undefined,
  });
  if (error) throw error;
  return data as unknown as SupplierOrderResult;
}

export async function logSupplierMail(p: {
  companyId: string; supplierId: string; kind: 'price_request' | 'order'; to: string; from: string;
  subject: string; lineIds: string[]; attachment: string;
}): Promise<void> {
  const { error } = await supabase.rpc('supplier_proposal_log_mail', {
    _company: p.companyId, _supplier: p.supplierId, _kind: p.kind, _to: p.to, _from: p.from,
    _subject: p.subject, _line_ids: p.lineIds, _attachment: p.attachment,
  });
  if (error) throw error;
}

export type PurchaseDestination = {
  purchase_line_id: string; part_order_line_id: string; part_order_id: string; part_order_number: string | null;
  order_kind: string; dispatch_status: string; contact_id: string | null; contact_name: string | null;
  source_document_id: string | null; source_document_number: string | null; qty_client: number; qty_shop: number;
};

/** À qui est destinée chaque ligne d'une commande fournisseur (ou de la réception reliée). */
export async function getPurchaseDestinations(orderId: string): Promise<PurchaseDestination[]> {
  const { data, error } = await supabase.rpc('purchase_order_destinations', { _order: orderId });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, qty_client: num(r.qty_client), qty_shop: num(r.qty_shop) })) as PurchaseDestination[];
}
