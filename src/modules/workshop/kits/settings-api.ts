/**
 * Rattrapage G8 (19/11/2026, lot forfaits) — reglages des kits d'entretien : liquide -> article,
 * quantite d'huile par defaut selon la famille moteur (forfaits G8), lignes ajoutees par defaut,
 * rattrapage des kits existants. Toutes les ecritures passent par les fonctions SQL de la
 * migration 20261119140000 (droits, trace events, versions des kits). Non typees dans types.ts
 * tant que la migration n'est pas appliquee : appel non type, types explicites ici.
 */
import { supabase } from '@/integrations/supabase/client';

type LooseResult = { data: unknown; error: { message: string } | null };
const loose = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<LooseResult> };

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await loose.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export type FluidSetting = {
  familyCode: string; familyLabel: string; familyUnit: string | null;
  articleId: string | null; reference: string | null; designation: string | null;
  saleUnit: string | null; litersPerUnit: number | null; wholeUnits: boolean; unlinked: number;
};

export type EngineProfile = {
  id: string; code: string; label: string; priority: number;
  matchPattern: string; excludePattern: string | null; yearFrom: number | null; yearTo: number | null;
  oilArticleId: string | null; oilReference: string | null; oilQuantity: number | null;
  filterArticleId: string | null; filterReference: string | null;
  washerArticleId: string | null; washerReference: string | null;
  g8Forfait: string | null; isActive: boolean;
};

export type DefaultLine = {
  articleId: string; reference: string; designation: string; mgmtType: string;
  quantity: number; sortOrder: number; salePriceTtc: number | null;
};

export type KitSettings = {
  canEdit: boolean;
  fluids: FluidSetting[];
  profiles: EngineProfile[];
  defaults: DefaultLine[];
  kits: number; emptyKits: number; linesWithoutArticle: number;
};

type Row = Record<string, unknown>;

export async function getKitSettings(companyId: string): Promise<KitSettings> {
  const r = await rpc<Row>('maintenance_kit_settings', { _company: companyId });
  const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
  return {
    canEdit: r?.can_edit === true,
    fluids: arr(r?.fluids).map((f) => ({
      familyCode: String(f.family_code), familyLabel: String(f.family_label ?? f.family_code), familyUnit: str(f.family_unit),
      articleId: str(f.article_id), reference: str(f.reference), designation: str(f.designation),
      saleUnit: str(f.sale_unit), litersPerUnit: num(f.liters_per_unit), wholeUnits: f.whole_units === true,
      unlinked: num(f.unlinked) ?? 0,
    })),
    profiles: arr(r?.profiles).map((p) => ({
      id: String(p.id), code: String(p.code), label: String(p.label), priority: num(p.priority) ?? 100,
      matchPattern: String(p.match_pattern ?? ''), excludePattern: str(p.exclude_pattern),
      yearFrom: num(p.year_from), yearTo: num(p.year_to),
      oilArticleId: str(p.oil_article_id), oilReference: str(p.oil_reference), oilQuantity: num(p.oil_quantity),
      filterArticleId: str(p.filter_article_id), filterReference: str(p.filter_reference),
      washerArticleId: str(p.washer_article_id), washerReference: str(p.washer_reference),
      g8Forfait: str(p.g8_forfait), isActive: p.is_active !== false,
    })),
    defaults: arr(r?.defaults).map((d) => ({
      articleId: String(d.article_id), reference: String(d.reference ?? ''), designation: String(d.designation ?? ''),
      mgmtType: String(d.mgmt_type ?? ''), quantity: num(d.quantity) ?? 1, sortOrder: num(d.sort_order) ?? 0,
      salePriceTtc: num(d.sale_price_ttc),
    })),
    kits: num(r?.kits) ?? 0, emptyKits: num(r?.empty_kits) ?? 0, linesWithoutArticle: num(r?.lines_without_article) ?? 0,
  };
}

export async function saveFluidMapping(p: {
  companyId: string; familyCode: string; articleId: string | null;
  saleUnit: string | null; litersPerUnit: number | null; wholeUnits: boolean;
}): Promise<void> {
  await rpc<null>('maintenance_fluid_mapping_save', {
    _company: p.companyId, _family: p.familyCode, _article: p.articleId,
    _sale_unit: p.saleUnit, _liters_per_unit: p.litersPerUnit, _whole_units: p.wholeUnits,
  });
}

export async function saveEngineProfile(companyId: string, p: Omit<EngineProfile,
  'oilReference' | 'filterReference' | 'washerReference' | 'g8Forfait' | 'id'> & { id: string | null }): Promise<string> {
  return rpc<string>('maintenance_engine_profile_save', {
    _company: companyId, _id: p.id, _code: p.code, _label: p.label, _priority: p.priority,
    _match_pattern: p.matchPattern, _exclude_pattern: p.excludePattern, _year_from: p.yearFrom, _year_to: p.yearTo,
    _oil_article: p.oilArticleId, _oil_quantity: p.oilQuantity, _filter_article: p.filterArticleId,
    _washer_article: p.washerArticleId, _is_active: p.isActive,
  });
}

export async function deleteEngineProfile(companyId: string, id: string): Promise<void> {
  await rpc<null>('maintenance_engine_profile_delete', { _company: companyId, _id: id });
}

/** Ajout / quantite d'une ligne par defaut ; `quantity` null = retrait. */
export async function saveDefaultLine(companyId: string, articleId: string, quantity: number | null): Promise<void> {
  await rpc<null>('maintenance_kit_default_line_save', { _company: companyId, _article: articleId, _quantity: quantity, _sort_order: null });
}

export type CompletePreview = { kits: number; emptyKits: number; fluidLines: number; defaultLines: number };
export type CompleteBatch = {
  kits: number; kitsChanged: number; filled: number; fluids: number; defaults: number;
  total: number; nextOffset: number; done: boolean;
};

export async function previewKitsComplete(companyId: string): Promise<CompletePreview> {
  const r = await rpc<Row>('maintenance_kits_complete', { _company: companyId, _apply: false });
  return { kits: num(r?.kits) ?? 0, emptyKits: num(r?.empty_kits) ?? 0, fluidLines: num(r?.fluid_lines) ?? 0, defaultLines: num(r?.default_lines) ?? 0 };
}

/** Lot de kits : ~100 kits sous le delai serveur de 8 s (ecran) ; l'ecran boucle jusqu'a `done`. */
export const KITS_COMPLETE_BATCH = 100;

export async function runKitsComplete(companyId: string, offset: number, limit = KITS_COMPLETE_BATCH): Promise<CompleteBatch> {
  const r = await rpc<Row>('maintenance_kits_complete', { _company: companyId, _apply: true, _limit: limit, _offset: offset });
  return {
    kits: num(r?.kits) ?? 0, kitsChanged: num(r?.kits_changed) ?? 0, filled: num(r?.filled) ?? 0,
    fluids: num(r?.fluids) ?? 0, defaults: num(r?.defaults) ?? 0, total: num(r?.total) ?? 0,
    nextOffset: num(r?.next_offset) ?? offset, done: r?.done === true,
  };
}
