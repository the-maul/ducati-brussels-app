/**
 * M8 — Plans d'entretien (mission 07, carte 1) — accès base.
 *
 * Lecture : tables maintenance_* et maintenance_plan_catalog_links (RLS : comptes de l'équipe).
 * Écriture : chargeur (tools/maintenance-loader) pour les plans ; fonctions
 * maintenance_propose_catalog_links / maintenance_link_set pour les rattachements
 * (administrateur ou chef d'atelier) ; vehicles.maintenance_usage pour l'usage d'une moto.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { loadQuoteFeeParams } from './quote-fees-api';
import { effectiveHourlyRate, type MaintenanceUsage } from './maintenance-plans';

export type MaintenancePlan = Pick<Tables<'maintenance_plans'>,
  'id' | 'family' | 'model_text' | 'year_from' | 'year_to' | 'usage' | 'checklist_id' | 'match_names'
  | 'source_files' | 'loaded_at' | 'variants' | 'checklist_history'>;
export type MaintenanceInterval = Tables<'maintenance_service_intervals'>;
export type MaintenanceOperation = Tables<'maintenance_service_operations'>;
export type MaintenanceTime = Tables<'maintenance_service_times'>;
export type MaintenanceService = Tables<'maintenance_plan_services'> & {
  intervals: MaintenanceInterval[]; operations: MaintenanceOperation[]; times: MaintenanceTime[];
};
export type LinkStatus = 'lie' | 'a_valider' | 'rejete';
export type PlanLink = {
  id: string; plan_id: string; model_year_id: string; status: LinkStatus; origin: string; reason: string | null;
  decided_at: string | null;
  model_year: { id: string; year: number | null; name: string | null; code: string | null;
    model: { description: string; family: { description: string } | null } | null } | null;
};
export type MaintenanceStats = {
  plans: number; services: number; intervals: number; intervalsCurrent: number; operations: number;
  times: number; timesCurrent: number; checklists: number; sources: number; lastLoadedAt: string | null;
  plansByUsage: Record<string, number>;
};
export type Coverage = {
  modelYears: number; covered: number; pending: number; uncovered: number;
  list: { id: string; year: number | null; name: string | null; model: string; family: string; pending: boolean }[];
};
export type ModelYearHit = { id: string; year: number | null; name: string | null; model: string; family: string };

const PLAN_COLS = 'id, family, model_text, year_from, year_to, usage, checklist_id, match_names, source_files, loaded_at, variants, checklist_history';
const LINK_COLS = 'id, plan_id, model_year_id, status, origin, reason, decided_at, model_year:ducati_catalog_model_years(id, year, name, code, model:ducati_catalog_models(description, family:ducati_catalog_families(description)))';

export async function getMaintenanceStats(): Promise<MaintenanceStats> {
  const { data, error } = await supabase.rpc('maintenance_stats');
  if (error) throw error;
  return data as unknown as MaintenanceStats;
}

export async function listMaintenancePlans(): Promise<MaintenancePlan[]> {
  const { data, error } = await supabase.from('maintenance_plans').select(PLAN_COLS)
    .order('family').order('model_text').order('year_from');
  if (error) throw error;
  return (data ?? []) as MaintenancePlan[];
}

/** Nombre de rattachements par plan et par état (pour la liste). */
export async function listLinkCounts(): Promise<Record<string, { lie: number; a_valider: number }>> {
  const { data, error } = await supabase.from('maintenance_plan_catalog_links').select('plan_id, status').neq('status', 'rejete');
  if (error) throw error;
  const out: Record<string, { lie: number; a_valider: number }> = {};
  for (const r of data ?? []) {
    const c = (out[r.plan_id] ??= { lie: 0, a_valider: 0 });
    if (r.status === 'lie') c.lie++; else if (r.status === 'a_valider') c.a_valider++;
  }
  return out;
}

/** Échéances d'un plan avec intervalles, opérations et temps (toutes versions). */
export async function getPlanServices(planId: string): Promise<MaintenanceService[]> {
  const { data, error } = await supabase.from('maintenance_plan_services')
    .select('*, intervals:maintenance_service_intervals(*), operations:maintenance_service_operations(*), times:maintenance_service_times(*)')
    .eq('plan_id', planId).order('sort');
  if (error) throw error;
  return ((data ?? []) as MaintenanceService[]).map((s) => ({
    ...s,
    intervals: [...s.intervals].sort((a, b) => a.sort - b.sort),
    operations: [...s.operations].sort((a, b) => a.sort - b.sort),
    times: [...s.times].sort((a, b) => a.sort - b.sort),
  }));
}

