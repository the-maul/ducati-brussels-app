/**
 * M13 — Statistiques façon G8 : appels à la base (migration 20261118181000_m13_statistiques_g8.sql).
 * Les fonctions renvoient du JSON (une seule valeur) : jamais tronqué à 1 000 lignes par l'API.
 * Fonctions absentes de `types.ts` tant que la migration n'est pas posée : appel non typé.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  parseArticleStats, parseIndicators, parseMonthly, parseOpenDocs, parseStatsRows,
  type ArticleMonthStat, type Indicator, type MonthlyStats, type OpenDocStat, type StatsDim, type StatsRow, type StatsSource,
} from './stats-core';
import { cleanFilters, type StatsFilters } from './stats-filters';

export { cleanFilters, isStatsForbidden, isStatsMissing, type StatsFilters } from './stats-filters';

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type RpcFn = (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;

/** Appel d'une fonction SQL hors typage généré (toujours lié au client : voir tests/rpc-bound.test.ts). */
function rpcLoose(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  return (supabase.rpc as unknown as RpcFn).call(supabase, fn, args);
}

function fail(e: RpcResult['error']): never {
  const err = new Error(e?.message ?? 'stats error') as Error & { code?: string };
  err.code = e?.code;
  throw err;
}

export async function getStats(
  companyId: string, source: StatsSource, from: string, to: string, filters: StatsFilters, levels: StatsDim[], compare: boolean,
): Promise<StatsRow[]> {
  const { data, error } = await rpcLoose('stats_query', {
    _company: companyId, _source: source, _from: from, _to: to,
    _filters: cleanFilters(filters), _levels: levels, _compare: compare,
  });
  if (error) fail(error);
  return parseStatsRows(data);
}

export async function getMonthlyStats(companyId: string, year: number, filters: StatsFilters): Promise<MonthlyStats> {
  const { data, error } = await rpcLoose('stats_monthly', { _company: companyId, _year: year, _filters: cleanFilters(filters) });
  if (error) fail(error);
  return parseMonthly(data);
}

export async function getStatsIndicators(companyId: string, from: string, to: string): Promise<Indicator[]> {
  const { data, error } = await rpcLoose('stats_indicators', { _company: companyId, _from: from, _to: to });
  if (error) fail(error);
  return parseIndicators(data);
}

export async function getOpenDocuments(companyId: string): Promise<OpenDocStat[]> {
  const { data, error } = await rpcLoose('stats_open_documents', { _company: companyId });
  if (error) fail(error);
  return parseOpenDocs(data);
}

export async function getArticleStats(articleId: string): Promise<ArticleMonthStat[]> {
  const { data, error } = await rpcLoose('article_stats', { _article: articleId });
  if (error) fail(error);
  return parseArticleStats(data);
}

/** Choix d'un client (sélection G8 « client ») : recherche accent-insensible existante. */
export type ContactPick = { id: string; label: string };
export async function searchStatsContacts(companyId: string, q: string): Promise<ContactPick[]> {
  if (q.trim().length < 2) return [];
  const { data, error } = await supabase.rpc('contacts_search', { _company: companyId, _q: q.trim(), _type: '', _limit: 10, _offset: 0 });
  if (error) throw error;
  return ((data ?? []) as { id: string; company_name: string | null; first_name: string | null; last_name: string | null }[])
    .map((c) => ({ id: c.id, label: c.company_name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.id }));
}

/** Fournisseurs (sélection G8 « fournisseur »). */
export async function searchStatsSuppliers(companyId: string, q: string): Promise<ContactPick[]> {
  let query = supabase.from('contacts').select('id, company_name, first_name, last_name')
    .eq('company_id', companyId).eq('type', 'fournisseur').order('company_name').limit(20);
  const s = q.replace(/[,()%*]/g, ' ').trim();
  if (s) query = query.or(`company_name.ilike.%${s}%,last_name.ilike.%${s}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, label: c.company_name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.id }));
}

/** Types de cession interne (Paramètres → Tables). */
export async function listCessionTypes(companyId: string): Promise<{ code: string; label: string }[]> {
  const { data, error } = await supabase.from('reference_values').select('code, label')
    .eq('company_id', companyId).eq('table_key', 'cession_type').order('sort_order');
  if (error) throw error;
  return data ?? [];
}
