/**
 * M0 — Accès générique aux tables de paramètres (`reference_values`).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type RefRow = Database['public']['Tables']['reference_values']['Row'];
export type RefExtra = Record<string, string | number | boolean | null>;

export async function listRef(companyId: string, tableKey: string): Promise<RefRow[]> {
  const { data, error } = await supabase
    .from('reference_values')
    .select('*')
    .eq('company_id', companyId)
    .eq('table_key', tableKey)
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function upsertRef(row: {
  id?: string; company_id: string; table_key: string; code: string; label: string;
  sort_order: number; is_active: boolean; extra: RefExtra;
}): Promise<void> {
  const { error } = await supabase.from('reference_values').upsert(row);
  if (error) throw error;
}

export async function deleteRef(id: string): Promise<void> {
  const { error } = await supabase.from('reference_values').delete().eq('id', id);
  if (error) throw error;
}
