/**
 * M5 — Dépréciation de stock : décote (%) sur la valeur PAMP d'un article pour
 * réduire la charge comptable du vieux stock. N'affecte JAMAIS les quantités
 * (le stock réel reste inchangé) — c'est une provision de valeur, append-only.
 * Table : stock_depreciations (migration 20260726) — hors types Supabase
 * auto-générés, casts localisés (cf. src/modules/tradein/partners-api.ts).
 */
import { supabase } from '@/integrations/supabase/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

export type StockDepreciation = {
  id: string; company_id: string; article_id: string;
  rate: number; reason: string | null;
  base_value: number | null; depreciated_value: number;
  is_active: boolean; created_at: string; created_by: string | null;
};

export async function listDepreciations(companyId: string): Promise<StockDepreciation[]> {
  const { data, error } = await raw
    .from('stock_depreciations').select('*')
    .eq('company_id', companyId).eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as StockDepreciation[]) ?? [];
}

export async function createDepreciation(p: {
  companyId: string; articleId: string; rate: number; reason: string; baseValue: number;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const depreciatedValue = p.baseValue * (p.rate / 100);
  const { error } = await raw.from('stock_depreciations').insert({
    company_id: p.companyId, article_id: p.articleId, rate: p.rate,
    reason: p.reason.trim() || null, base_value: p.baseValue,
    depreciated_value: depreciatedValue, created_by: user?.id ?? null,
  });
  if (error) throw error;
}

/** Append-only : on désactive la dépréciation, on ne la supprime pas (B7). */
export async function cancelDepreciation(id: string): Promise<void> {
  const { error } = await raw.from('stock_depreciations').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

/** Provision totale = somme des décotes actives (à afficher comme charge comptable évitée). */
export async function getTotalDepreciation(companyId: string): Promise<number> {
  const { data, error } = await raw
    .from('stock_depreciations').select('depreciated_value')
    .eq('company_id', companyId).eq('is_active', true);
  if (error) throw error;
  return ((data as { depreciated_value: number }[]) ?? []).reduce((s, r) => s + Number(r.depreciated_value), 0);
}
