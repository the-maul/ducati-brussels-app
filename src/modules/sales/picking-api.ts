/**
 * M6 — Picking list digitale (Ventes & Facturation, item 11).
 * Tables : picking_lists / picking_list_items (migration 20260726).
 * NB : tables hors types Supabase auto-générés — casts localisés (pattern tradein/partners-api.ts).
 */
import { supabase } from '@/integrations/supabase/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

export type PickingStatus = 'en_cours' | 'pret' | 'livre';
export type PickingItemStatus = 'a_preparer' | 'partiel' | 'pret' | 'a_recevoir';

export type PickingList = {
  id: string;
  company_id: string;
  document_id: string | null;
  location: string | null;
  status: PickingStatus;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

export type PickingItem = {
  id: string;
  company_id: string;
  picking_id: string;
  article_id: string | null;
  designation: string | null;
  reference: string | null;
  qty_ordered: number;
  qty_picked: number;
  status: PickingItemStatus;
  created_at: string;
};

/** Picking list enrichie du n° de document lié, pour l'affichage en liste. */
export type PickingListRow = PickingList & { document_number: string | null; document_type: string | null };

/** Calcule le statut d'une ligne à partir des quantités (règle : 0 → à préparer, < commandé → partiel, ≥ commandé → prêt). */
export function computeItemStatus(qtyOrdered: number, qtyPicked: number): PickingItemStatus {
  if (qtyPicked <= 0) return 'a_preparer';
  if (qtyPicked < qtyOrdered) return 'partiel';
  return 'pret';
}

export async function listPickings(companyId: string): Promise<PickingListRow[]> {
  const { data, error } = await raw
    .from('picking_lists').select('*')
    .eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data as PickingList[]) ?? [];
  const docIds = Array.from(new Set(rows.map((r) => r.document_id).filter((id): id is string => !!id)));
  const docById = new Map<string, { number: string | null; doc_type: string }>();
  if (docIds.length > 0) {
    const { data: docs, error: docErr } = await supabase
      .from('documents').select('id, number, doc_type').in('id', docIds);
    if (docErr) throw docErr;
    for (const d of docs ?? []) docById.set(d.id, { number: d.number, doc_type: d.doc_type });
  }
  return rows.map((r) => ({
    ...r,
    document_number: r.document_id ? (docById.get(r.document_id)?.number ?? null) : null,
    document_type: r.document_id ? (docById.get(r.document_id)?.doc_type ?? null) : null,
  }));
}

export async function getPicking(id: string): Promise<{ picking: PickingList; items: PickingItem[] }> {
  const { data: picking, error } = await raw.from('picking_lists').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: items, error: itemsErr } = await raw
    .from('picking_list_items').select('*').eq('picking_id', id).order('created_at');
  if (itemsErr) throw itemsErr;
  return { picking: picking as PickingList, items: (items as PickingItem[]) ?? [] };
}

/** Crée un picking depuis un document de vente : copie les lignes en items à préparer. */
export async function createPickingFromDocument(companyId: string, documentId: string, location: string | null): Promise<string> {
  const { data: lines, error: linesErr } = await supabase
    .from('document_lines').select('article_id, designation, reference, quantity').eq('document_id', documentId);
  if (linesErr) throw linesErr;

  const { data: picking, error } = await raw
    .from('picking_lists')
    .insert({ company_id: companyId, document_id: documentId, location: location || null })
    .select('id').single();
  if (error) throw error;
  const pickingId = (picking as { id: string }).id;

  const items = (lines ?? []).map((l) => ({
    company_id: companyId, picking_id: pickingId, article_id: l.article_id,
    designation: l.designation, reference: l.reference, qty_ordered: l.quantity, qty_picked: 0,
    status: 'a_preparer' as const,
  }));
  if (items.length > 0) {
    const { error: itemsErr } = await raw.from('picking_list_items').insert(items);
    if (itemsErr) throw itemsErr;
  }
  return pickingId;
}

/** Crée un picking vide, sans document — attribution manuelle des articles ensuite. */
export async function createEmptyPicking(companyId: string, location: string | null): Promise<string> {
  const { data, error } = await raw
    .from('picking_lists')
    .insert({ company_id: companyId, document_id: null, location: location || null })
    .select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function addPickingItem(
  pickingId: string, companyId: string,
  item: { articleId?: string | null; designation: string; reference?: string | null; qtyOrdered: number },
): Promise<void> {
  const { error } = await raw.from('picking_list_items').insert({
    company_id: companyId, picking_id: pickingId, article_id: item.articleId ?? null,
    designation: item.designation.trim(), reference: item.reference?.trim() || null,
    qty_ordered: item.qtyOrdered, qty_picked: 0, status: 'a_preparer',
  });
  if (error) throw error;
}

/** Met à jour la qté préparée d'une ligne et recalcule son statut. */
export async function updatePickedQty(itemId: string, qtyPicked: number): Promise<void> {
  const { data: item, error: readErr } = await raw
    .from('picking_list_items').select('qty_ordered').eq('id', itemId).single();
  if (readErr) throw readErr;
  const status = computeItemStatus(Number((item as { qty_ordered: number }).qty_ordered), qtyPicked);
  const { error } = await raw.from('picking_list_items').update({ qty_picked: qtyPicked, status }).eq('id', itemId);
  if (error) throw error;
}

export async function setPickingLocation(id: string, location: string | null): Promise<void> {
  const { error } = await raw.from('picking_lists').update({ location: location || null }).eq('id', id);
  if (error) throw error;
}

export async function setPickingStatus(id: string, status: PickingStatus): Promise<void> {
  const { error } = await raw.from('picking_lists').update({ status }).eq('id', id);
  if (error) throw error;
}
