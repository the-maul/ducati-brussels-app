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

export async function listArticles(companyId: string, search?: string): Promise<Article[]> {
  let q = supabase
    .from('articles')
    .select('*')
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
  return data ?? [];
}

export async function getArticle(id: string): Promise<Article | null> {
  const { data, error } = await supabase.from('articles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
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

/** Ajoute un code-barres à un article (ignore les doublons). */
export async function addBarcode(articleId: string, barcode: string): Promise<void> {
  const { error } = await supabase
    .from('article_barcodes')
    .upsert({ article_id: articleId, barcode }, { onConflict: 'article_id,barcode', ignoreDuplicates: true });
  if (error) throw error;
}
