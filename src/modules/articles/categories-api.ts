/**
 * M2 — Familles d'articles (arborescence rayon › sous-rayon › catégorie).
 * Table `article_categories` (parent_id) → hiérarchie ; comptes comptables rattachables.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type ArticleCategory = Database['public']['Tables']['article_categories']['Row'];
export type ArticleCategoryInsert = Database['public']['Tables']['article_categories']['Insert'];

export async function listCategories(companyId: string): Promise<ArticleCategory[]> {
  const { data, error } = await supabase
    .from('article_categories').select('*').eq('company_id', companyId).order('name');
  if (error) throw error;
  return data ?? [];
}

export async function upsertCategory(row: ArticleCategoryInsert): Promise<void> {
  const { error } = await supabase.from('article_categories').upsert(row);
  if (error) throw error;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('article_categories').delete().eq('id', id);
  if (error) throw error;
}

/** Chemin "Rayon › Sous-rayon › Catégorie" d'une catégorie. */
export function categoryPath(c: ArticleCategory, all: ArticleCategory[]): string {
  const parts: string[] = [c.name];
  let cur = c;
  const byId = new Map(all.map((x) => [x.id, x]));
  while (cur.parent_id) {
    const p = byId.get(cur.parent_id);
    if (!p) break;
    parts.unshift(p.name);
    cur = p;
  }
  return parts.join(' › ');
}

/** Profondeur (0 = rayon, 1 = sous-rayon, 2 = catégorie). */
export function depthOf(c: ArticleCategory, all: ArticleCategory[]): number {
  let d = 0, cur = c;
  const byId = new Map(all.map((x) => [x.id, x]));
  while (cur.parent_id) { const p = byId.get(cur.parent_id); if (!p) break; d++; cur = p; }
  return d;
}
