/**
 * M5 — Accès aux fonctions du rattrapage G8 (18/11/2026) : inventaire guidé, arrêté
 * réajustable, réajustement / remise à zéro du stock réel, copies de stock, édition
 * multi-critères, étiquetage différé par poste.
 * Fonctions SQL : migrations 20261118210000 / 211000 / 212000 (hors `types.ts` généré :
 * typées localement ici, comme depreciation-api.ts).
 */
import { supabase } from '@/integrations/supabase/client';
import type { ReadjustMode } from './inventory-rules';
import type { EditionView } from './edition-rules';
import type { PendingRow } from './labels-rules';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await raw.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

const n = (v: unknown) => Number(v ?? 0);

/** Plafond PostgREST (1 000 lignes par réponse) et garde-fou des écrans. */
const PAGE = 1000;
const MAX_ROWS = 20000;
export class TooManyRowsError extends Error {
  constructor() { super('too_many_rows'); }
}

// ------------------------------------------------------------------ Inventaire guidé

export async function startInventory(companyId: string, p: { open: boolean; erase: boolean; gaps: boolean; keepVehicles: boolean; label?: string }): Promise<string> {
  return rpc<string>('inventory_start', {
    _company: companyId, _open: p.open, _erase: p.erase, _gaps: p.gaps, _keep_vehicles: p.keepVehicles, _label: p.label ?? null,
  });
}

export type SessionStep = {
  step_no: number; step_code: string; validated: boolean; validated_at: string | null;
  operator_name: string | null; detail: Record<string, unknown>; is_next: boolean;
};
export async function getSessionSteps(sessionId: string): Promise<SessionStep[]> {
  const rows = await rpc<SessionStep[]>('inventory_session_steps', { _session: sessionId });
  return rows ?? [];
}

export async function validateStep(sessionId: string, step: string): Promise<Record<string, unknown>> {
  return rpc('inventory_step_validate', { _session: sessionId, _step: step });
}

export async function rollbackStep(sessionId: string): Promise<string> {
  return rpc<string>('inventory_step_rollback', { _session: sessionId });
}

export type CountRow = {
  article_id: string; reference: string; designation: string; mgmt_type: string;
  bin_location: string | null; bin_location2: string | null;
  real_qty: number; snapshot_qty: number; adjusted_qty: number; counted: boolean; last_count_at: string | null;
  pamp: number; multi_bin: boolean; total_count: number;
};
export type CountScope = 'stock' | 'tous' | 'non_comptes';

/** Liste de comptage (tous les articles stockés, pas seulement les mouvementés), paginée en base. */
export async function listCountRows(companyId: string, p: { snapshotId?: string | null; scope: CountScope; search?: string; bin?: string; limit?: number; offset?: number }): Promise<CountRow[]> {
  const rows = await rpc<any[]>('inventory_count_list', {
    _company: companyId, _snapshot: p.snapshotId ?? null, _scope: p.scope, _search: p.search || null,
    _bin: p.bin || null, _limit: p.limit ?? 200, _offset: p.offset ?? 0,
  });
  return (rows ?? []).map((r) => ({
    ...r, real_qty: n(r.real_qty), snapshot_qty: n(r.snapshot_qty), adjusted_qty: n(r.adjusted_qty),
    pamp: n(r.pamp), total_count: n(r.total_count),
  }));
}

export type AdjustResult = { old: number; new: number; delta: number };

export async function adjustSnapshot(snapshotId: string, articleId: string, counted: number, mode: ReadjustMode, bin?: string | null): Promise<AdjustResult> {
  const r = await rpc<any>('snapshot_adjust', { _snapshot: snapshotId, _article: articleId, _counted: counted, _mode: mode, _bin: bin || null, _note: null });
  return { old: n(r?.old), new: n(r?.new), delta: n(r?.delta) };
}

export async function readjustReal(articleId: string, counted: number, mode: ReadjustMode, bin?: string | null, ref?: string | null): Promise<AdjustResult> {
  const r = await rpc<any>('stock_readjust', { _article: articleId, _counted: counted, _mode: mode, _bin: bin || null, _ref: ref ?? null, _note: null });
  return { old: n(r?.old), new: n(r?.new), delta: n(r?.delta) };
}

