/**
 * M6 — « En commande » par client et associations (mission 05, carte 7) : accès base.
 * Fonctions SQL : document_lines_stock, part_order_open_lines, part_order_allocate,
 * part_order_allocation_cancel, document_allocations (migration 20260919311000).
 */
import { supabase } from '@/integrations/supabase/client';
import type { OpenOrderLine } from './on-order';

export type DocLineStock = {
  line_id: string; article_id: string; mgmt_type: string | null; quantity: number;
  real_qty: number; reserved_qty: number;
  on_order_qty: number;        // en commande pour le client du document (+ stock)
  on_order_stock_qty: number;  // en commande pour le stock seulement
};

export async function getDocumentLinesStock(documentId: string): Promise<DocLineStock[]> {
  const { data, error } = await supabase.rpc('document_lines_stock', { _document: documentId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    line_id: r.line_id, article_id: r.article_id, mgmt_type: r.mgmt_type, quantity: Number(r.quantity),
    real_qty: Number(r.real_qty), reserved_qty: Number(r.reserved_qty),
    on_order_qty: Number(r.on_order_qty), on_order_stock_qty: Number(r.on_order_stock_qty),
  }));
}

export async function listOpenOrderLines(articleId: string, documentId: string): Promise<OpenOrderLine[]> {
  const { data, error } = await supabase.rpc('part_order_open_lines', { _article: articleId, _document: documentId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    qty_client: Number(r.qty_client), qty_shop: Number(r.qty_shop),
    allocated_qty: Number(r.allocated_qty), allocated_here: Number(r.allocated_here),
  })) as OpenOrderLine[];
}

/** Associe une quantité magasin d'une commande en cours au client du document (tracé dans events). */
export async function allocateOrderLine(lineId: string, documentId: string, qty: number): Promise<string> {
  const { data, error } = await supabase.rpc('part_order_allocate', { _line: lineId, _document: documentId, _qty: qty });
  if (error) throw error;
  return data as string;
}

export async function cancelAllocation(allocationId: string): Promise<void> {
  const { error } = await supabase.rpc('part_order_allocation_cancel', { _allocation: allocationId });
  if (error) throw error;
}

export type DocAllocation = {
  id: string; part_order_line_id: string; part_order_id: string; part_order_number: string | null;
  article_id: string | null; reference: string | null; qty: number; created_at: string; created_by_name: string | null;
};
export async function listDocumentAllocations(documentId: string): Promise<DocAllocation[]> {
  const { data, error } = await supabase.rpc('document_allocations', { _document: documentId });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, qty: Number(r.qty) })) as DocAllocation[];
}
