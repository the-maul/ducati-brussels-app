/**
 * M2 — Rattrapage G8 (18/11/2026) : accès données des fonctions G8 de la fiche article,
 * des outils de prix, de la cascade, des remplacements, du suivi des tarifs et des microfiches.
 *
 * Les fonctions et tables viennent des migrations 20261118230000 à 20261118233000 (NON
 * appliquées au moment du lot) : elles ne sont pas dans `types.ts`, d'où le client non typé.
 * Tant que la migration manque, chaque lecture lève `G8SchemaMissingError` : l'écran affiche
 * un bandeau explicite au lieu d'une liste vide (pas de perte silencieuse).
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingSchema } from '../api';
import { normalizeRef } from './microfiche';
import type { FamilyRoundingRule, PriceChange } from './pricing-tools';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = supabase as any;

export class G8SchemaMissingError extends Error {
  constructor() { super('g8-schema-missing'); }
}

type PgErr = { code?: string; message?: string } | null;

function check(error: PgErr): void {
  if (!error) return;
  if (isMissingSchema(error)) throw new G8SchemaMissingError();
  throw error;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await raw.rpc(fn, args);
  check(error);
  return data as T;
}

// ─── Fiche article ───────────────────────────────────────────────────────────

export type EquivalentRow = {
  article_id: string; reference: string; designation: string; supplier_name: string | null; brand: string | null;
  purchase_price: number; sale_price_ht: number | null; sale_price_ttc: number;
  real_qty: number; reserved_qty: number; supplier_order_qty: number; level: number; via_reference: string | null;
};
export const listEquivalents = (articleId: string) =>
  rpc<EquivalentRow[]>('article_equivalents', { _article: articleId }).then((r) => r ?? []);
export const setEquivalence = (a: string, b: string, on: boolean) =>
  rpc<null>('article_equivalence_set', { _a: a, _b: b, _on: on });

export type MoveDetailRow = {
  move_id: number; occurred_at: string; move_type: string; origin: string; ref: string | null; note: string | null;
  is_reservation: boolean; qty_delta: number; unit_cost: number | null;
  real_before: number; real_after: number; frozen_before: number; frozen_delta: number; frozen_after: number;
  operator_name: string | null;
};
export const listMovesDetail = (articleId: string, from: string | null, to: string | null, supplierOnly: boolean) =>
  rpc<MoveDetailRow[]>('article_moves_detail', { _article: articleId, _from: from || null, _to: to || null, _supplier_only: supplierOnly })
    .then((r) => r ?? []);

export const DOCUMENT_KINDS = ['facture', 'livraison', 'reservation', 'reparation', 'proforma', 'commande', 'reception', 'cession', 'proposition'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type ArticleDocumentRow = {
  kind: DocumentKind; doc_id: string | null; doc_type: string; number: string | null; doc_date: string | null; status: string | null;
  third_party: string | null; quantity: number; unit_price_ht: number | null; discount_pct: number | null;
  line_ht: number | null; line_ttc: number | null; margin: number | null; operator_name: string | null; route: string | null;
};
export const listArticleDocuments = (articleId: string, kinds: DocumentKind[], from: string | null, to: string | null, supplierOnly: boolean) =>
  rpc<ArticleDocumentRow[]>('article_documents', {
    _article: articleId, _kinds: kinds.length ? kinds : null, _from: from || null, _to: to || null, _supplier_only: supplierOnly,
  }).then((r) => r ?? []);

export type SupplierOpenOrderRow = {
  supplier_id: string | null; supplier_name: string | null; doc_id: string; doc_type: string; number: string | null;
  doc_date: string | null; status: string; quantity: number; route: string;
};
export const listSupplierOpenOrders = (articleId: string) =>
  rpc<SupplierOpenOrderRow[]>('article_supplier_open_orders', { _article: articleId }).then((r) => r ?? []);

export type LibraryResult = { done: number; refused_stock: number; unchanged: number };
export const setLibrary = (ids: string[], toLibrary: boolean) =>
  rpc<LibraryResult>('article_set_library', { _ids: ids, _to_library: toLibrary });

// ─── Sélection (cascade, outils de prix) ─────────────────────────────────────

export type SelectionFilters = {
  supplier_id?: string; brand?: string; file?: 'article' | 'library' | 'all'; vat_rate?: string;
  rayon?: string; sous_rayon?: string; categorie?: string; year?: string;
  reference?: string; designation?: string; bin?: string; supplier_ref?: string; mgmt_type?: string;
  pv_ppc?: '' | 'below' | 'equal' | 'above' | 'no_ppc';
  stock?: '' | 'pos' | 'neg' | 'zero' | 'nonzero';
  unused_months?: string;
  stock_min?: '' | 'set' | 'unset' | 'below';
  stock_max?: '' | 'set' | 'unset' | 'above';
  eco?: boolean;
  pa_from?: string; pa_to?: string;
  refs?: string[];
  include_inactive?: boolean;
};

/** Retire les filtres vides (le SQL ignore déjà les chaînes vides, on garde la requête lisible). */
export function cleanFilters(f: SelectionFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export type SelectedArticle = {
  id: string; reference: string; designation: string; supplier_id: string | null; supplier_name: string | null; supplier_ref: string | null;
  brand: string | null; category_path: string | null; mgmt_type: string; is_library: boolean; vat_rate: number;
  purchase_price: number; pamp: number; coefficient: number | null; sale_price_ht: number | null; sale_price_ttc: number;
  ppc_ht: number | null; ppc_ttc: number | null; eco_tax_ttc: number;
  descriptif: string | null; show_descriptif_on_documents: boolean; bin_location: string | null;
  color: string | null; size: string | null; pack_qty: number; weight_volume_length: number | null; measure_unit: string | null;
  stock_min: number; stock_max: number; real_qty: number;
  price_purchase_locked: boolean; price_sale_locked: boolean; designation_locked: boolean;
  total: number;
};

export async function selectArticlesPage(companyId: string, f: SelectionFilters, limit = 200, offset = 0): Promise<{ rows: SelectedArticle[]; total: number }> {
  const rows = await rpc<SelectedArticle[]>('article_select_page', { _company: companyId, _f: cleanFilters(f), _limit: limit, _offset: offset }) ?? [];
  return { rows, total: rows.length ? Number(rows[0].total) : 0 };
}

export const selectArticleIds = (companyId: string, f: SelectionFilters) =>
  rpc<string[]>('article_select_ids', { _company: companyId, _f: cleanFilters(f) }).then((r) => r ?? []);

/** Toute la sélection, par pages de 1 000 (aperçu des outils de prix). Plafond 20 000. */
export async function selectAllArticles(companyId: string, f: SelectionFilters, onProgress?: (n: number, total: number) => void): Promise<SelectedArticle[]> {
  const out: SelectedArticle[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { rows, total } = await selectArticlesPage(companyId, f, 1000, offset);
    out.push(...rows);
    onProgress?.(out.length, total);
    if (rows.length < 1000 || out.length >= total) break;
  }
  return out;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type BatchProgress = (done: number, total: number) => void;

/** Écrit des prix par lots de 500 (8 s par appel, PostgREST). Trace : price_changes. */
export async function applyPriceChanges(companyId: string, changes: PriceChange[], origin: string, onProgress?: BatchProgress) {
  let done = 0, locked = 0, missing = 0, n = 0;
  for (const part of chunks(changes, 500)) {
    const r = await rpc<{ done: number; locked: number; missing: number }>('article_price_batch', { _company: companyId, _rows: part, _origin: origin });
    done += r?.done ?? 0; locked += r?.locked ?? 0; missing += r?.missing ?? 0;
    n += part.length;
    onProgress?.(n, changes.length);
  }
  return { done, locked, missing };
}

export async function applyCascade(companyId: string, ids: string[], action: string, value: Record<string, unknown>, onProgress?: BatchProgress) {
  let done = 0, skipped = 0, n = 0;
  for (const part of chunks(ids, 500)) {
    const r = await rpc<{ done: number; skipped: number }>('article_cascade_apply', { _company: companyId, _ids: part, _action: action, _value: value });
    done += r?.done ?? 0; skipped += r?.skipped ?? 0;
    n += part.length;
    onProgress?.(n, ids.length);
  }
  return { done, skipped };
}

export async function applyLibraryBatch(ids: string[], toLibrary: boolean, onProgress?: BatchProgress) {
  let done = 0, refused = 0, unchanged = 0, n = 0;
  for (const part of chunks(ids, 1000)) {
    const r = await setLibrary(part, toLibrary);
    done += r?.done ?? 0; refused += r?.refused_stock ?? 0; unchanged += r?.unchanged ?? 0;
    n += part.length;
    onProgress?.(n, ids.length);
  }
  return { done, refused, unchanged };
}

export async function deleteArticlesBatch(companyId: string, ids: string[], onProgress?: BatchProgress) {
  let deleted = 0, deactivated = 0, n = 0;
  for (const part of chunks(ids, 500)) {
    const r = await rpc<{ deleted: number; deactivated: number }>('article_delete_batch', { _company: companyId, _ids: part });
    deleted += r?.deleted ?? 0; deactivated += r?.deactivated ?? 0;
    n += part.length;
    onProgress?.(n, ids.length);
  }
  return { deleted, deactivated };
}

// ─── Arrondis par famille ────────────────────────────────────────────────────

export type RoundingRuleRow = FamilyRoundingRule & { id: string; company_id: string };

export async function listFamilyRounding(companyId: string): Promise<RoundingRuleRow[]> {
  const { data, error } = await raw.from('price_rounding_rules').select('*').eq('company_id', companyId)
    .order('supplier_id', { ascending: true, nullsFirst: true }).order('category_prefix', { ascending: true, nullsFirst: true })
    .order('up_to', { ascending: true });
  check(error);
  return ((data ?? []) as RoundingRuleRow[]).map((r) => ({ ...r, up_to: Number(r.up_to), step: Number(r.step) }));
}

/** Variante tolérante pour la fiche article : sans migration, aucune règle (l'arrondi société reste). */
export async function listFamilyRoundingSafe(companyId: string): Promise<RoundingRuleRow[]> {
  try { return await listFamilyRounding(companyId); } catch (e) { if (e instanceof G8SchemaMissingError) return []; throw e; }
}

export async function addFamilyRounding(companyId: string, r: FamilyRoundingRule): Promise<void> {
  const { error } = await raw.from('price_rounding_rules').insert({
    company_id: companyId, supplier_id: r.supplier_id, category_prefix: r.category_prefix,
    up_to: r.up_to, step: r.step, mode: r.mode, sort_order: r.sort_order ?? 0, is_active: r.is_active ?? true,
  });
  check(error);
}
export async function updateFamilyRounding(id: string, patch: Partial<FamilyRoundingRule>): Promise<void> {
  const { error } = await raw.from('price_rounding_rules').update(patch).eq('id', id);
  check(error);
}
export async function deleteFamilyRounding(id: string): Promise<void> {
  const { error } = await raw.from('price_rounding_rules').delete().eq('id', id);
  check(error);
}

// ─── Remplacements ───────────────────────────────────────────────────────────

export type ReplacementFilters = {
  src_supplier_id?: string; src_rayon?: string; src_sous_rayon?: string; src_categorie?: string; src_reference?: string; src_designation?: string;
  tgt_supplier_id?: string; tgt_rayon?: string; tgt_sous_rayon?: string; tgt_categorie?: string; tgt_reference?: string; tgt_designation?: string;
  date_from?: string; state?: '' | 'liaison' | 'redirection';
};
export type ReplacementRow = {
  source_id: string; source_reference: string; source_designation: string; source_supplier: string | null;
  source_real_qty: number; source_active: boolean; state: 'liaison' | 'redirection'; replaced_at: string | null;
  target_id: string; target_reference: string; target_designation: string; target_supplier: string | null;
  total: number;
};
export async function listReplacements(companyId: string, f: ReplacementFilters, limit = 200, offset = 0) {
  const rows = await rpc<ReplacementRow[]>('article_replacements_list', {
    _company: companyId, _f: cleanFilters(f as SelectionFilters), _limit: limit, _offset: offset,
  }) ?? [];
  return { rows, total: rows.length ? Number(rows[0].total) : 0 };
}
export type ReplacementAction = 'unlink' | 'delete_source' | 'merge' | 'set_link' | 'set_redirect';
export const replacementAction = (sourceId: string, action: ReplacementAction) =>
  rpc<{ result: string }>('article_replacement_action', { _source: sourceId, _action: action });

/** État du remplacement d'un article (colonne de 20261118230000 ; absente → redirection, comportement d'avant). */
export async function getReplacementMode(articleId: string): Promise<'liaison' | 'redirection'> {
  const { data, error } = await raw.from('articles').select('replacement_mode').eq('id', articleId).maybeSingle();
  if (error) return 'redirection';
  return data?.replacement_mode === 'liaison' ? 'liaison' : 'redirection';
}

// ─── Suivi des tarifs fournisseurs ───────────────────────────────────────────

export type TariffStatus = 'en_attente' | 'installe' | 'abandonne';
export type SupplierTariff = {
  id: string; company_id: string; supplier_id: string | null; supplier_name: string; label: string | null; file_name: string | null;
  tariff_date: string | null; status: TariffStatus; rows_count: number | null; created_count: number | null; updated_count: number | null;
  anomalies_count: number | null; installed_at: string | null; installed_by: string | null; notes: string | null; created_at: string;
};
export async function listSupplierTariffs(companyId: string): Promise<SupplierTariff[]> {
  const { data, error } = await raw.from('supplier_tariffs').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(200);
  check(error);
  return (data ?? []) as SupplierTariff[];
}
export async function createSupplierTariff(companyId: string, t: Partial<SupplierTariff> & { supplier_name: string }): Promise<string> {
  const { data, error } = await raw.from('supplier_tariffs').insert({ company_id: companyId, ...t }).select('id').single();
  check(error);
  return data.id as string;
}
export async function updateSupplierTariff(id: string, patch: Partial<SupplierTariff>): Promise<void> {
  const { error } = await raw.from('supplier_tariffs').update(patch).eq('id', id);
  check(error);
}

/** Format « perso » : champ de l'article → NOM de l'en-tête du fichier (rejoué au fichier suivant). */
export type TariffFormat = { id: string; supplier_name: string; mapping: Record<string, string>; vat_rate: number | null };
export async function getTariffFormat(companyId: string, supplierName: string): Promise<TariffFormat | null> {
  const { data, error } = await raw.from('supplier_tariff_formats').select('id, supplier_name, mapping, vat_rate')
    .eq('company_id', companyId).ilike('supplier_name', supplierName.trim()).limit(1);
  check(error);
  return ((data ?? [])[0] as TariffFormat | undefined) ?? null;
}
export async function saveTariffFormat(companyId: string, supplierName: string, mapping: Record<string, string>): Promise<void> {
  const existing = await getTariffFormat(companyId, supplierName);
  if (existing) {
    const { error } = await raw.from('supplier_tariff_formats').update({ mapping }).eq('id', existing.id);
    check(error);
  } else {
    const { error } = await raw.from('supplier_tariff_formats').insert({ company_id: companyId, supplier_name: supplierName.trim(), mapping });
    check(error);
  }
}

// ─── Microfiches : références → articles ─────────────────────────────────────

export type ResolvedArticle = {
  id: string; reference: string; designation: string; sale_price_ht: number | null; sale_price_ttc: number;
  vat_rate: number; purchase_price: number; mgmt_type: string; bin_location: string | null; supplier_ref: string | null;
};

const RESOLVE_COLS = 'id, reference, designation, sale_price_ht, sale_price_ttc, vat_rate, purchase_price, mgmt_type, bin_location, supplier_ref';

/**
 * Retrouve les articles d'une liste de références : référence exacte (casse ignorée par
 * normalisation), puis code-barres. Une référence inconnue est rendue à part (jamais créée
 * en silence). Par lots de 200 (taille d'URL PostgREST).
 */
export async function resolveReferences(companyId: string, refs: string[]): Promise<Map<string, ResolvedArticle>> {
  const out = new Map<string, ResolvedArticle>();
  const wanted = Array.from(new Set(refs.map((r) => r.trim()).filter(Boolean)));
  const variants = (r: string) => Array.from(new Set([r, r.toUpperCase(), r.toLowerCase()]));
  for (const part of chunks(wanted, 200)) {
    const { data, error } = await raw.from('articles').select(RESOLVE_COLS)
      .eq('company_id', companyId).in('reference', part.flatMap(variants));
    if (error) throw error;
    for (const a of (data ?? []) as ResolvedArticle[]) {
      const k = normalizeRef(a.reference);
      if (!out.has(k)) out.set(k, a);
    }
  }
  const missing = wanted.filter((r) => !out.has(normalizeRef(r)));
  for (const part of chunks(missing, 200)) {
    const { data, error } = await raw.from('article_barcodes').select(`barcode, articles!inner(${RESOLVE_COLS}, company_id)`)
      .in('barcode', part.flatMap(variants)).eq('articles.company_id', companyId);
    if (error) break;
    for (const b of (data ?? []) as unknown as { barcode: string; articles: ResolvedArticle }[]) {
      const k = normalizeRef(b.barcode);
      if (!out.has(k) && b.articles) out.set(k, b.articles);
    }
  }
  return out;
}

// ─── Fiche : drapeaux caisse / pied de document ──────────────────────────────

export type ArticleSaleFlags = { sale_blocked_pos: boolean; no_footer_discount: boolean };

/**
 * « Vente bloquée en caisse » et « Hors remise pied de page » d'une liste d'articles.
 * Colonnes de 20261118230000 : absentes → aucun drapeau (comportement d'avant le lot).
 */
export async function getArticleSaleFlags(ids: string[]): Promise<Map<string, ArticleSaleFlags>> {
  const out = new Map<string, ArticleSaleFlags>();
  const list = Array.from(new Set(ids.filter(Boolean)));
  for (const part of chunks(list, 200)) {
    const { data, error } = await raw.from('articles').select('id, sale_blocked_pos, no_footer_discount').in('id', part);
    if (error) return out;
    for (const a of (data ?? []) as { id: string; sale_blocked_pos: boolean | null; no_footer_discount: boolean | null }[]) {
      out.set(a.id, { sale_blocked_pos: !!a.sale_blocked_pos, no_footer_discount: !!a.no_footer_discount });
    }
  }
  return out;
}
