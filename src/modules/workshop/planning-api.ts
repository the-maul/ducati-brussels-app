/**
 * M8 — Planning atelier : RDV (lecture + écriture). Création d'OR depuis un RDV.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { createRepairOrder } from './write-api';

export type Appointment = Database['public']['Tables']['workshop_appointments']['Row'];

export async function listAppointments(companyId: string, fromISO: string, toISO: string): Promise<Appointment[]> {
  const { data, error } = await supabase.from('workshop_appointments').select('*')
    .eq('company_id', companyId).gte('starts_at', fromISO).lt('starts_at', toISO).order('starts_at');
  if (error) throw error;
  return data ?? [];
}

/**
 * Cloche (décision N-1) : demandes de rendez-vous envoyées par les clients depuis
 * le portail (statut « demande », source « portail »), à confirmer par l'atelier.
 * Affichées aux rôles mecanicien, chef_atelier et admin.
 */
export const APPT_REQUEST_ROLES = ['admin', 'mecanicien', 'chef_atelier'] as const;
export type AppointmentRequest = {
  id: string;
  starts_at: string;
  requested_slot: string | null;
  work_description: string | null;
  client_name: string;
};
export async function listPortalAppointmentRequests(companyId: string): Promise<AppointmentRequest[]> {
  const { data, error } = await supabase.from('workshop_appointments')
    .select('id, starts_at, requested_slot, work_description, contacts(first_name, last_name)')
    .eq('company_id', companyId).eq('status', 'demande').eq('source', 'portail')
    .order('starts_at').limit(50);
  if (error) throw error;
  return (data ?? []).map((a) => {
    const c = (Array.isArray(a.contacts) ? a.contacts[0] : a.contacts) as { first_name: string | null; last_name: string | null } | null;
    const name = [c?.first_name, c?.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
    return {
      id: a.id, starts_at: a.starts_at, requested_slot: a.requested_slot,
      work_description: a.work_description, client_name: name || '—',
    };
  });
}

export type NewAppointment = {
  companyId: string; contactId?: string | null; vehicleId?: string | null; mechanicName?: string;
  workshop?: string; startsAt: string; plannedMinutes: number; workDescription?: string;
  receptionNotes?: string; loanerVehicle?: string; notifySms?: boolean;
};
export async function createAppointment(p: NewAppointment): Promise<string> {
  const { data, error } = await supabase.from('workshop_appointments').insert({
    company_id: p.companyId, contact_id: p.contactId ?? null, vehicle_id: p.vehicleId ?? null,
    mechanic_name: p.mechanicName ?? null, workshop: p.workshop ?? null, starts_at: p.startsAt,
    planned_minutes: p.plannedMinutes, work_description: p.workDescription ?? null,
    reception_notes: p.receptionNotes ?? null, loaner_vehicle: p.loanerVehicle ?? null, notify_sms: !!p.notifySms,
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function updateAppointmentStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from('workshop_appointments').update({ status }).eq('id', id);
  if (error) throw error;
}

/** Crée un OR depuis un RDV (B8) et le rattache au RDV (statut → en_cours). */
export async function createOrFromAppointment(a: Appointment): Promise<string> {
  const orId = await createRepairOrder({
    companyId: a.company_id, contactId: a.contact_id, vehicleId: a.vehicle_id, mileage: null,
    operator: a.mechanic_name ?? null, repairType: null, workDescription: a.work_description ?? null,
    receptionNotes: a.reception_notes ?? null, status: 'en_cours', warrantyStatus: 'aucune', lines: [],
  });
  const { error } = await supabase.from('workshop_appointments').update({ or_id: orId, status: 'en_cours' }).eq('id', a.id);
  if (error) throw error;
  return orId;
}