export async function listPlanLinks(planId: string): Promise<PlanLink[]> {
  const { data, error } = await supabase.from('maintenance_plan_catalog_links').select(LINK_COLS).eq('plan_id', planId);
  if (error) throw error;
  return sortLinks((data ?? []) as unknown as PlanLink[]);
}

function sortLinks(l: PlanLink[]): PlanLink[] {
  const k = (x: PlanLink) => `${x.model_year?.model?.description ?? ''}|${String(x.model_year?.year ?? 0).padStart(4, '0')}`;
  return [...l].sort((a, b) => k(a).localeCompare(k(b)));
}

export async function proposeCatalogLinks(companyId: string): Promise<{ modelYears: number; candidates: number; linked: number; toValidate: number; alreadyKnown: number }> {
  const { data, error } = await supabase.rpc('maintenance_propose_catalog_links', { _company: companyId });
  if (error) throw error;
  return data as unknown as { modelYears: number; candidates: number; linked: number; toValidate: number; alreadyKnown: number };
}

/** Rattacher (lie) ou détacher (rejete) des modèles-années à un plan. */
export async function setPlanLinks(companyId: string, planId: string, modelYearIds: string[], status: 'lie' | 'rejete'): Promise<number> {
  const { data, error } = await supabase.rpc('maintenance_link_set', {
    _company: companyId, _plan: planId, _model_year_ids: modelYearIds, _status: status,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function getCatalogCoverage(limit = 300): Promise<Coverage> {
  const { data, error } = await supabase.rpc('maintenance_catalog_coverage', { _limit: limit });
  if (error) throw error;
  return data as unknown as Coverage;
}

/** Modèles-années du catalogue (Europe) dont le nom de modèle contient le texte cherché. */
export async function searchCatalogModelYears(q: string): Promise<ModelYearHit[]> {
  const k = q.trim();
  if (k.length < 2) return [];
  const { data, error } = await supabase.from('ducati_catalog_models')
    .select('id, description, family:ducati_catalog_families(description), years:ducati_catalog_model_years(id, year, name)')
    .eq('is_europe', true).ilike('description', `%${k.replace(/[%_]/g, '')}%`).order('description').limit(30);
  if (error) throw error;
  const out: ModelYearHit[] = [];
  for (const m of (data ?? []) as unknown as { description: string; family: { description: string } | null; years: { id: string; year: number | null; name: string | null }[] }[]) {
    for (const y of [...(m.years ?? [])].sort((a, b) => (a.year ?? 0) - (b.year ?? 0))) {
      out.push({ id: y.id, year: y.year, name: y.name, model: m.description, family: m.family?.description ?? '' });
    }
  }
  return out;
}

/** Plans rattachés (état « lié ») au modèle-année du catalogue d'une moto. */
export async function listPlansForModelYear(modelYearId: string): Promise<MaintenancePlan[]> {
  const { data, error } = await supabase.from('maintenance_plan_catalog_links')
    .select(`plan:maintenance_plans(${PLAN_COLS})`).eq('model_year_id', modelYearId).eq('status', 'lie');
  if (error) throw error;
  return ((data ?? []) as unknown as { plan: MaintenancePlan | null }[]).map((r) => r.plan).filter((p): p is MaintenancePlan => !!p);
}

/** Modèle-année du catalogue (libellé pour la fiche moto). */
export async function getCatalogModelYear(id: string): Promise<ModelYearHit | null> {
  const { data, error } = await supabase.from('ducati_catalog_model_years')
    .select('id, year, name, model:ducati_catalog_models(description, family:ducati_catalog_families(description))')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const d = data as unknown as { id: string; year: number | null; name: string | null; model: { description: string; family: { description: string } | null } | null };
  return { id: d.id, year: d.year, name: d.name, model: d.model?.description ?? '', family: d.model?.family?.description ?? '' };
}

/** Usage d'entretien choisi par le client pour sa moto. */
export async function setVehicleMaintenanceUsage(vehicleId: string, usage: MaintenanceUsage): Promise<void> {
  const { error } = await supabase.from('vehicles').update({ maintenance_usage: usage }).eq('id', vehicleId);
  if (error) throw error;
}

/** Taux horaire atelier HT (Paramètres → Tables → Frais de devis atelier ; repli article MO) ; null = à saisir. */
export async function loadHourlyRateHt(companyId: string): Promise<number | null> {
  const p = await loadQuoteFeeParams(companyId);
  return effectiveHourlyRate(p.hourlyRateHt);
}
