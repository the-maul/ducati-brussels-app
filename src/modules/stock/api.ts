/**
 * M5 (fondation) — Mouvements de stock (append-only) et triple stock.
 * Le stock réel = somme des mouvements. PAMP recalculé côté DB sur les entrées (B5).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type StockMove = Database['public']['Tables']['stock_moves']['Row'];
export type StockMoveType = Database['public']['Enums']['stock_move_type'];
export type TripleStock = { real: number; reserved: number; available: number };

export async function getArticleStock(articleId: string): Promise<TripleStock> {
  const { data, error } = await supabase.rpc('article_stock', { _article: articleId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { real_qty: number; reserved_qty: number; available_qty: number } | undefined;
  return { real: Number(row?.real_qty ?? 0), reserved: Number(row?.reserved_qty ?? 0), available: Number(row?.available_qty ?? 0) };
}

export async function listMoves(articleId: string, limit = 50): Promise<StockMove[]> {
  const { data, error } = await supabase
    .from('stock_moves').select('*').eq('article_id', articleId)
    .order('occurred_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function recordMove(p: {
  article: string; type: StockMoveType; qty: number; unitCost?: number | null;
  isReservation?: boolean; bin?: string | null; origin?: string; ref?: string | null; note?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('record_stock_move', {
    _article: p.article, _type: p.type, _qty: p.qty, _unit_cost: p.unitCost ?? null,
    _is_reservation: p.isReservation ?? false, _bin: p.bin ?? null,
    _origin: p.origin ?? 'screen', _ref: p.ref ?? null, _note: p.note ?? null,
  });
  if (error) throw error;
}

/** Transfert de stock + PAMP de l'ancienne référence vers la nouvelle (remplacement). */
export async function transferStockOnReplace(from: string, to: string): Promise<void> {
  const { error } = await supabase.rpc('transfer_stock_on_replace', { _from: from, _to: to });
  if (error) throw error;
}

/**
 * PAMP (B5) — Prix d'Achat Moyen Pondéré recalculé sur une entrée valorisée.
 * Référence JS de la logique appliquée côté DB (`record_stock_move`). Stock ≤ 0 → repart du PA.
 */
export function computePamp(oldPamp: number, oldQty: number, unitCost: number, qty: number): number {
  if (oldQty <= 0) return Math.round(unitCost * 1000) / 1000;
  return Math.round(((oldPamp * oldQty + unitCost * qty) / (oldQty + qty)) * 1000) / 1000;
}

export const MOVE_TYPE_LABELS: Record<StockMoveType, string> = {
  entree: 'Entrée', sortie: 'Sortie', reservation: 'Réservation', liberation: 'Libération',
  inventaire: 'Inventaire', transfert: 'Transfert', cession: 'Cession', correction: 'Correction',
};
