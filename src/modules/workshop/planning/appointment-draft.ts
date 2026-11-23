/**
 * M8 — Rendez-vous en cours de saisie (retour de Domenico, 23/11/2026, UX011) : quand on quitte la
 * fenêtre pour créer une moto puis qu'on revient en arrière, on retrouve le RDV là où on l'a laissé.
 * Gardé dans l'onglet (`sessionStorage`), effacé à l'enregistrement, à l'annulation ou à « Recommencer ».
 */
import { formDraftKey, readDraft } from '@/lib/form-draft';
import type { CheckPoints } from '../or-base/rules';

export type AppointmentDraft = {
  appointmentId: string | null;
  contactId: string | null;
  vehicleId: string | null;
  status: string;
  unassigned: boolean;
  mechanicId: string;
  type: string;
  date: string;
  time: string;
  hours: string;
  mins: string;
  mileage: string;
  work: string;
  notes: string;
  notify: boolean;
  reasonCode: string;
  checkPoints: CheckPoints;
};

export const appointmentDraftKey = (companyId: string) => formDraftKey('/workshop/planning/rdv', companyId);

/** La moto qu'on vient de créer pour ce RDV prend place dans la saisie. */
export function withReturnedVehicle(draft: AppointmentDraft, vehicleId: string | null | undefined): AppointmentDraft {
  return vehicleId ? { ...draft, vehicleId } : draft;
}

export function restoreAppointmentDraft(companyId: string, vehicleId?: string | null): AppointmentDraft | null {
  const draft = readDraft<AppointmentDraft>(appointmentDraftKey(companyId));
  return draft ? withReturnedVehicle(draft, vehicleId) : null;
}
