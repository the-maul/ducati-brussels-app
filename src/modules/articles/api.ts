/**
 * M2 — Accès données Articles (RLS : filtré par société).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Article = Database['public']['Tables']['articles']['Row'];
export type ArticleInsert = Database['public']['Tables']['articles']['Insert'];
export type ArticleUpdate = Database['public']['Tables']['articles']['Update'];
export type ArticleMgmtType = Database['public']['Enums']['article_mgmt_type'];
export type KitBillingMode = Database['public']['Enums']['kit_billing_mode'];

/** Libellés des types de gestion (B1). */
export const MGMT_TYPES: { value: ArticleMgmtType; label: string }[] = [
  { value: 'A', label: 'A — Pièce stockée' },
  { value: 'M', label: 'M — Non stockée' },
  { value: 'F', label: 'F — Texte' },
  { value: 'N', label: 'N — Composant forfait' },
  { value: 'V', label: 'V — Véhicule neuf' },
  { value: 'O', label: 'O — Occasion particulier (TVA marge)' },
  { value: 'P', label: 'P — Occasion pro' },
  { value: 'D', label: 'D — Dépôt-vente' },
  { value: 'R', label: 'R — Référence de reprise' },
  { value: 'T', label: "T — Main d'œuvre" },
];

function sanitize(term: string): string {
  return term.replace(/[,()%*]/g, ' ').trim();
}

/** Article + réf. de remplacement embarquée (self-join sur superseded_by_id). */
export type ArticleWithReplacement = Article & { replacement?: { id: string; reference: string } | null };

export async function listArticles(companyId: string, search?: string): Promise<ArticleWithReplacement[]> {
  let q = supabase
    .from('articles')
    .select('*, replacement:superseded_by_id(id, reference)')
    .eq('company_id', companyId)
    .order('designation', { ascending: true })
    .limit(500);

  const s = search ? sanitize(search) : '';
  if (s) {
    q = q.or(
      [`reference.ilike.%${s}%`, `designation.ilike.%${s}%`, `brand.ilike.%${s}%`, `supplier_ref.ilike.%${s}%`].join(','),
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ArticleWithReplacement[];
}

export async function getArticle(id: string): Promise<Article | null> {
  const { data, error } = await supabase.from('articles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Colonnes minimales pour le diff d'import (voir import/rules.ts ExistingArticle). */
export type ArticleLite = Pick<Article,
  'id' | 'reference' | 'designation' | 'brand' | 'category_path' | 'supplier_ref' |
  'purchase_price' | 'sale_price_ttc' | 'coefficient' | 'superseded_by_id' | 'is_library' |
  'ppc_ht' | 'ppc_ttc'>;

/**
 * Référentiel COMPLET (paginé par 1000) pour l'import de tarifs — listArticles
 * est plafonné à 500 et ne convient pas au croisement d'un gros fichier.
 */
export async function listAllArticlesLite(companyId: string): Promise<ArticleLite[]> {
  const PAGE = 1000;
  const out: ArticleLite[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, reference, designation, brand, category_path, supplier_ref, purchase_price, sale_price_ttc, coefficient, superseded_by_id, is_library, ppc_ht, ppc_ttc')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function createArticle(input: ArticleInsert): Promise<Article> {
  const { data, error } = await supabase.from('articles').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateArticle(id: string, input: ArticleUpdate): Promise<Article> {
  const { data, error } = await supabase.from('articles').update(input).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/**
 * Modifie les prix d'un article en TRAÇANT l'origine (price_changes append-only, B7).
 * À utiliser pour toute modification de prix (cascade, fiche, import) au lieu d'un
 * UPDATE direct. N'écrit que les champs fournis.
 */
export async function recordPriceChange(
  articleId: string,
  p: { purchase?: number; saleHt?: number; saleTtc?: number; coef?: number; origin?: string },
): Promise<void> {
  const { error } = await supabase.rpc('record_price_change', {
    _article: articleId, _purchase: p.purchase ?? null, _sale_ht: p.saleHt ?? null,
    _sale_ttc: p.saleTtc ?? null, _coef: p.coef ?? null, _origin: p.origin ?? 'screen',
  });
  if (error) throw error;
}

export type PriceChange = Database['public']['Tables']['price_changes']['Row'];
/** Historique des changements de prix d'un article (le plus récent d'abord). */
export async function listPriceChanges(articleId: string): Promise<PriceChange[]> {
  const { data, error } = await supabase
    .from('price_changes').select('*').eq('article_id', articleId)
    .order('occurred_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

/** Ajoute un code-barres à un article (ignore les doublons). */
export async function addBarcode(articleId: string, barcode: string): Promise<void> {
  const { error } = await supabase
    .from('article_barcodes')
    .upsert({ article_id: articleId, barcode }, { onConflict: 'article_id,barcode', ignoreDuplicates: true });
  if (error) throw error;
}
