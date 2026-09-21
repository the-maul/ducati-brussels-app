/**
 * Catalogue Ducati (mission 06, cartes 2 et 3) — accès base.
 *
 * Lecture : tables ducati_catalog_* (RLS : comptes de l'équipe).
 * Écriture : uniquement les fonctions d'import, appelées par le pont avec l'extension
 * (bridge.ts) sous la session DMS de l'utilisateur (administrateur de la société active).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export type CatalogStats = {
  families: number; models: number; modelsEurope: number; modelYears: number;
  modelYearsLoaded: number; modelYearsComplete: number; drawings: number; drawingsWithParts: number;
  lines: number; parts: number;
};

export type CatalogBatch = {
  id: string; status: string; started_at: string; updated_at: string; finished_at: string | null;
  started_by: string | null; model_years_total: number; model_years_done: number;
  drawings_imported: number; drawings_skipped: number; lines_imported: number; requests_count: number;
  last_error: string | null;
};

export type CatalogFamily = { id: string; description: string; sort: number | null };
export type CatalogModel = {
  id: string; description: string; market: string; is_europe: boolean; supermodel_id: string; family_id: string;
  sort: number | null; supermodel: { description: string; sort: number | null } | null;
};
export type CatalogModelYear = {
  id: string; model_id: string; code: string | null; year: number | null;
  groups_loaded_at: string | null; drawings_count: number | null; complete_at: string | null;
};
export type CatalogDrawingRef = {
  drawing_id: string; group_id: string; group_sort: number | null; sort: number | null;
  group: { code: string | null; description: string | null } | null;
  drawing: { code: string | null; description: string | null; thumbnail_url: string | null; parts_loaded_at: string | null } | null;
};
export type Hotspot = { pos: string; x1: number; y1: number; x2: number; y2: number };
export type CatalogDrawing = {
  id: string; code: string | null; description: string | null; image_url: string | null;
  original_image_url: string | null; thumbnail_url: string | null; hotspots: Hotspot[]; parts_loaded_at: string | null;
};
export type CatalogLine = {
  line_no: number; position: string | null; reference: string | null; reference_norm: string | null;
  description: string | null; quantity: number | null; notes: string | null; part_notes: string | null;
  replaced: boolean | null; replaced_part: string | null; start_date: string | null; end_date: string | null;
  has_tempario: boolean | null; catalog_price_ht: number | null; catalog_price_ttc: number | null;
  price_seen_at: string | null; article_id: string | null; article_reference: string | null;
  article_designation: string | null; article_sale_price_ht: number | null; article_mgmt_type: string | null;
  article_is_library: boolean | null; real_qty: number | null; reserved_qty: number | null; on_order_qty: number | null;
};

export async function getCatalogStats(): Promise<CatalogStats> {
  const { data, error } = await supabase.rpc('ducati_catalog_stats');
  if (error) throw error;
  return data as unknown as CatalogStats;
}

export async function listCatalogBatches(limit = 10): Promise<CatalogBatch[]> {
  const { data, error } = await supabase.from('ducati_catalog_import_batches')
    .select('id, status, started_at, updated_at, finished_at, started_by, model_years_total, model_years_done, drawings_imported, drawings_skipped, lines_imported, requests_count, last_error')
    .order('started_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as CatalogBatch[];
}

export async function listCatalogFamilies(): Promise<CatalogFamily[]> {
  const { data, error } = await supabase.from('ducati_catalog_families').select('id, description, sort').order('sort');
  if (error) throw error;
  return data ?? [];
}

/** Modèles d'une famille (Europe seulement par défaut, décision M-15). */
export async function listCatalogModels(familyId: string, europeOnly = true): Promise<CatalogModel[]> {
  let q = supabase.from('ducati_catalog_models')
    .select('id, description, market, is_europe, supermodel_id, family_id, sort, supermodel:ducati_catalog_supermodels(description, sort)')
    .eq('family_id', familyId);
  if (europeOnly) q = q.eq('is_europe', true);
  const { data, error } = await q.order('description');
  if (error) throw error;
  return (data ?? []) as unknown as CatalogModel[];
}

