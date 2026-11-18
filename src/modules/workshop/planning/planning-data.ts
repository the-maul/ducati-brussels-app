/**
 * M8 — Planning de charge : donnees partagees par les vues Reception, Activite, Reglages et
 * Motos de pret (une seule lecture par periode, cles React Query communes).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPlanningSettings, listMechanics, listMechanicHours, listCalendarBlocks, listAppointmentTypes,
  listPlanningAppointments, listWaitingAppointments, DEFAULT_SETTINGS, type PlanningSettings,
} from './api';
import type { DayContext } from './rules';

export const planningKeys = {
  all: (companyId: string) => ['planning-g8', companyId] as const,
  settings: (companyId: string) => ['planning-g8', companyId, 'settings'] as const,
  mechanics: (companyId: string) => ['planning-g8', companyId, 'mechanics'] as const,
  hours: (companyId: string) => ['planning-g8', companyId, 'hours'] as const,
  types: (companyId: string) => ['planning-g8', companyId, 'types'] as const,
  blocks: (companyId: string, from: string, to: string) => ['planning-g8', companyId, 'blocks', from, to] as const,
  appts: (companyId: string, from: string, to: string) => ['planning-g8', companyId, 'appts', from, to] as const,
  waiting: (companyId: string) => ['planning-g8', companyId, 'waiting'] as const,
};

export function usePlanningBase(companyId: string) {
  const settings = useQuery({ queryKey: planningKeys.settings(companyId), queryFn: () => getPlanningSettings(companyId), staleTime: 60_000 });
  const mechanics = useQuery({ queryKey: planningKeys.mechanics(companyId), queryFn: () => listMechanics(companyId), staleTime: 60_000 });
  const hours = useQuery({ queryKey: planningKeys.hours(companyId), queryFn: () => listMechanicHours(companyId), staleTime: 60_000 });
  const types = useQuery({ queryKey: planningKeys.types(companyId), queryFn: () => listAppointmentTypes(companyId), staleTime: 300_000 });
  const s: PlanningSettings = settings.data ?? { company_id: companyId, ...DEFAULT_SETTINGS };
  return { settings: s, mechanics: mechanics.data ?? [], hours: hours.data ?? [], types: types.data ?? [], loading: settings.isLoading || mechanics.isLoading };
}

export function usePlanningPeriod(companyId: string, from: Date, to: Date) {
  const f = from.toISOString(); const tt = to.toISOString();
  const blocks = useQuery({ queryKey: planningKeys.blocks(companyId, f, tt), queryFn: () => listCalendarBlocks(companyId, f, tt) });
  const appts = useQuery({ queryKey: planningKeys.appts(companyId, f, tt), queryFn: () => listPlanningAppointments(companyId, f, tt) });
  const waiting = useQuery({ queryKey: planningKeys.waiting(companyId), queryFn: () => listWaitingAppointments(companyId) });
  return { blocks: blocks.data ?? [], appts: appts.data ?? [], waiting: waiting.data ?? [], loading: appts.isLoading };
}

export function dayContext(base: ReturnType<typeof usePlanningBase>, blocks: DayContext['blocks']): DayContext {
  return { hours: base.hours, blocks, belgianHolidays: base.settings.belgian_holidays };
}

/** Rafraichit tout le planning (apres une creation, un deplacement, un reglage). */
export function usePlanningRefresh(companyId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: planningKeys.all(companyId) });
    void qc.invalidateQueries({ queryKey: ['appointments', companyId] });
  };
}
