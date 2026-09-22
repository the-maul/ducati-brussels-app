/**
 * « Article DMS = pivot » (décision M-25) — accès base aux liens article ↔ catalogue Ducati / Shopify.
 *
 * Table article_links (migration 20260921200000) : lecture par les membres (liens Shopify : admin +
 * vendeur) ; écriture uniquement par les fonctions SQL (administrateurs), tracée dans events.
 * Tant que la migration n'est pas appliquée, chaque appel lève LinksUnavailableError : l'écran
 * affiche « mise à jour de la base à appliquer » au lieu d'une erreur technique.
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingSchema } from './api';
import type { LinkKind, LinkMethod, LinkStatus } from './links-rules';

// Fonctions récentes, absentes du type généré : appel non typé (lié au client, cf. tests/rpc-bound).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any).call(supabase, fn, args) as Promise<{ data: unknown; error: unknown }>;

export class LinksUnavailableError extends Error {
  constructor() { super('links_unavailable'); }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) {
    if (isMissingSchema(error)) throw new LinksUnavailableError();
    throw error;
  }
  return data as T;
}

export type LinkStats = {
  articles: number; ducati: number; shopify: number; both: number; none: number;
  pending: number; rejected: number; by_method: Record<string, number>;
  shopify_variants: number; shopify_variants_linked: number; ducati_parts: number;
  new?: number; changed?: number; removed?: number; duration_ms?: number;
};

export type ReviewRow = {
  id: string; article_id: string; article_reference: string; article_designation: string;
  article_sale_price_ttc: number | null; target_kind: LinkKind; target_ref: string; target_label: string;
  target_extra: { price_ht?: number | null; replaced?: boolean | null; sku?: string | null; price?: number | null;
    qty?: number | null; status?: string | null; image_url?: string | null } | null;
  status: LinkStatus; method: LinkMethod; score: number; reason: string | null;
  decided_at: string | null; decision_note: string | null; total_count: number;
};

export type DucatiPartInfo = {
  reference: string; description: string | null; price_ht: number | null; price_ttc: number | null;
  price_seen_at: string | null; replaced: boolean | null; has_tempario: boolean | null;
  drawing: { id: string; code: string | null; description: string | null; thumbnail_url: string | null; image_url: string | null } | null;
};
export type DucatiProductInfo = {
  reference: string; description: string | null; kind: string | null; size: string | null; color: string | null;
  price_ht: number | null; price_ttc: number | null; image_url: string | null;
};
export type ShopifyVariantInfo = {
  product_id: string; title: string | null; variant_title: string | null; handle: string | null; status: string | null;
  sku: string | null; barcode: string | null; price: number | null; qty: number | null; image_url: string | null;
  synced_at: string | null; removed: boolean;
};
export type ArticleLink = {
  id: string; target_kind: LinkKind; target_ref: string; status: LinkStatus; method: LinkMethod; score: number;
  reason: string | null; is_auto: boolean; decided_at: string | null; decision_note: string | null;
  info: DucatiPartInfo | DucatiProductInfo | ShopifyVariantInfo | null;
};

export type CreationPreview = {
  ducati_parts_without_article: number; ducati_parts_with_price: number;
  ducati_sample: { reference: string; description: string | null; catalog_price_ht: number | null }[];
  shopify_without_article: number; shopify_by_family: Record<string, number>; shopify_proposed: number;
  shopify_sample: { sku: string; product_title: string | null; variant_title: string | null; price: number | null;
    status: string | null; family: string }[];
};

export type DecideResult = { done: number; skipped: { id: string; reason: string }[] };

export const getLinkStats = (companyId: string) => call<LinkStats>('article_links_counts', { _company: companyId });

export const refreshLinks = (companyId: string) => call<LinkStats>('article_links_refresh', { _company: companyId });

export function listReview(companyId: string, f: {
  kind?: 'ducati' | 'shopify_variant' | null; method?: string | null; q?: string | null;
  status?: LinkStatus; limit?: number; offset?: number;
}): Promise<ReviewRow[]> {
  return call<ReviewRow[]>('article_links_review', {
    _company: companyId, _kind: f.kind ?? null, _method: f.method ?? null, _q: f.q?.trim() || null,
    _status: f.status ?? 'a_valider', _limit: f.limit ?? 50, _offset: f.offset ?? 0,
  }).then((r) => r ?? []);
}

export const decideLinks = (companyId: string, ids: string[], decision: 'lie' | 'rejete', note?: string) =>
  call<DecideResult>('article_links_decide', { _company: companyId, _ids: ids, _decision: decision, _note: note ?? null });

export const listArticleLinks = (companyId: string, articleId: string) =>
  call<ArticleLink[]>('article_links_for_article', { _company: companyId, _article: articleId }).then((r) => r ?? []);

export const linkDucatiReference = (companyId: string, articleId: string, reference: string) =>
  call<string>('article_links_link_ducati', { _company: companyId, _article: articleId, _reference: reference });

export const getCreationPreview = (companyId: string, limit = 30) =>
  call<CreationPreview>('article_links_creation_preview', { _company: companyId, _limit: limit });

// ---- Un seul catalogue (M-25) : articles manquants, produits du site sans article, motos du site ----

export type CreateMissingResult = {
  ducati_parts: number; ducati_products: number; shopify: number; shopify_sans_sku: number;
  shopify_occasion: number; shopify_doublon_sku: number; shopify_sku_deja_article: number;
  motos_non_creees: number; prix: number; mouvements_stock: number; pieces_en_stock: number; duration_ms: number;
};

/** Crée les articles manquants (portée, lot) ou l'article d'UNE variante Shopify (bouton « Créer l'article »). */
export const createMissingArticles = (companyId: string, opts: { scope?: 'all' | 'ducati_parts' | 'ducati_products' | 'shopify'; limit?: number; variant?: string } = {}) =>
  call<CreateMissingResult>('article_links_create_missing', {
    _company: companyId, _scope: opts.scope ?? 'all', _limit: opts.limit ?? null, _variant: opts.variant ?? null,
  });

export type UnlinkedProduct = {
  shopify_variant_id: string; product_title: string | null; variant_title: string | null; sku: string | null;
  price: number | null; qty: number | null; shop_status: string | null; image_url: string | null;
  pending_article_id: string | null; pending_article_reference: string | null; candidates: number; total_count: number;
};

export const listUnlinkedProducts = (companyId: string, limit = 100, offset = 0) =>
  call<UnlinkedProduct[]>('shopify_unlinked_products', { _company: companyId, _limit: limit, _offset: offset }).then((r) => r ?? []);

export type VehicleLinkRow = {
  id: string; shopify_variant_id: string; product_title: string | null; variant_title: string | null; price: number | null;
  shop_status: string | null; image_url: string | null; vehicle_id: string; vin: string | null; model: string | null;
  model_year: number | null; color: string | null; vehicle_status: string | null; status: LinkStatus; method: string;
  score: number; reason: string | null;
};

export const listVehicleLinks = (companyId: string, status: LinkStatus = 'a_valider') =>
  call<VehicleLinkRow[]>('shopify_vehicle_links_review', { _company: companyId, _status: status }).then((r) => r ?? []);

export const decideVehicleLinks = (companyId: string, ids: string[], decision: 'lie' | 'rejete') =>
  call<{ done: number; skipped: number }>('shopify_vehicle_links_decide', { _company: companyId, _ids: ids, _decision: decision });
