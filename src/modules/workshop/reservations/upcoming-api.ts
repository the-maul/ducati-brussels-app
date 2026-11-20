/**
 * M8 / M5 — Lot B (19/11/2026) : acces base de l'ecran magasin « Pieces des RDV a venir » et des
 * reglages de la picking list (migration 20261119250000). Migration absente : `null` / liste vide,
 * l'ecran l'annonce et rien ne casse.
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingSchema } from './api';
import {
  DEFAULT_PARTS_SETTINGS, isPickingEveBasis, isPickingMode, type PickingAutoMode, type PickingEveBasis, type UpcomingPartRow, type UpcomingPartState,
} from './parts-flow';

const sb = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => (v == null ? null : String(v));

/** Pieces des RDV d'entretien du `from` au `to` (AAAA-MM-JJ, Bruxelles). `null` = migration absente. */
export async function listUpcomingParts(companyId: string, from: string, to: string): Promise<UpcomingPartRow[] | null> {
  const { data, error } = await sb.rpc('workshop_upcoming_parts', { _company: companyId, _from: from, _to: to });
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map((r) => ({
    appointmentId: String(r.appointment_id), startsAt: String(r.starts_at), appointmentStatus: String(r.appointment_status ?? ''),
    repairOrderId: s(r.repair_order_id), orNumber: s(r.or_number), contactName: s(r.contact_name), vehicleLabel: s(r.vehicle_label),
    plate: s(r.plate), serviceCode: s(r.service_code), mechanicName: s(r.mechanic_name), pickingId: s(r.picking_id),
    pickingStatus: s(r.picking_status), reservationId: s(r.reservation_id), articleId: s(r.article_id),
    reference: String(r.reference ?? ''), designation: String(r.designation ?? ''), bin: s(r.bin_location),
    qtyNeeded: n(r.qty_needed), qtyReserved: n(r.qty_reserved), qtyMissing: n(r.qty_missing), qtyOnOrder: n(r.qty_on_order),
    state: String(r.part_state) as UpcomingPartState, basketId: s(r.basket_id), basketLabel: s(r.basket_label),
    basketKind: s(r.basket_kind), basketStatus: s(r.basket_status), dcsOrderNumber: s(r.dcs_order_number),
    availability: s(r.supplier_availability), replacementReference: s(r.replacement_reference),
    realQty: n(r.real_qty), freeQty: n(r.free_qty), canReserve: !!r.can_reserve, canOrderUrgent: !!r.can_order_urgent,
  }));
}

export type UrgentResult = { moved: number; added: number; reason: 'reserved' | 'not_orderable' | 'already_ordered' | 'inactive' | null };

/** « Commander en urgente » : bascule le panier standard ouvert et commande le manque non couvert. */
export async function orderReservationUrgent(reservationId: string): Promise<UrgentResult> {
  const { data, error } = await sb.rpc('workshop_reservation_order_urgent', { _reservation: reservationId });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Row;
  return { moved: n(d.moved), added: n(d.added), reason: (s(d.reason) as UrgentResult['reason']) ?? null };
}

/** « Preparer maintenant » : cree (ou complete) la picking list d'un RDV, avant la veille. */
export async function openPickingForAppointment(appointmentId: string): Promise<string> {
  const { data, error } = await sb.rpc('picking_open_for_appointment', { _appointment: appointmentId });
  if (error) throw new Error(error.message);
  return String(data);
}

/** « Preparer » depuis un RDV qui a deja son OR : bouton existant de l'OR. */
export async function openPickingForRepairOrder(orId: string): Promise<string> {
  const { data, error } = await sb.rpc('picking_open_for_repair_order', { _or: orId });
  if (error) throw new Error(error.message);
  return String(data);
}

export type PartsSettings = {
  mode: PickingAutoMode; eveHour: number; urgentDays: number;
  /** Q58 : veille ouvree / calendaire ; `eveBasisReady` faux = migration 20261120102000 absente. */
  eveBasis: PickingEveBasis; eveBasisReady?: boolean;
};

/** Reglages du lot ; `null` = migration absente. */
export async function getPartsSettings(companyId: string): Promise<PartsSettings | null> {
  const { data, error } = await sb.rpc('workshop_parts_settings', { _company: companyId });
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Row;
  return {
    mode: isPickingMode(d.mode) ? d.mode : DEFAULT_PARTS_SETTINGS.mode,
    eveHour: d.eve_hour == null ? DEFAULT_PARTS_SETTINGS.eveHour : n(d.eve_hour),
    urgentDays: d.urgent_days == null ? DEFAULT_PARTS_SETTINGS.urgentDays : n(d.urgent_days),
    // Q58 : absent (migration 20261120102000 non appliquee) = veille calendaire, le comportement d'avant.
    eveBasis: isPickingEveBasis(d.eve_basis) ? d.eve_basis : 'calendaire',
    eveBasisReady: d.eve_basis !== undefined,
  };
}

export async function savePartsSettings(companyId: string, p: PartsSettings): Promise<void> {
  const { error } = await sb.rpc('workshop_parts_settings_set', {
    _company: companyId, _mode: p.mode, _eve_hour: p.eveHour, _urgent_days: p.urgentDays,
    ...(p.eveBasisReady === false ? {} : { _eve_basis: p.eveBasis }),
  });
  if (error) throw new Error(error.message);
}
