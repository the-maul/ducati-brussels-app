/**
 * M4 — Réassort minimax immédiat (18/11/2026) : accès Supabase.
 * Lecture du réglage dans companies.minimax_mode ; écritures UNIQUEMENT par les fonctions SQL
 * tracées dans events (minimax_mode_set, minimax_proposal_apply, minimax_proposal_ignore).
 * Colonne et fonctions hors types.ts (migration 20261119130000) : client non typé, comme basket-api.
 */
import { supabase } from '@/integrations/supabase/client';
import { mapProposalRow, parseMinimaxMode, type MinimaxMode, type MinimaxProposalRow } from './minimax-immediate';

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const minimaxModeKey = (companyId: string | null | undefined) => ['minimax-mode', companyId] as const;

/** Réglage de la société (défaut « auto », y compris si la colonne n'existe pas encore). */
export async function getMinimaxMode(companyId: string): Promise<MinimaxMode> {
  const { data, error } = await sb.from('companies').select('minimax_mode').eq('id', companyId).maybeSingle();
  if (error) return 'auto';
  return parseMinimaxMode((data as { minimax_mode?: unknown } | null)?.minimax_mode);
}

export async function setMinimaxMode(companyId: string, mode: MinimaxMode): Promise<MinimaxMode> {
  return parseMinimaxMode(await rpc<string>('minimax_mode_set', { _company: companyId, _mode: mode }));
}

/** Pièces passées sous leur minimum parmi celles de la vente, pas encore couvertes au panier. */
export async function getMinimaxProposal(companyId: string, articleIds: string[]): Promise<MinimaxProposalRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('minimax_proposal', { _company: companyId, _articles: articleIds });
  return (rows ?? []).map(mapProposalRow);
}

export async function applyMinimaxProposal(companyId: string, lines: { article_id: string; qty: number }[], ref: string | null): Promise<{ basketId: string | null; added: number; merged: number }> {
  const res = await rpc<Record<string, unknown>>('minimax_proposal_apply', { _company: companyId, _lines: lines, _ref: ref });
  return { basketId: (res?.basket_id as string | null) ?? null, added: Number(res?.added ?? 0), merged: Number(res?.merged ?? 0) };
}

export async function ignoreMinimaxProposal(companyId: string, articleIds: string[], ref: string | null): Promise<void> {
  await rpc<null>('minimax_proposal_ignore', { _company: companyId, _articles: articleIds, _ref: ref });
}

export const minimaxNightKey = (companyId: string | null | undefined) => ['minimax-night', companyId] as const;

/** Nombre de pièces de la liste de la nuit encore à décider (mode manuel, migration 20261119210000). */
export async function getMinimaxNightCount(companyId: string): Promise<number> {
  const { data, error } = await sb.rpc('minimax_night_list_count', { _company: companyId });
  if (error) return 0;
  return Number(data ?? 0) || 0;
}

/** La liste de la nuit, recalculée à l'ouverture (mêmes colonnes que la fenêtre après une vente). */
export async function getMinimaxNightRows(companyId: string): Promise<MinimaxProposalRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('minimax_night_list_rows', { _company: companyId });
  return (rows ?? []).map(mapProposalRow);
}
