/**
 * M0 — Configuration des séquences documentaires (numérotation).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type DocSequence = Database['public']['Tables']['document_sequences']['Row'];

export async function listSequences(companyId: string): Promise<DocSequence[]> {
  const { data, error } = await supabase
    .from('document_sequences')
    .select('*')
    .eq('company_id', companyId)
    .order('doc_type', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateSequence(
  id: string,
  patch: Partial<Pick<DocSequence, 'prefix' | 'separator' | 'padding' | 'reset_yearly' | 'suffix' | 'label'>>,
): Promise<void> {
  const { error } = await supabase.from('document_sequences').update(patch).eq('id', id);
  if (error) throw error;
}

/** Aperçu en direct du prochain numéro (même logique que next_document_number()). */
export function previewNumber(s: {
  prefix: string; separator: string; padding: number; reset_yearly: boolean;
  next_value: number; current_year: number | null; suffix: string | null;
}): string {
  const year = new Date().getFullYear();
  const n = s.reset_yearly && s.current_year !== year ? 1 : s.next_value;
  const num = String(n).padStart(Math.max(1, s.padding), '0');
  const base = s.reset_yearly
    ? `${s.prefix}${s.separator}${year}${s.separator}${num}`
    : `${s.prefix}${s.separator}${num}`;
  return base + (s.suffix ?? '');
}
