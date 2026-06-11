/**
 * M5 — Stock & inventaire : lecture du triple stock (réel/réservé/disponible),
 * valeur PAMP, historique des mouvements. Tout est une somme de stock_moves (B4/B7).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type StockRow = {
  article_id: string; reference: string; designation: string; mgmt_type: string;
  category_path: string | null; bin_location: string | null; supplier_id: string | null;
  real_qty: number; reserved_qty: number; available_qty: number;
  pamp: number; stock_value: number; stock_min: number;
};
export type StockMove = Database['public']['Tables']['stock_moves']['Row'];

export async function listStock(companyId: string): Promise<StockRow[]> {
  const { data, error } = await supabase.rpc('article_stock_list', { _company: companyId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    article_id: r.article_id, reference: r.reference, designation: r.designation, mgmt_type: r.mgmt_type,
    category_path: r.category_path, bin_location: r.bin_location, supplier_id: r.supplier_id,
    real_qty: Number(r.real_qty), reserved_qty: Number(r.reserved_qty), available_qty: Number(r.available_qty),
    pamp: Number(r.pamp), stock_value: Number(r.stock_value), stock_min: Number(r.stock_min),
  }));
}

export async function listStockHistory(articleId: string): Promise<StockMove[]> {
  const { data, error } = await supabase.rpc('article_stock_history', { _article: articleId });
  if (error) throw error;
  return (data ?? []) as StockMove[];
}

/** Cessions internes (sorties valorisées non facturables) : mouvements type 'cession'. */
export async function listCessions(companyId: string): Promise<StockMove[]> {
  const { data, error } = await supabase
    .from('stock_moves').select('*').eq('company_id', companyId).eq('move_type', 'cession')
    .order('occurred_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

/** Enregistre une cession interne typée (cadeau, démo, fournitures atelier, garantie…). */
export async function recordCession(articleId: string, qty: number, cessionType: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('record_stock_move', {
    _article: articleId, _type: 'cession', _qty: -Math.abs(qty), _unit_cost: null,
    _is_reservation: false, _bin: null, _origin: 'cession', _ref: cessionType, _note: note || cessionType,
  });
  if (error) throw error;
}
