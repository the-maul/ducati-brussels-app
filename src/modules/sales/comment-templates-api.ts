/**
 * M6 — Commentaires types (mission 05, carte 5) : textes enregistrés par société (nom court +
 * texte), gérés dans Paramètres → Commentaires types, rappelés dans un document de vente
 * en ligne texte puis modifiables. Table `document_comment_templates` (RLS société, audit events).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type CommentTemplate = Database['public']['Tables']['document_comment_templates']['Row'];
export type CommentTemplateInput = { name: string; body: string; is_active: boolean; sort_order: number };

export async function listCommentTemplates(companyId: string, activeOnly = false): Promise<CommentTemplate[]> {
  let q = supabase.from('document_comment_templates').select('*').eq('company_id', companyId)
    .order('sort_order').order('name');
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createCommentTemplate(companyId: string, p: CommentTemplateInput): Promise<void> {
  const { error } = await supabase.from('document_comment_templates').insert({
    company_id: companyId, name: p.name.trim(), body: p.body, is_active: p.is_active, sort_order: p.sort_order,
  });
  if (error) throw error;
}

export async function updateCommentTemplate(id: string, p: CommentTemplateInput): Promise<void> {
  const { error } = await supabase.from('document_comment_templates').update({
    name: p.name.trim(), body: p.body, is_active: p.is_active, sort_order: p.sort_order,
  }).eq('id', id);
  if (error) throw error;
}

/** Suppression (administrateur uniquement, RLS) ; les autres rôles désactivent. */
export async function deleteCommentTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('document_comment_templates').delete().eq('id', id);
  if (error) throw error;
}