export async function listCatalogModelYears(modelId: string): Promise<CatalogModelYear[]> {
  const { data, error } = await supabase.from('ducati_catalog_model_years')
    .select('id, model_id, code, year, groups_loaded_at, drawings_count, complete_at')
    .eq('model_id', modelId).order('year', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listModelYearDrawings(modelYearId: string): Promise<CatalogDrawingRef[]> {
  const { data, error } = await supabase.from('ducati_catalog_model_year_drawings')
    .select('drawing_id, group_id, group_sort, sort, group:ducati_catalog_groups(code, description), drawing:ducati_catalog_drawings(code, description, thumbnail_url, parts_loaded_at)')
    .eq('model_year_id', modelYearId)
    .order('group_sort').order('sort');
  if (error) throw error;
  return (data ?? []) as unknown as CatalogDrawingRef[];
}

export async function getCatalogDrawing(drawingId: string): Promise<CatalogDrawing | null> {
  const { data, error } = await supabase.from('ducati_catalog_drawings')
    .select('id, code, description, image_url, original_image_url, thumbnail_url, hotspots, parts_loaded_at')
    .eq('id', drawingId).maybeSingle();
  if (error) throw error;
  return (data as unknown as CatalogDrawing) ?? null;
}

/** Lignes d'une planche + article du DMS correspondant (société active) et son stock. */
export async function listDrawingLines(companyId: string, drawingId: string): Promise<CatalogLine[]> {
  const { data, error } = await supabase.rpc('ducati_catalog_drawing_lines', { _company: companyId, _drawing_id: drawingId });
  if (error) throw error;
  return (data ?? []) as unknown as CatalogLine[];
}

// ------------------------------------------------------------------------------------------
// Écriture — appelée uniquement par le pont avec l'extension (bridge.ts)
// ------------------------------------------------------------------------------------------
export async function catalogImportState(): Promise<Json> {
  const { data, error } = await supabase.rpc('ducati_catalog_import_state');
  if (error) throw error;
  return data;
}

export async function catalogBatchStart(companyId: string, scope: Json, modelYearsTotal: number): Promise<string> {
  const { data, error } = await supabase.rpc('ducati_catalog_batch_start', { _company: companyId, _scope: scope, _model_years_total: modelYearsTotal });
  if (error) throw error;
  return data;
}

export async function catalogBatchProgress(batchId: string, status: string, position: Json | null, counters: Json | null, err: string | null): Promise<void> {
  const { error } = await supabase.rpc('ducati_catalog_batch_progress', {
    _batch: batchId, _status: status,
    ...(position != null ? { _position: position } : {}),
    ...(counters != null ? { _counters: counters } : {}),
    ...(err ? { _error: err } : {}),
  });
  if (error) throw error;
}

export async function catalogIngestTree(batchId: string, tree: Json): Promise<Json> {
  const { data, error } = await supabase.rpc('ducati_catalog_ingest_tree', { _batch: batchId, _tree: tree });
  if (error) throw error;
  return data;
}

export async function catalogIngestModelYear(batchId: string, modelYearId: string, groups: Json): Promise<Json> {
  const { data, error } = await supabase.rpc('ducati_catalog_ingest_model_year', { _batch: batchId, _model_year_id: modelYearId, _groups: groups });
  if (error) throw error;
  return data;
}

export async function catalogIngestDrawings(batchId: string, modelYearId: string, drawings: Json, complete: boolean): Promise<Json> {
  const { data, error } = await supabase.rpc('ducati_catalog_ingest_drawings', { _batch: batchId, _model_year_id: modelYearId, _drawings: drawings, _complete: complete });
  if (error) throw error;
  return data;
}
