/**
 * M0 — Améliorations : board de tâches partagé entre admins (client + intégrateur).
 * Tâches (improvements) + points/sous-points (checklist). Documents via la GED.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Improvement = Database['public']['Tables']['improvements']['Row'];
export type ImprovementPoint = Database['public']['Tables']['improvement_points']['Row'];

/** Les 5 statuts, dans l'ordre des colonnes du board. */
export const IMPROVEMENT_STATUSES = ['pending', 'todo', 'in_progress', 'to_validate', 'done'] as const;
export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

export async function listImprovements(companyId: string): Promise<Improvement[]> {
  const { data, error } = await supabase.from('improvements').select('*')
    .eq('company_id', companyId).order('position').order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function createImprovement(p: { companyId: string; title: string; description?: string; status?: ImprovementStatus }): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('improvements').insert({
    company_id: p.companyId, title: p.title, description: p.description || null,
    status: p.status ?? 'pending', created_by: user?.id ?? null,
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export type ImprovementPatch = Partial<Pick<Improvement, 'title' | 'description' | 'status' | 'position'>>;
export async function updateImprovement(id: string, patch: ImprovementPatch): Promise<void> {
  const { error } = await supabase.from('improvements').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteImprovement(id: string): Promise<void> {
  const { error } = await supabase.from('improvements').delete().eq('id', id);
  if (error) throw error;
}

/** Points & sous-points d'une tâche (checklist). */
export async function listPoints(improvementId: string): Promise<ImprovementPoint[]> {
  const { data, error } = await supabase.from('improvement_points').select('*')
    .eq('improvement_id', improvementId).order('position').order('created_at');
  if (error) throw error;
  return data ?? [];
}

/** Tous les points de la société (léger : pour la progression affichée sur les cartes). */
export async function listCompanyPoints(companyId: string): Promise<Pick<ImprovementPoint, 'improvement_id' | 'done'>[]> {
  const { data, error } = await supabase.from('improvement_points').select('improvement_id, done').eq('company_id', companyId);
  if (error) throw error;
  return data ?? [];
}

export async function createPoint(p: { companyId: string; improvementId: string; parentId?: string | null; label: string }): Promise<void> {
  const { error } = await supabase.from('improvement_points').insert({
    company_id: p.companyId, improvement_id: p.improvementId, parent_id: p.parentId ?? null, label: p.label,
  });
  if (error) throw error;
}

export type PointPatch = Partial<Pick<ImprovementPoint, 'label' | 'done' | 'position'>>;
export async function updatePoint(id: string, patch: PointPatch): Promise<void> {
  const { error } = await supabase.from('improvement_points').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deletePoint(id: string): Promise<void> {
  const { error } = await supabase.from('improvement_points').delete().eq('id', id);
  if (error) throw error;
}
