/**
 * M8 — « Prochain entretien de chaque moto » (mission 07, cartes 4, 5, 6, 7) — accès base.
 *
 * Tout passe par les fonctions de la migration 20261005110000 / 20261005111000, qui
 * portent la règle (premier atteint, certitude exacte ou estimée, temps officiel Ducati).
 * Les écrans ne recalculent rien : une seule vérité.
 */
import { supabase } from '@/integrations/supabase/client';
import type { DueConfidence } from './maintenance-due';

export type DueScope = 'tous' | 'retard' | 'bientot' | 'estime' | 'sans_km';

export type DueOwner = { id: string; name: string | null } | null;

/** Une ligne de la liste « Entretiens à venir ». */
export type DueRow = {
  vehicleId: string;
  vin: string | null;
  reference: string | null;
  plate: string | null;
  brand: string | null;
  model: string | null;
  modelYear: number | null;
  mileage: number | null;
  usage: string | null;
  source: 'manuel' | 'plan' | null;
  serviceCode: string;
  serviceLabel: string;
  serviceFamily: string;
  confidence: DueConfidence;
  ut: number | null;
  dueKm: number | null;
  dueDate: string | null;
  reached: boolean;
  reachedBy: 'km' | 'mois' | null;
  firstTrigger: 'km' | 'mois' | null;
  kmReachedOn: string | null;
  kmPerDay: number | null;
  daysLeft: number | null;
  lastKm: number | null;
  lastDate: string | null;
  lastOrigin: string | null;
  owner: DueOwner;
  openOrId: string | null;
  appointmentAt: string | null;
  /** Seulement dans le lot « sans_km ». */
  missingKm?: boolean;
  firstRegistration?: string | null;
};

export type DueList = {
  scope: DueScope;
  total: number;
  rows: DueRow[];
  limit: number;
  offset: number;
  days?: number;
};

export type DueStats = {
  vehicles: number;
  withModelYear: number;
  withProgram: number;
  computable: number;
  /** Échéance dépassée ET dernier entretien connu : un vrai retard. */
  late: number;
  soon: number;
  /** Échéance estimée faute d'historique connu (ce que la carte 5 vient corriger). */
  estimated: number;
  exact: number;
  missingKm: number;
  noProgram: number;
  noModelYear: number;
  withHistory: number;
  hourlyRateHt: number | null;
  days: number;
};

/** Une échéance du programme d'une moto, telle que la base la calcule. */
export type VehicleDueService = {
  code: string;
  label: string;
  family: string;
  source: 'manuel' | 'plan';
  isGrid: boolean;
  isFirst: boolean;
  confidence: DueConfidence;
  intervalKm: number | null;
  intervalMonths: number | null;
  ut: number | null;
  lastKm: number | null;
  lastDate: string | null;
  lastOrigin: string | null;
  dueKm: number | null;
  dueDate: string | null;
  reached: boolean;
  reachedBy: 'km' | 'mois' | null;
  firstTrigger: 'km' | 'mois' | null;
  kmReachedOn: string | null;
  kmPerDay: number | null;
  daysLeft: number | null;
};

export type VehicleDue = {
  vehicleId: string;
  mileage: number | null;
  mileageQualif: string | null;
  firstRegistration: string | null;
  modelYearId: string | null;
  usage: string;
  hourlyRateHt: number | null;
  services: VehicleDueService[];
  history: { family: string; km: number | null; date: string | null; origin: string }[];
};

export type EstimatePartRow = {
  reference: string | null;
  designation: string;
  quantity: number;
  unit: string | null;
  kind: string;
  confidence: string;
  articleId: string | null;
  unitPriceHt: number | null;
  lineHt: number | null;
  priced: boolean;
};

export type ServiceEstimate = {
  vehicleId: string;
  found: boolean;
  reason?: string;
  serviceCode?: string;
  serviceLabel?: string;
  serviceFamily?: string;
  source?: 'manuel' | 'plan';
  confidence?: DueConfidence;
  reached?: boolean;
  dueKm?: number | null;
  dueDate?: string | null;
  firstTrigger?: 'km' | 'mois' | null;
  ut?: number | null;
  minutes?: number | null;
  hours?: number | null;
  hourlyRateHt?: number | null;
  labourHt?: number | null;
  kitId?: string | null;
  kitVersion?: number | null;
  parts?: EstimatePartRow[];
  partsHt?: number;
  partsWithoutPrice?: number;
  totalHt?: number;
  /** Faux dès qu'un temps ou un prix manque : le total est alors partiel. */
  complete?: boolean;
};

export type ReminderMessage = {
  found: boolean;
  reason?: string;
  vehicleId?: string;
  serviceCode?: string;
  serviceLabel?: string;
  confidence?: DueConfidence;
  reached?: boolean;
  subject?: string;
  body?: string;
  estimate?: ServiceEstimate;
  /** Toujours faux : l'envoi réel demande l'accord explicite du client (carte 7). */
  sendingEnabled: boolean;
  sendingBlockedReason?: string;
};

export type DeclarableService = { family: string; label: string };

// ---------------------------------------------------------------------------

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function getDueStats(companyId: string, days = 60): Promise<DueStats> {
  return call<DueStats>('maintenance_due_stats', { _company: companyId, _days: days });
}

