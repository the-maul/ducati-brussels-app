/**
 * M0 — Configuration des séquences documentaires (numérotation).
 * Règles pures (aperçu, mode, réglage du prochain numéro) : `numbering-rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { numberingKey, type SalesNumberingMode } from './numbering-rules';

export { previewNumber } from './numbering-rules';

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

/** Format et libellé seulement : le prochain numéro se règle par `setSequenceNextValue` (tracé). */
export async function updateSequence(
  id: string,
  patch: Partial<Pick<DocSequence, 'prefix' | 'separator' | 'padding' | 'reset_yearly' | 'suffix' | 'label'>>,
): Promise<void> {
  const { error } = await supabase.from('document_sequences').update(patch).eq('id', id);
  if (error) throw error;
}

/** Vue d'ensemble renvoyée par `numbering_overview` (migration 20261118260000). */
export type NumberingOverview = {
  sales_mode: SalesNumberingMode;
  next_sales_mode: SalesNumberingMode | null;
  next_sales_mode_year: number | null;
  year: number;
  numbered_this_year: number;
  can_change_now: boolean;
  can_manage: boolean;
  shared_types: string[];
  police_register_next: string | null;
};

/** Fonction absente (migration pas encore appliquée) : PGRST202 / 42883. */
function isMissingFunction(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'PGRST202' || code === '42883';
}

// Fonctions posées par la migration 20261118260000 : absentes de `types.ts` tant qu'il n'est pas régénéré.
type UntypedRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc;

/** `null` tant que la migration n'est pas appliquée (l'écran reste en séries séparées, sans réglage). */
export async function getNumberingOverview(companyId: string): Promise<NumberingOverview | null> {
  const { data, error } = await rpc('numbering_overview', { _company: companyId });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return data as NumberingOverview;
}

export async function setSalesNumberingMode(companyId: string, mode: SalesNumberingMode, fromNextYear: boolean): Promise<void> {
  const { error } = await rpc('set_sales_numbering_mode', { _company: companyId, _mode: mode, _from_next_year: fromNextYear });
  if (error) throw error;
}

export async function setSequenceNextValue(sequenceId: string, next: number, reason: string): Promise<void> {
  const { error } = await rpc('set_sequence_next_value', { _sequence: sequenceId, _next: next, _reason: reason });
  if (error) throw error;
}

/** Série qui fournira le numéro d'un type de document (compteur unique en mode `single`). */
export function sequenceFor<T extends { doc_type: string }>(seqs: T[] | undefined, docType: string, mode: SalesNumberingMode | null | undefined): T | null {
  const key = numberingKey(docType, mode ?? 'separate');
  return seqs?.find((s) => s.doc_type === key) ?? null;
}
