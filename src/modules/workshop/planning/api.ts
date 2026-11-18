/**
 * M8 — Planning de charge (rattrapage G8 du 18/11/2026) : ACCES BASE.
 * Compagnons, horaires, reglages, calendrier (feries / fermetures / absences / pauses),
 * RDV (affectation, liste d'attente, recherche), types de RDV.
 *
 * Tables et colonnes de la migration 20261118120000 (non appliquee a l'ecriture : `types.ts` ne
 * les connait pas, d'ou les appels non types — meme parade que `accident/api.ts`). Tant que la
 * migration n'est pas en base, `planningSchemaReady()` renvoie false et l'ecran garde l'ancien
 * planning (mecanicien en texte libre).
 * Regles pures : `rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { listRef } from '@/modules/settings/reference-api';
import { createRepairOrder } from '../write-api';
import { operatorIdSchemaReady } from '../or-page-api';
import {
  DEFAULT_APPOINTMENT_TYPES, isJobColor, canCreateOr,
  type AppointmentType, type CalendarBlock, type MechanicHours, type PlanningMechanic,
} from './rules';

type LooseResult = { data: unknown; error: { code?: string; message: string } | null };
type LooseBuilder = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseBuilder;
  insert: (values: Record<string, unknown> | Record<string, unknown>[]) => LooseBuilder;
  update: (values: Record<string, unknown>) => LooseBuilder;
  upsert: (values: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) => LooseBuilder;
  delete: () => LooseBuilder;
  eq: (col: string, value: unknown) => LooseBuilder;
  in: (col: string, values: unknown[]) => LooseBuilder;
  gte: (col: string, value: unknown) => LooseBuilder;
  lt: (col: string, value: unknown) => LooseBuilder;
  or: (filter: string) => LooseBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => LooseBuilder;
  limit: (n: number) => LooseBuilder;
  maybeSingle: () => Promise<LooseResult>;
  single: () => Promise<LooseResult>;
};
const loose = supabase as unknown as {
  from: (table: string) => LooseBuilder;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<LooseResult>;
};
const unwrap = <T,>(r: LooseResult): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

// ---------------------------------------------------------------------------------------------
// Migration en base ?
// ---------------------------------------------------------------------------------------------
let probe: Promise<boolean> | null = null;
/** true quand la migration 20261118120000 est appliquee (table workshop_mechanics). */
export function planningSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const r = await loose.from('workshop_mechanics').select('id').limit(1);
      return !r.error;
    } catch {
      return false;
    }
  })();
  return probe;
}

// ---------------------------------------------------------------------------------------------
// Reglages
// ---------------------------------------------------------------------------------------------
export type PlanningSettings = {
  company_id: string; day_start: string; day_end: string; first_weekday: number; days_shown: number;
  slot_minutes: number; belgian_holidays: boolean; show_occupancy: boolean; block_overlaps: boolean;
  loan_terms: string | null;
};
/** Reglages G8 observes (07-atelier.md §14) quand la ligne manque. */
export const DEFAULT_SETTINGS: Omit<PlanningSettings, 'company_id'> = {
  day_start: '09:00', day_end: '18:00', first_weekday: 2, days_shown: 5, slot_minutes: 10,
  belgian_holidays: true, show_occupancy: true, block_overlaps: false, loan_terms: null,
};

export async function getPlanningSettings(companyId: string): Promise<PlanningSettings> {
  const r = await loose.from('workshop_planning_settings').select('*').eq('company_id', companyId).maybeSingle();
  const row = unwrap<PlanningSettings | null>(r);
  return { company_id: companyId, ...DEFAULT_SETTINGS, ...(row ?? {}) };
}
export async function savePlanningSettings(s: PlanningSettings): Promise<void> {
  unwrap(await loose.from('workshop_planning_settings').upsert({ ...s }, { onConflict: 'company_id' }));
}

// ---------------------------------------------------------------------------------------------
// Compagnons et horaires
// ---------------------------------------------------------------------------------------------
export type MechanicRow = PlanningMechanic & { company_id: string; workshop: string | null };

export async function listMechanics(companyId: string): Promise<MechanicRow[]> {
  const r = await loose.from('workshop_mechanics').select('*').eq('company_id', companyId).order('sort_order').order('name');
  return unwrap<MechanicRow[]>(r) ?? [];
}
export async function saveMechanic(m: Partial<MechanicRow> & { company_id: string; name: string }): Promise<string> {
  const row: Record<string, unknown> = {
    company_id: m.company_id, name: m.name, user_id: m.user_id ?? null, workshop: m.workshop ?? null,
    visible_in_planning: m.visible_in_planning ?? true, sort_order: m.sort_order ?? 0, is_active: m.is_active ?? true,
  };
  if (m.id) {
    unwrap(await loose.from('workshop_mechanics').update(row).eq('id', m.id));
    return m.id;
  }
  const created = unwrap<{ id: string }>(await loose.from('workshop_mechanics').insert(row).select('id').single());
  return created.id;
}