export function listDue(
  companyId: string,
  scope: DueScope = 'tous',
  opts: { days?: number; q?: string | null; limit?: number; offset?: number } = {},
): Promise<DueList> {
  return call<DueList>('maintenance_due_list', {
    _company: companyId, _scope: scope, _days: opts.days ?? 60,
    _q: opts.q?.trim() || null, _limit: opts.limit ?? 50, _offset: opts.offset ?? 0,
  });
}

export function getVehicleDue(vehicleId: string): Promise<VehicleDue> {
  return call<VehicleDue>('maintenance_due_for_vehicle', { _vehicle: vehicleId });
}

export function getServiceEstimate(vehicleId: string, serviceCode?: string | null): Promise<ServiceEstimate> {
  return call<ServiceEstimate>('maintenance_estimate_for_vehicle', {
    _vehicle: vehicleId, _service: serviceCode ?? null,
  });
}

/** Poser le RDV d'entretien au planning, temps officiel Ducati bloqué. */
export function createMaintenanceAppointment(p: {
  vehicleId: string; startsAt: string; serviceCode?: string | null; mechanic?: string | null; notes?: string | null;
}): Promise<string> {
  return call<string>('maintenance_appointment_create', {
    _vehicle: p.vehicleId, _starts_at: p.startsAt, _service: p.serviceCode ?? null,
    _mechanic: p.mechanic?.trim() || null, _notes: p.notes?.trim() || null,
  });
}

/** Le message de relance, PRÉPARÉ. Rien n'est envoyé (carte 7). */
export function getReminderMessage(vehicleId: string, serviceCode?: string | null): Promise<ReminderMessage> {
  return call<ReminderMessage>('maintenance_reminder_message', {
    _vehicle: vehicleId, _service: serviceCode ?? null,
  });
}

/** Poser les cloches « entretien dû » (aucun envoi). */
export function refreshReminders(companyId: string, days = 60, limit = 200): Promise<{
  candidates: number; created: number; days: number; sent: boolean; note: string;
}> {
  return call('maintenance_reminders_refresh', { _company: companyId, _days: days, _limit: limit });
}

/** Enregistrer un entretien connu d'une moto (comptoir). */
export function addServiceHistory(p: {
  vehicleId: string; label: string; km?: number | null; date?: string | null; note?: string | null;
}): Promise<string> {
  return call<string>('vehicle_service_history_add', {
    _vehicle: p.vehicleId, _label: p.label, _km: p.km ?? null, _date: p.date ?? null,
    _source: 'declare_comptoir', _note: p.note ?? null,
  });
}

export function deleteServiceHistory(id: string): Promise<void> {
  return call<void>('vehicle_service_history_delete', { _id: id });
}

/** Mettre à jour le kilométrage d'une moto (la donnée qui manque le plus). */
export function setVehicleMileage(vehicleId: string, km: number): Promise<void> {
  return call<void>('vehicle_mileage_set', { _vehicle: vehicleId, _km: km });
}

/** La liste courte d'entretiens à proposer au client, sans jargon (carte 5). */
export function listDeclarableServices(modelYearId?: string | null): Promise<DeclarableService[]> {
  return call<DeclarableService[]>('maintenance_declarable_services', { _model_year: modelYearId ?? null });
}

/** Historique d'entretien saisi/déclaré d'une moto (pour la fiche moto). */
export async function listServiceHistory(vehicleId: string) {
  const { data, error } = await supabase
    .from('vehicle_service_history')
    .select('id, service_family, service_label, km, event_date, source, note, created_at')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/** Une moto du client, avec son entretien dû (fiche client). */
export type ContactVehicleDue = {
  vehicleId: string;
  label: string;
  vin: string | null;
  plate: string | null;
  mileage: number | null;
  /** L'entretien dû, ou null si la moto n'est pas calculable. */
  next: VehicleDueService | null;
};

/**
 * Les motos d'un client et leur entretien dû (fiche client).
 * Un client a peu de motos : une lecture par moto, pas de balayage de la société.
 */
export async function listDueForContact(contactId: string): Promise<ContactVehicleDue[]> {
  const { data, error } = await supabase
    .from('vehicle_owners')
    .select('vehicle_id, vehicle:vehicles(id, brand, model, model_year, vin, plate, mileage, is_active)')
    .eq('contact_id', contactId)
    .eq('is_current', true);
  if (error) throw error;

  type Row = { vehicle: { id: string; brand: string | null; model: string | null; model_year: number | null;
    vin: string | null; plate: string | null; mileage: number | null; is_active: boolean | null } | null };
  const bikes = ((data ?? []) as unknown as Row[]).map((r) => r.vehicle).filter((v): v is NonNullable<Row['vehicle']> => !!v && v.is_active !== false);

  return Promise.all(bikes.map(async (v) => {
    let next: VehicleDueService | null = null;
    try {
      const d = await getVehicleDue(v.id);
      next = d.services[0] ?? null;
    } catch { next = null; }
    return {
      vehicleId: v.id,
      label: [v.brand, v.model, v.model_year].filter(Boolean).join(' '),
      vin: v.vin, plate: v.plate, mileage: v.mileage, next,
    };
  }));
}
