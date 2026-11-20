/**
 * M0 — Accès générique aux tables de paramètres (`reference_values`).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type RefRow = Database['public']['Tables']['reference_values']['Row'];
export type RefExtra = Record<string, string | number | boolean | null>;

/**
 * Perf (lot perf 2, 20/11/2026) : une fiche OR lisait 6 a 8 tables de parametres l'une apres
 * l'autre (motifs, types, mecaniciens, taches, pauses, cessions...). On lit TOUTES les valeurs
 * de la societe en une requete (~250 lignes, ~45 ko), gardee 30 s et partagee par tous les
 * appels ; chaque appel en garde sa table, dans le meme ordre (sort_order puis code).
 * Meme visibilite qu'avant : la RLS de reference_values ne depend que de la societe.
 * Toute ecriture par ce module vide la memoire ; au-dela de 1 000 valeurs (plafond d'une
 * reponse), retour a la lecture table par table.
 */
export const REF_CACHE_MS = 30_000;
const REF_MAX_ROWS = 1000;
const refCache = new Map<string, { at: number; rows: Promise<RefRow[] | null> }>();

/** Oublie les valeurs gardees (une societe, ou toutes). */
export function invalidateRefCache(companyId?: string): void {
  if (companyId) refCache.delete(companyId); else refCache.clear();
}

function companyRefs(companyId: string): Promise<RefRow[] | null> {
  const hit = refCache.get(companyId);
  if (hit && Date.now() - hit.at < REF_CACHE_MS) return hit.rows;
  const rows = (async () => {
    const { data, error } = await supabase
      .from('reference_values')
      .select('*')
      .eq('company_id', companyId)
      .order('table_key', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true })
      .limit(REF_MAX_ROWS);
    if (error) throw error;
    return (data ?? []).length >= REF_MAX_ROWS ? null : (data ?? []);
  })();
  refCache.set(companyId, { at: Date.now(), rows });
  rows.catch(() => { if (refCache.get(companyId)?.rows === rows) refCache.delete(companyId); });
  return rows;
}

export async function listRef(companyId: string, tableKey: string): Promise<RefRow[]> {
  const all = await companyRefs(companyId);
  if (all) return all.filter((r) => r.table_key === tableKey);
  return listRefDirect(companyId, tableKey);
}

async function listRefDirect(companyId: string, tableKey: string): Promise<RefRow[]> {
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
  invalidateRefCache(row.company_id);
  const { error } = await supabase.from('reference_values').upsert(row);
  invalidateRefCache(row.company_id);
  if (error) throw error;
}

export async function deleteRef(id: string): Promise<void> {
  const { error } = await supabase.from('reference_values').delete().eq('id', id);
  invalidateRefCache();
  if (error) throw error;
}
