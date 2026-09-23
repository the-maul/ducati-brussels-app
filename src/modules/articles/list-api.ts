/**
 * M2 — Liste « Pièces & Accessoires » : UNE page de la liste, filtrée CÔTÉ BASE.
 *
 * Pourquoi une fonction SQL plutôt que la requête PostgREST habituelle :
 * PostgREST plafonne toute réponse à **1 000 lignes** (réglage `max_rows` du
 * projet). L'ancien écran chargeait les 93 000 articles de la société pour
 * croiser le stock dans le navigateur : la réponse était coupée aux
 * 1 000 premières références, dont aucune n'a de mouvement de stock — d'où une
 * liste vide dès qu'on demandait « stock positif ». Le filtre stock, le tri,
 * la pagination, le total exact et la vignette sont donc calculés en base
 * (`article_list_page`, migration 20260923170000).
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingSchema } from './api';
import type { ArticleFilters } from './api';

/** Filtre stock de l'écran : tous / positif / négatif / nul. */
export type StockChoice = 'all' | 'pos' | 'neg' | 'zero';

/** Provenance de la vignette (décision M-27) — sert de texte d'infobulle. */
export type ImageSource = 'ducati_product' | 'shopify' | 'ducati_drawing';

export type ArticleListRow = {
  id: string;
  reference: string;
  designation: string;
  mgmt_type: string;
  bin_location: string | null;
  bin_location2: string | null;
  sale_price_ttc: number | null;
  supplier_availability: string | null;
  to_complete: boolean | null;
  superseded_by_id: string | null;
  replacement_reference: string | null;
  real_qty: number;
  reserved_qty: number;
  available_qty: number;
  link_g8: boolean;
  link_shopify: boolean;
  link_ducati: boolean;
  image_url: string | null;
  image_source: ImageSource | null;
};

export type ArticleListPage = {
  rows: ArticleListRow[];
  /** Nombre d'articles répondant aux critères, sans plafond (compté en base). */
  total: number;
};

/** La fonction SQL n'est pas (encore) en base : l'écran le dit au lieu de mentir. */
export class ArticleListUnavailableError extends Error {
  constructor() { super('article_list_unavailable'); }
}

export type ArticleListQuery = Omit<ArticleFilters, 'limit'> & {
  stock?: StockChoice;
  limit?: number;
  offset?: number;
};

type RawRow = Record<string, unknown> & { total_count?: number | string };

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

/** Une page de la liste des articles (critères + stock appliqués en base). */
export async function listArticlesPage(companyId: string, q: ArticleListQuery): Promise<ArticleListPage> {
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 500);   // < max_rows PostgREST (1000)
  const args = {
    _company: companyId,
    _search: q.search?.trim() || null,
    _supplier: q.supplierId || null,
    _year: q.year ?? null,
    _rayon: q.rayon || null,
    _sous_rayon: q.sousRayon || null,
    _categorie: q.categorie || null,
    _brand: q.brand || null,
    _size: q.size || null,
    _color: q.color || null,
    _pa_locked: q.paLocked ?? null,
    _pv_locked: q.pvLocked ?? null,
    _to_complete: q.toComplete ?? null,
    _links: q.links || null,
    _stock: q.stock ?? 'all',
    _limit: limit,
    _offset: Math.max(q.offset ?? 0, 0),
  };
  // Fonction récente, absente du type généré : appel non typé (cf. links-api.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any).call(supabase, 'article_list_page', args);
  if (error) {
    if (isMissingSchema(error)) throw new ArticleListUnavailableError();
    throw error;
  }
  const raw = (data ?? []) as RawRow[];
  return {
    total: raw.length ? Number(raw[0].total_count ?? 0) : 0,
    rows: raw.map((r) => ({
      id: String(r.id),
      reference: String(r.reference ?? ''),
      designation: String(r.designation ?? ''),
      mgmt_type: String(r.mgmt_type ?? ''),
      bin_location: str(r.bin_location),
      bin_location2: str(r.bin_location2),
      sale_price_ttc: r.sale_price_ttc == null ? null : Number(r.sale_price_ttc),
      supplier_availability: str(r.supplier_availability),
      to_complete: r.to_complete === true,
      superseded_by_id: str(r.superseded_by_id),
      replacement_reference: str(r.replacement_reference),
      real_qty: num(r.real_qty),
      reserved_qty: num(r.reserved_qty),
      available_qty: num(r.available_qty),
      link_g8: r.link_g8 === true,
      link_shopify: r.link_shopify === true,
      link_ducati: r.link_ducati === true,
      image_url: str(r.image_url),
      image_source: (str(r.image_source) as ImageSource | null) ?? null,
    })),
  };
}