export async function resetRealStock(companyId: string, scope: 'tous' | 'negatifs', keepVehicles: boolean, confirm: string): Promise<{ moves: number; ref: string }> {
  const r = await rpc<any>('stock_reset_real', { _company: companyId, _scope: scope, _keep_vehicles: keepVehicles, _confirm: confirm });
  return { moves: n(r?.moves), ref: String(r?.ref ?? '') };
}

export type SessionGap = {
  article_id: string; reference: string; designation: string; bin_location: string | null;
  initial_qty: number; counted_qty: number; gap_qty: number; pamp: number; gap_value: number; counted: boolean;
};
export async function getSessionGaps(sessionId: string): Promise<SessionGap[]> {
  const rows = await rpc<any[]>('inventory_session_gaps', { _session: sessionId });
  return (rows ?? []).map((r) => ({
    ...r, initial_qty: n(r.initial_qty), counted_qty: n(r.counted_qty), gap_qty: n(r.gap_qty), pamp: n(r.pamp), gap_value: n(r.gap_value),
  }));
}

// ------------------------------------------------------------------ Copies et arrêtés

export type SnapshotSummary = {
  id: string; kind: string; label: string | null; status: string; origin: string; created_at: string;
  created_by_name: string | null; session_id: string | null; reintegrated: boolean; reintegrated_at: string | null;
  line_count: number; total_qty: number; total_value: number; adjusted_count: number;
};
export async function listSnapshots(companyId: string, limit = 200): Promise<SnapshotSummary[]> {
  const rows = await rpc<any[]>('stock_snapshot_summaries', { _company: companyId, _limit: limit });
  return (rows ?? []).map((r) => ({ ...r, line_count: n(r.line_count), total_qty: n(r.total_qty), total_value: n(r.total_value), adjusted_count: n(r.adjusted_count) }));
}

/** Copie de stock « hors inventaire » à la date du jour (ou arrêté pour réajustement hors méthode). */
export async function generatePhoto(companyId: string, kind: 'copie' | 'arrete', label?: string): Promise<string> {
  return rpc<string>('generate_stock_snapshot', { _company: companyId, _label: label ?? '', _kind: kind });
}

/** Réintégration d'un arrêté généré hors méthode d'inventaire (une seule fois). */
export async function reintegrateStandalone(snapshotId: string): Promise<number> {
  return n(await rpc<number>('snapshot_reintegrate', { _snapshot: snapshotId }));
}

// ------------------------------------------------------------------ Édition multi-critères

export type EditionRow = {
  article_id: string; reference: string; designation: string; mgmt_type: string; category_path: string | null; brand: string | null;
  supplier_id: string | null; supplier_name: string | null; supplier_ref: string | null;
  bin_location: string | null; bin_location2: string | null; barcode: string | null; serial_no: string | null;
  real_qty: number; reserved_qty: number; on_order_qty: number; available_qty: number; stock_min: number;
  pamp: number; stock_value: number; ref_qty: number; ref_pamp: number; ref_value: number;
  gap_qty: number | null; gap_value: number | null; depreciated_value: number;
  last_in: string | null; last_out: string | null; last_sale: string | null; qty_in: number; qty_out: number;
  is_demo: boolean; is_depot: boolean; counted: boolean; total_count: number; total_value: number;
};
const NUM_KEYS = ['real_qty', 'reserved_qty', 'on_order_qty', 'available_qty', 'stock_min', 'pamp', 'stock_value', 'ref_qty', 'ref_pamp',
  'ref_value', 'depreciated_value', 'qty_in', 'qty_out', 'total_count', 'total_value'] as const;

/** Toute la sélection, page par page (au-delà de 20 000 lignes : erreur lisible). */
export async function listEdition(companyId: string, view: EditionView, f: Record<string, unknown>): Promise<EditionRow[]> {
  const out: EditionRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rpc<any[]>('stock_edition', { _company: companyId, _view: view, _f: f, _limit: PAGE, _offset: offset });
    for (const r of rows ?? []) {
      const row = { ...r } as EditionRow & Record<string, unknown>;
      for (const k of NUM_KEYS) (row as any)[k] = n(r[k]);
      row.gap_qty = r.gap_qty == null ? null : n(r.gap_qty);
      row.gap_value = r.gap_value == null ? null : n(r.gap_value);
      out.push(row);
    }
    if ((rows ?? []).length < PAGE) return out;
    if (out.length >= MAX_ROWS) throw new TooManyRowsError();
  }
}

export async function listBrands(companyId: string): Promise<string[]> {
  const rows = await rpc<{ brand: string }[]>('stock_brands', { _company: companyId });
  return (rows ?? []).map((r) => r.brand);
}

