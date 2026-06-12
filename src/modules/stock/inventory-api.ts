/**
 * M5 — Inventaire : sessions, arrêté, comptage (3 modes), écarts, réintégration.
 * Toutes les opérations passent par des fonctions DB qui insèrent des mouvements
 * append-only (jamais d'UPDATE du stock).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type InventorySession = Database['public']['Tables']['inventory_sessions']['Row'];
export type ReadjustMode = 'annule_remplace' | 'cumul' | 'casier';

/** Réajustement par CASIER à la volée (B6, 3e mode) : ajuste le stock d'un emplacement. */
export async function recordBinCount(articleId: string, counted: number, bin: string): Promise<void> {
  const { error } = await supabase.rpc('record_inventory_count', { _article: articleId, _counted: counted, _mode: 'casier', _bin: bin });
  if (error) throw error;
}

/** Inventaire tournant : articles à recompter (priorité au plus ancien mouvement). */
export type CycleCandidate = { article_id: string; reference: string; designation: string; bin_location: string | null; real_qty: number; last_move: string | null };
export async function getCycleCandidates(companyId: string, category?: string, limit = 50): Promise<CycleCandidate[]> {
  const { data, error } = await supabase.rpc('cycle_count_candidates', { _company: companyId, _category: category ?? null, _limit: limit });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, real_qty: Number(r.real_qty) }));
}

/** Étiquetage différé cumulable (B12) : ajoute une étiquette à la file du poste. */
export async function enqueueLabel(articleId: string, qty?: number, withBarcode = true, withPrice = true): Promise<void> {
  const { error } = await supabase.rpc('enqueue_label', { _article: articleId, _qty: qty ?? null, _barcode: withBarcode, _price: withPrice });
  if (error) throw error;
}
export type LabelQueueRow = Database['public']['Tables']['label_queue']['Row'];
export async function getLabelQueue(companyId: string): Promise<LabelQueueRow[]> {
  const { data, error } = await supabase.from('label_queue').select('*').eq('company_id', companyId).eq('printed', false).order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function markLabelsPrinted(companyId: string): Promise<void> {
  const { error } = await supabase.from('label_queue').update({ printed: true }).eq('company_id', companyId).eq('printed', false);
  if (error) throw error;
}

export async function getOpenSession(companyId: string): Promise<InventorySession | null> {
  const { data, error } = await supabase
    .from('inventory_sessions').select('*').eq('company_id', companyId).eq('status', 'en_cours')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function createSession(companyId: string, p: { magasin_ouvert: boolean; effacement: boolean; edition_ecarts: boolean; label?: string }): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('inventory_sessions').insert({
    company_id: companyId, magasin_ouvert: p.magasin_ouvert, effacement: p.effacement, edition_ecarts: p.edition_ecarts,
    mode: p.effacement ? 'cumul' : 'annule_remplace', label: p.label ?? null, created_by: user?.id ?? null,
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function closeSession(id: string): Promise<void> {
  const { error } = await supabase.from('inventory_sessions').update({ status: 'cloture', closed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function generateSnapshot(companyId: string, sessionId: string, label: string): Promise<string> {
  const { data, error } = await supabase.rpc('generate_stock_snapshot', { _company: companyId, _label: label, _kind: 'arrete' });
  if (error) throw error;
  const snapId = data as string;
  await supabase.from('inventory_sessions').update({ snapshot_id: snapId }).eq('id', sessionId);
  return snapId;
}

export async function resetRealStock(companyId: string, keepVehicles: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('reset_real_stock', { _company: companyId, _keep_vehicles: keepVehicles });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function recordCount(articleId: string, counted: number, mode: ReadjustMode, bin?: string | null): Promise<void> {
  const { error } = await supabase.rpc('record_inventory_count', { _article: articleId, _counted: counted, _mode: mode, _bin: bin ?? null });
  if (error) throw error;
}

export async function reintegrateSnapshot(snapshotId: string): Promise<number> {
  const { data, error } = await supabase.rpc('reintegrate_snapshot', { _snapshot: snapshotId });
  if (error) throw error;
  return Number(data ?? 0);
}

export type GapRow = { article_id: string; reference: string; designation: string; real_qty: number; snapshot_qty: number; gap_qty: number; gap_value: number };
export async function getGaps(companyId: string, snapshotId: string): Promise<GapRow[]> {
  const { data, error } = await supabase.rpc('inventory_gaps', { _company: companyId, _snapshot: snapshotId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    article_id: r.article_id, reference: r.reference, designation: r.designation,
    real_qty: Number(r.real_qty), snapshot_qty: Number(r.snapshot_qty), gap_qty: Number(r.gap_qty), gap_value: Number(r.gap_value),
  }));
}