export async function listMechanicHours(companyId: string): Promise<MechanicHours[]> {
  const r = await loose.from('workshop_mechanic_hours').select('mechanic_id, weekday, am_start, am_end, pm_start, pm_end').eq('company_id', companyId);
  return unwrap<MechanicHours[]>(r) ?? [];
}
/** Remplace les horaires d'un compagnon (un jour sans plage = repos). */
export async function saveMechanicHours(companyId: string, mechanicId: string, rows: Omit<MechanicHours, 'mechanic_id'>[]): Promise<void> {
  const keep = rows.filter((h) => h.am_start || h.am_end || h.pm_start || h.pm_end);
  const clean = (v: string | null) => (v && v.trim() ? v : null);
  const payload = keep.map((h) => ({
    company_id: companyId, mechanic_id: mechanicId, weekday: h.weekday,
    am_start: clean(h.am_start), am_end: clean(h.am_end), pm_start: clean(h.pm_start), pm_end: clean(h.pm_end),
  }));
  if (payload.length) unwrap(await loose.from('workshop_mechanic_hours').upsert(payload, { onConflict: 'mechanic_id,weekday' }));
  const restDays = [1, 2, 3, 4, 5, 6, 7].filter((d) => !keep.some((h) => h.weekday === d));
  if (restDays.length) unwrap(await loose.from('workshop_mechanic_hours').delete().eq('mechanic_id', mechanicId).in('weekday', restDays));
}

// ---------------------------------------------------------------------------------------------
// Calendrier : feries, fermetures, absences, pauses
// ---------------------------------------------------------------------------------------------
export type CalendarBlockRow = CalendarBlock & { id: string; company_id: string };
export async function listCalendarBlocks(companyId: string, fromISO: string, toISO: string): Promise<CalendarBlockRow[]> {
  const r = await loose.from('workshop_calendar_blocks').select('*').eq('company_id', companyId)
    .lt('starts_at', toISO).gte('ends_at', fromISO).order('starts_at');
  return unwrap<CalendarBlockRow[]>(r) ?? [];
}
export async function addCalendarBlock(b: Omit<CalendarBlockRow, 'id'>): Promise<void> {
  unwrap(await loose.from('workshop_calendar_blocks').insert({ ...b }));
}
export async function deleteCalendarBlock(id: string): Promise<void> {
  unwrap(await loose.from('workshop_calendar_blocks').delete().eq('id', id));
}

// ---------------------------------------------------------------------------------------------
// Types de RDV (Parametres → Tables → Types de rendez-vous atelier)
// ---------------------------------------------------------------------------------------------
export const APPOINTMENT_TYPE_TABLE_KEY = 'workshop_appointment_type';
export async function listAppointmentTypes(companyId: string): Promise<AppointmentType[]> {
  try {
    const rows = (await listRef(companyId, APPOINTMENT_TYPE_TABLE_KEY)).filter((r) => r.is_active);
    if (!rows.length) return DEFAULT_APPOINTMENT_TYPES;
    return rows.map((r) => {
      const extra = (r.extra ?? {}) as Record<string, unknown>;
      const mins = Number(extra.default_minutes);
      return { code: r.code, label: r.label, color: isJobColor(extra.color) ? extra.color : null, defaultMinutes: Number.isFinite(mins) && mins > 0 ? mins : null };
    });
  } catch {
    return DEFAULT_APPOINTMENT_TYPES;
  }
}

// ---------------------------------------------------------------------------------------------
// RDV
// ---------------------------------------------------------------------------------------------
export type PlanningAppointment = {
  id: string; company_id: string; contact_id: string | null; vehicle_id: string | null; or_id: string | null;
  mechanic_name: string | null; mechanic_id: string | null; unassigned: boolean; appointment_type: string | null;
  mileage: number | null; workshop: string | null; starts_at: string; planned_minutes: number | null;
  work_description: string | null; reception_notes: string | null; loaner_vehicle: string | null;
  status: string; notify_sms: boolean; source: string | null; requested_slot: string | null;
  reason_code?: string | null; service_code?: string | null;
  contacts?: { first_name: string | null; last_name: string | null; company_name: string | null; type?: string | null } | null;
  vehicles?: { brand: string | null; model: string | null; plate: string | null; vin: string | null } | null;
};
const APPT_COLS = '*, contacts(first_name, last_name, company_name, type), vehicles(brand, model, plate, vin)';

/** RDV d'une periode (vues reception / activite) ; les RDV en attente sont lus a part. */
export async function listPlanningAppointments(companyId: string, fromISO: string, toISO: string): Promise<PlanningAppointment[]> {
  const r = await loose.from('workshop_appointments').select(APPT_COLS).eq('company_id', companyId)
    .gte('starts_at', fromISO).lt('starts_at', toISO).order('starts_at');
  return unwrap<PlanningAppointment[]>(r) ?? [];
}
/** Liste d'attente : RDV sans affectation + demandes de l'espace client, sans OR. */
export async function listWaitingAppointments(companyId: string): Promise<PlanningAppointment[]> {
  const r = await loose.from('workshop_appointments').select(APPT_COLS).eq('company_id', companyId)
    .or('unassigned.eq.true,status.eq.demande').order('starts_at').limit(200);
  const rows = unwrap<PlanningAppointment[]>(r) ?? [];
  return rows.filter((a) => !a.or_id && a.status !== 'annule' && a.status !== 'facture');
}

