/**
 * M2 — Sous-objets de la fiche article : codes-barres, composants de kit, remplacement.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Barcode = Database['public']['Tables']['article_barcodes']['Row'];
export type KitItem = Database['public']['Tables']['article_kit_items']['Row'];

export async function listBarcodes(articleId: string): Promise<Barcode[]> {
  const { data, error } = await supabase.from('article_barcodes').select('*').eq('article_id', articleId).order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function addBarcodeRow(articleId: string, barcode: string, isPrimary = false): Promise<void> {
  const { error } = await supabase.from('article_barcodes').insert({ article_id: articleId, barcode, is_primary: isPrimary });
  if (error) throw error;
}
export async function deleteBarcode(id: string): Promise<void> {
  const { error } = await supabase.from('article_barcodes').delete().eq('id', id);
  if (error) throw error;
}

export type KitItemView = KitItem & { component?: { reference: string; designation: string } | null };
export async function listKitItems(kitId: string): Promise<KitItemView[]> {
  const { data, error } = await supabase
    .from('article_kit_items').select('*, component:component_id(reference, designation)').eq('kit_id', kitId);
  if (error) throw error;
  return (data ?? []) as unknown as KitItemView[];
}
export async function addKitItem(kitId: string, componentId: string, quantity: number): Promise<void> {
  const { error } = await supabase.from('article_kit_items').insert({ kit_id: kitId, component_id: componentId, quantity });
  if (error) throw error;
}
export async function deleteKitItem(id: string): Promise<void> {
  const { error } = await supabase.from('article_kit_items').delete().eq('id', id);
  if (error) throw error;
}

/** Définit l'article qui remplace celui-ci (référence remplacée → superseded_by). */
export async function setReplacement(articleId: string, replacementId: string | null): Promise<void> {
  const { error } = await supabase.from('articles').update({ superseded_by_id: replacementId }).eq('id', articleId);
  if (error) throw error;
}

/** Recherche légère d'articles (pour les sélecteurs). */
export async function searchArticlesLite(companyId: string, term: string): Promise<{ id: string; reference: string; designation: string }[]> {
  const s = term.replace(/[,()%*]/g, ' ').trim();
  let q = supabase.from('articles').select('id, reference, designation').eq('company_id', companyId).limit(8);
  if (s) q = q.or(`reference.ilike.%${s}%,designation.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
