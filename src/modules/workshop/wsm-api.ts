/**
 * M8 — Accès aux manuels d'atelier Ducati (mission 07, carte 3).
 *
 * Tout passe par des fonctions SQL en lecture (wsm_stats, wsm_manual_list, wsm_manual_overview) :
 * les tables wsm_* sont en lecture seule pour l'équipe, l'écriture est réservée au chargeur.
 *
 * Note : `types.ts` sera régénéré une fois les migrations 20260923100000 / 20260923101000
 * appliquées ; en attendant, les appels passent par un client faiblement typé et les réponses sont
 * décrites ici par des types explicites.
 */
import { supabase } from '@/integrations/supabase/client';

type RpcFn = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type WsmStats = {
  manuals: number;
  manualsByFamily: Record<string, number>;
  yearFrom: number | null;
  yearTo: number | null;
  procedures: number;
  steps: number;
  usages: number;
  services: number;
  operations: number;
  times: number;
  torqueLines: number;
  linked: number;
  toValidate: number;
  unlinked: number;
  images: number;
  imagesUploaded: number;
  lastLoadedAt: string | null;
};

export type WsmManualService = {
  code: string;
  name: string;
  km: number | null;
  mi: number | null;
  months: number | null;
  firstService: boolean;
};

export type WsmManualRow = {
  id: string;
  family: string;
  supermodel: string | null;
  model: string;
  modelYear: number;
  servicesCount: number;
  operationsCount: number;
  proceduresCount: number;
  timesCount: number;
  gaps: unknown[];
  services: WsmManualService[];
  linkStatus: 'lie' | 'a_valider' | 'rejete' | null;
  modelYearIds: string[];
};

export type WsmOverviewService = WsmManualService & {
  definition: string | null;
  ut: number | null;
  timeText: string | null;
  operations: number;
  procedures: number;
};

export type WsmOverview = {
  manual: {
    id: string; family: string; supermodel: string | null; model: string; model_year: number;
    manual_root: string | null; section: string | null; source_file: string | null;
    extracted_at: string | null; loaded_at: string | null; gaps: unknown[];
  };
  services: WsmOverviewService[];
  operations: { label: string; scope: string; groupLabel: string | null; serviceCodes: string[];
    periodicityKm: number | null; periodicityMonths: number | null }[];
  times: { label: string; serviceCode: string | null; timeText: string | null; minutes: number | null; ut: number | null }[];
  procedures: { id: string; title: string; role: string; steps: number; figures: number; torques: number;
    usages: number; code: string | null; version: string | null; updatedAt: string | null;
    dmPath: string | null; operation: string | null }[];
  torqueTables: { title: string; lines: number; code: string | null }[];
  toolSets: { title: string; tools: number; code: string | null }[];
  fluids: { title: string | null; lines: unknown[]; code: string | null }[];
  links: { modelYearId: string; status: string; origin: string; reason: string | null; label: string }[];
};

export async function getWsmStats(): Promise<WsmStats> {
  return call<WsmStats>('wsm_stats');
}

export async function listWsmManuals(family?: string | null, q?: string | null): Promise<WsmManualRow[]> {
  return call<WsmManualRow[]>('wsm_manual_list', {
    _family: family && family !== 'all' ? family : null,
    _q: q && q.trim().length >= 2 ? q.trim() : null,
    _limit: 2000,
  });
}

export async function getWsmManualOverview(manualId: string): Promise<WsmOverview> {
  return call<WsmOverview>('wsm_manual_overview', { _manual: manualId });
}

export async function proposeWsmCatalogLinks(companyId: string): Promise<{
  modelYears: number; byId: number; byName: number; toValidate: number; linked: number;
  manualsLinked: number; manualsUnlinked: number;
}> {
  return call('wsm_propose_catalog_links', { _company: companyId });
}

/** Échéance lisible : « 15 000 km / 9 000 mi ou 24 mois ». */
export function serviceDeadlineLabel(s: Pick<WsmManualService, 'km' | 'mi' | 'months'>): string {
  const parts: string[] = [];
  if (s.km != null) parts.push(`${s.km.toLocaleString('fr-BE')} km`);
  if (s.mi != null) parts.push(`${s.mi.toLocaleString('fr-BE')} mi`);
  const km = parts.join(' / ');
  if (s.months != null) return km ? `${km} ou ${s.months} mois` : `${s.months} mois`;
  return km;
}

/** Temps du manuel : « 11 UT (1 h 06 ) ». 1 UT = 6 min. */
export function utLabel(ut: number | null | undefined, minutes: number | null | undefined): string {
  if (ut == null && minutes == null) return '';
  const u = ut ?? Math.round((minutes ?? 0) / 6);
  const m = minutes ?? u * 6;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const dur = h ? `${h} h ${String(rest).padStart(2, '0')}` : `${rest} min`;
  return `${u} UT (${dur})`;
}