export type AppointmentInput = {
  companyId: string; status: string; unassigned: boolean; mechanicId: string | null; mechanicName: string | null;
  appointmentType: string | null; startsAt: string; plannedMinutes: number | null; contactId: string | null;
  vehicleId: string | null; mileage: number | null; workDescription: string | null; receptionNotes: string | null;
  notifySms: boolean; reasonCode: string | null;
};
function apptRow(p: AppointmentInput): Record<string, unknown> {
  return {
    company_id: p.companyId, status: p.status, unassigned: p.unassigned, mechanic_id: p.unassigned ? null : p.mechanicId,
    mechanic_name: p.unassigned ? null : p.mechanicName, appointment_type: p.appointmentType, starts_at: p.startsAt,
    planned_minutes: p.plannedMinutes, contact_id: p.contactId, vehicle_id: p.vehicleId, mileage: p.mileage,
    work_description: p.workDescription, reception_notes: p.receptionNotes, notify_sms: p.notifySms,
    ...(p.reasonCode ? { reason_code: p.reasonCode } : {}),
  };
}
export async function createPlanningAppointment(p: AppointmentInput): Promise<string> {
  const created = unwrap<{ id: string }>(await loose.from('workshop_appointments').insert(apptRow(p)).select('id').single());
  return created.id;
}
export async function updatePlanningAppointment(id: string, p: AppointmentInput): Promise<void> {
  const row = apptRow(p);
  delete row.company_id;
  if (!p.reasonCode) row.reason_code = null;
  unwrap(await loose.from('workshop_appointments').update(row).eq('id', id));
}

/** Glisser-deposer : le RDV quitte la liste d'attente, prend le compagnon et le creneau. */
export async function assignAppointment(id: string, p: { mechanicId: string; startsAt: string; fromRequest: boolean }): Promise<void> {
  const patch: Record<string, unknown> = { mechanic_id: p.mechanicId, starts_at: p.startsAt, unassigned: false };
  if (p.fromRequest) patch.status = 'prevu'; // une demande de l'espace client placee est confirmee
  unwrap(await loose.from('workshop_appointments').update(patch).eq('id', id));
}
/** Remet un RDV en attente (sans compagnon). */
export async function unassignAppointment(id: string): Promise<void> {
  unwrap(await loose.from('workshop_appointments').update({ unassigned: true, mechanic_id: null }).eq('id', id));
}
export async function setPlannedMinutes(id: string, minutes: number): Promise<void> {
  unwrap(await loose.from('workshop_appointments').update({ planned_minutes: minutes }).eq('id', id));
}
export async function setAppointmentStatus(id: string, status: string): Promise<void> {
  unwrap(await loose.from('workshop_appointments').update({ status }).eq('id', id));
}

/**
 * « Valider RDV et saisie OR » (G8) : temps prevu obligatoire, puis OR ouvert avec la moto, le km,
 * le client, les travaux, le motif et le compagnon (operateur = membre lie). Le RDV garde le lien.
 */
export async function createOrFromPlanningAppointment(a: PlanningAppointment, mechanics: PlanningMechanic[]): Promise<string> {
  if (!canCreateOr(a)) throw new Error('planned_time_required');
  const m = a.mechanic_id ? mechanics.find((x) => x.id === a.mechanic_id) ?? null : null;
  const withOperatorId = m?.user_id && await operatorIdSchemaReady() ? { operatorId: m.user_id } : {};
  const orId = await createRepairOrder({
    companyId: a.company_id, contactId: a.contact_id, vehicleId: a.vehicle_id, mileage: a.mileage ?? null,
    operator: m?.name ?? a.mechanic_name ?? null, repairType: null, workDescription: a.work_description ?? null,
    receptionNotes: a.reception_notes ?? null, status: 'en_cours', warrantyStatus: 'aucune',
    reasonCode: a.reason_code ?? undefined, lines: [], ...withOperatorId,
  });
  unwrap(await loose.from('workshop_appointments').update({ or_id: orId, status: 'en_cours' }).eq('id', a.id));
  return orId;
}

// ---------------------------------------------------------------------------------------------
// Recherche (G8 « Rechercher RDV » : client, immatriculation, n° de serie)
// ---------------------------------------------------------------------------------------------
export type AppointmentSearchRow = {
  id: string; starts_at: string; planned_minutes: number | null; status: string; unassigned: boolean;
  work_description: string | null; mechanic_name: string | null; client_name: string | null;
  brand: string | null; model: string | null; plate: string | null; vin: string | null; or_id: string | null;
};
export async function searchAppointments(companyId: string, term: string): Promise<AppointmentSearchRow[]> {
  const r = await loose.rpc('workshop_appointment_search', { _company: companyId, _term: term, _limit: 50 });
  return unwrap<AppointmentSearchRow[]>(r) ?? [];
}
