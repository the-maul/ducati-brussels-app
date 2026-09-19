/**
 * Mission 03 — Produits Shopify et rapprochement avec les articles du DMS (M2).
 * Lecture seule côté Shopify. Les décisions passent par des fonctions SQL tracées dans events.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type ShopifyOverviewRow = Database['public']['Functions']['shopify_products_overview']['Returns'][number];
export type ShopifySuggestion = Database['public']['Functions']['shopify_link_suggestions']['Returns'][number];
export type ShopifyLinkStatus = 'auto_exact' | 'valide' | 'ignore' | 'a_valider';

export async function listShopifyProducts(companyId: string): Promise<ShopifyOverviewRow[]> {
  // La fonction renvoie toutes les variantes (≈ 3 000) : on lit par tranches de 1 000.
  const out: ShopifyOverviewRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .rpc('shopify_products_overview', { _company: companyId })
      .order('product_title', { ascending: true })
      .order('shopify_variant_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function listShopifySuggestions(companyId: string, variantId: string): Promise<ShopifySuggestion[]> {
  const { data, error } = await supabase.rpc('shopify_link_suggestions', { _company: companyId, _variant: variantId });
  if (error) throw error;
  return data ?? [];
}

export async function linkShopifyVariant(companyId: string, variantId: string, articleId: string): Promise<void> {
  const { error } = await supabase.rpc('shopify_link_variant', { _company: companyId, _variant: variantId, _article: articleId });
  if (error) throw error;
}

/** 'a_valider' = délier (ou ne plus ignorer) ; 'ignore' = écarter ce produit. */
export async function setShopifyDecision(companyId: string, variantId: string, decision: 'a_valider' | 'ignore'): Promise<void> {
  const { error } = await supabase.rpc('shopify_set_variant_decision', { _company: companyId, _variant: variantId, _decision: decision });
  if (error) throw error;
}

export type ShopifySyncResult = {
  ok: boolean;
  done?: boolean;
  next_cursor?: string | null;
  run_started_at?: string;
  auto_linked_new?: number;
  auto_unlinked?: number;
  removed?: number;
  error?: string;
  detail?: string;
};

/** Relit toute la boutique (la fonction serveur rend la main par étapes si la lecture est longue). */
export async function runShopifySync(companyId: string): Promise<ShopifySyncResult> {
  let cursor: string | null = null;
  let runStartedAt: string | undefined;
  for (let step = 0; step < 20; step++) {
    const { data, error } = await supabase.functions.invoke('shopify-sync-products', {
      body: { company_id: companyId, cursor, run_started_at: runStartedAt },
    });
    if (error) throw error;
    const r = data as ShopifySyncResult;
    if (!r?.ok) throw new Error(r?.detail ?? r?.error ?? 'sync_failed');
    if (r.done) return r;
    cursor = r.next_cursor ?? null;
    runStartedAt = r.run_started_at;
  }
  throw new Error('sync_too_long');
}

export type ShopifyCounters = { total: number; auto: number; valide: number; toReview: number; ignored: number; noSku: number };

export function countShopify(rows: ShopifyOverviewRow[]): ShopifyCounters {
  const c: ShopifyCounters = { total: rows.length, auto: 0, valide: 0, toReview: 0, ignored: 0, noSku: 0 };
  for (const r of rows) {
    if (r.link_status === 'auto_exact') c.auto++;
    else if (r.link_status === 'valide') c.valide++;
    else if (r.link_status === 'ignore') c.ignored++;
    else c.toReview++;
    if (!(r.sku ?? '').trim()) c.noSku++;
  }
  return c;
}

// ─── Reprise unique des photos et textes (décision W-4) ────────────────────────────────

export type ShopifyContentImport = Database['public']['Tables']['shopify_content_imports']['Row'];

/** Journal de reprise (une ligne par produit Shopify ↔ article). */
export async function listShopifyContentImports(companyId: string): Promise<ShopifyContentImport[]> {
  const out: ShopifyContentImport[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('shopify_content_imports').select('*')
      .eq('company_id', companyId).order('shopify_product_id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Reprise enregistrée pour un article (texte Shopify noté à côté, date). */
export async function getArticleShopifyImport(companyId: string, articleId: string): Promise<ShopifyContentImport | null> {
  const { data, error } = await supabase.from('shopify_content_imports').select('*')
    .eq('company_id', companyId).eq('article_id', articleId)
    .order('imported_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export type ShopifyContentResult = {
  ok: boolean;
  done?: boolean;
  run_started_at?: string;
  products?: number;
  articles_title_set?: number;
  articles_description_set?: number;
  articles_dms_text_kept?: number;
  images_added?: number;
  images_failed?: number;
  errors?: number;
  error?: string;
  detail?: string;
};

/**
 * Reprend photos et textes Shopify : tous les produits reliés pas encore repris (productId absent)
 * ou un seul produit. La fonction serveur rend la main par étapes : on la rappelle jusqu'au bout
 * et on additionne les compteurs.
 */
export async function runShopifyContentImport(companyId: string, productId?: string): Promise<ShopifyContentResult> {
  let runStartedAt: string | undefined;
  const sum: ShopifyContentResult = {
    ok: true, products: 0, articles_title_set: 0, articles_description_set: 0, articles_dms_text_kept: 0,
    images_added: 0, images_failed: 0, errors: 0,
  };
  const keys = ['products', 'articles_title_set', 'articles_description_set', 'articles_dms_text_kept', 'images_added', 'images_failed', 'errors'] as const;
  for (let step = 0; step < 30; step++) {
    const { data, error } = await supabase.functions.invoke('shopify-import-content', {
      body: { company_id: companyId, product_id: productId, run_started_at: runStartedAt },
    });
    if (error) throw error;
    const r = data as ShopifyContentResult;
    if (!r?.ok) throw new Error(r?.detail ?? r?.error ?? 'import_failed');
    for (const k of keys) sum[k] = (sum[k] ?? 0) + (r[k] ?? 0);
    if (r.done) return { ...sum, done: true };
    runStartedAt = r.run_started_at;
  }
  throw new Error('import_too_long');
}