// ------------------------------------------------------------------ Étiquetage

export type LabelSource = 'reference' | 'groupe' | 'reception' | 'modif_article' | 'modif_pv' | 'casier';
export type LabelCandidate = {
  article_id: string; reference: string; designation: string; bin_location: string | null; bin_location2: string | null;
  price_ttc: number | null; price_ht: number | null; price_tarif: number | null; pack_qty: number | null; barcode: string | null;
  real_qty: number; default_qty: number; changed_at: string | null; total_count: number;
};
export async function listLabelCandidates(companyId: string, source: LabelSource, f: Record<string, unknown>, limit = 500): Promise<LabelCandidate[]> {
  const rows = await rpc<any[]>('label_candidates', { _company: companyId, _source: source, _f: f, _limit: limit, _offset: 0 });
  const opt = (v: unknown) => (v == null ? null : Number(v));
  return (rows ?? []).map((r) => ({
    ...r, price_ttc: opt(r.price_ttc), price_ht: opt(r.price_ht), price_tarif: opt(r.price_tarif), pack_qty: opt(r.pack_qty),
    real_qty: n(r.real_qty), default_qty: n(r.default_qty), total_count: n(r.total_count),
  }));
}

export async function enqueueLabels(companyId: string, items: { article_id: string; qty: number }[], o: {
  workstationId: string | null; source: LabelSource | 'reajustement' | 'fiche'; sourceRef?: string | null;
  withBarcode: boolean; withPrice: boolean; withTarif: boolean;
}): Promise<number> {
  return rpc<number>('enqueue_labels', {
    _company: companyId, _items: items, _workstation: o.workstationId, _source: o.source, _source_ref: o.sourceRef ?? null,
    _barcode: o.withBarcode, _price: o.withPrice, _tarif: o.withTarif,
  });
}

export async function listPendingLabels(companyId: string): Promise<PendingRow[]> {
  const rows = await rpc<any[]>('label_queue_pending', { _company: companyId });
  return (rows ?? []).map((r) => ({ ...r, qty: n(r.qty), lines: n(r.lines), ids: (r.ids ?? []).map(Number) }));
}

export async function finishPendingLabels(companyId: string, ids: number[], action: 'imprime' | 'retire'): Promise<number> {
  return rpc<number>('label_queue_done', { _company: companyId, _ids: ids, _action: action });
}

/** Données d'étiquette des articles de la file d'attente (prix, casiers, code-barres). */
export async function loadLabelArticles(ids: string[]): Promise<Map<string, LabelCandidate>> {
  const out = new Map<string, LabelCandidate>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const [{ data: arts, error }, { data: codes, error: e2 }] = await Promise.all([
      supabase.from('articles').select('id, reference, designation, bin_location, bin_location2, sale_price_ttc, sale_price_ht, ppc_ttc, pack_qty').in('id', slice),
      supabase.from('article_barcodes').select('article_id, barcode, is_primary').in('article_id', slice),
    ]);
    if (error) throw error;
    if (e2) throw e2;
    for (const a of arts ?? []) {
      const bc = (codes ?? []).filter((c) => c.article_id === a.id).sort((x, y) => Number(y.is_primary) - Number(x.is_primary))[0];
      out.set(a.id, {
        article_id: a.id, reference: a.reference, designation: a.designation, bin_location: a.bin_location, bin_location2: a.bin_location2,
        price_ttc: a.sale_price_ttc == null ? null : Number(a.sale_price_ttc), price_ht: a.sale_price_ht == null ? null : Number(a.sale_price_ht),
        price_tarif: a.ppc_ttc == null ? null : Number(a.ppc_ttc), pack_qty: a.pack_qty == null ? null : Number(a.pack_qty),
        barcode: bc?.barcode ?? null, real_qty: 0, default_qty: 1, changed_at: null, total_count: 0,
      });
    }
  }
  return out;
}

/** Réceptions récentes (pour « étiquettes à la réception »). */
export async function listRecentReceptions(companyId: string): Promise<{ id: string; number: string | null; receipt_date: string | null; supplier_invoice_no: string | null; status: string }[]> {
  const { data, error } = await supabase.from('purchase_orders')
    .select('id, number, receipt_date, supplier_invoice_no, status')
    .eq('company_id', companyId).eq('doc_type', 'REC').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}
