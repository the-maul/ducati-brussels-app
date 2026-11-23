/**
 * M8 — Chantier C1 (23/11/2026) : accès base du dossier moto.
 * Un dossier s'ouvre par l'id d'un OR ou d'un RDV. Lecture seule, sauf la remise de la moto
 * (fonctions de la migration 20261123100000, hors types.ts) et le km de l'OR.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PlanningAppointment } from '../planning/api';
import { partsSummary, type ReservationLite } from '../my-workshop/rules';
import { linesToReserve, type DossierLineLite, type DossierReservationLite } from './rules';

type LooseResult = { data: unknown; error: { message: string; code?: string; hint?: string; details?: string } | null };
type LooseQuery = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseQuery;
  eq: (col: string, value: unknown) => LooseQuery;
  neq: (col: string, value: unknown) => LooseQuery;
  or: (filter: string) => LooseQuery;
  order: (col: string, opts?: { ascending?: boolean }) => LooseQuery;
  limit: (n: number) => LooseQuery;
  maybeSingle: () => PromiseLike<LooseResult>;
  update: (row: Record<string, unknown>) => LooseQuery;
};
const loose = supabase as unknown as {
  from: (table: string) => LooseQuery;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<LooseResult>;
};

const APPT_COLS = '*, contacts(first_name, last_name, company_name, type), vehicles(brand, model, plate, vin)';

export type DossierRef = { orId: string | null; appointment: PlanningAppointment | null };

/** Retrouve le dossier : l'id est celui d'un OR ou d'un RDV (son OR l'emporte dès qu'il existe). */
export async function resolveDossier(id: string, companyId: string): Promise<DossierRef | null> {
  const or = await loose.from('repair_orders').select('id').eq('id', id).eq('company_id', companyId).maybeSingle();
  if (or.error) throw new Error(or.error.message);
  if (or.data) {
    const a = await loose.from('workshop_appointments').select(APPT_COLS).eq('or_id', id).neq('status', 'annule')
      .order('starts_at', { ascending: false }).limit(1);
    if (a.error) throw new Error(a.error.message);
    return { orId: id, appointment: ((a.data as PlanningAppointment[] | null) ?? [])[0] ?? null };
  }
  const a = await loose.from('workshop_appointments').select(APPT_COLS).eq('id', id).eq('company_id', companyId).maybeSingle();
  if (a.error) throw new Error(a.error.message);
  const appointment = (a.data as PlanningAppointment | null) ?? null;
  if (!appointment) return null;
  return { orId: appointment.or_id ?? null, appointment };
}

export type DossierParts = { total: number; missing: number; toReserve: number };

/** Pièces du dossier : réservations de l'OR, sinon du RDV (mêmes règles que « Mon atelier »). */
export async function loadDossierParts(p: { companyId: string; orId: string | null; appointmentId: string | null }): Promise<DossierParts> {
  const filter = p.orId ? `repair_order_id.eq.${p.orId}` : p.appointmentId ? `appointment_id.eq.${p.appointmentId}` : null;
  if (!filter) return { total: 0, missing: 0, toReserve: 0 };
  const r = await loose.from('stock_reservations').select('article_id, origin, qty_needed, qty_reserved, qty_consumed, status')
    .eq('company_id', p.companyId).eq('status', 'active').or(filter).limit(500);
  if (r.error) return { total: 0, missing: 0, toReserve: 0 };
  const s = partsSummary((r.data as ReservationLite[] | null) ?? [], null);
  return { total: s.total, missing: s.missing, toReserve: p.orId ? await countLinesToReserve(p.orId, (r.data as DossierReservationLite[] | null) ?? []) : 0 };
}

/** Une lecture en échec ne bloque pas le dossier : le bouton reste disponible. */
async function countLinesToReserve(orId: string, reservations: DossierReservationLite[]): Promise<number> {
  const or = await loose.from('repair_orders').select('status').eq('id', orId).maybeSingle();
  const status = (or.data as { status: string } | null)?.status;
  if (or.error || !status || status === 'facture' || status === 'annule') return 0;
  const l = await loose.from('repair_order_lines').select('article_id, quantity, checkup_state, articles(mgmt_type, is_active)')
    .eq('or_id', orId).eq('kind', 'piece').limit(500);
  if (l.error) return 0;
  type Row = Omit<DossierLineLite, 'mgmt_type' | 'is_active'> & { articles: { mgmt_type: string | null; is_active: boolean | null } | null };
  const lines = ((l.data as Row[] | null) ?? []).map((x) => ({ ...x, mgmt_type: x.articles?.mgmt_type ?? null, is_active: x.articles?.is_active ?? null }));
  return linesToReserve(lines, reservations);
}

export type DossierInvoice = { id: string; number: string | null; status: string; totalTtc: number; paidAmount: number };

export async function loadDossierInvoice(documentId: string | null | undefined): Promise<DossierInvoice | null> {
  if (!documentId) return null;
  const r = await loose.from('documents').select('id, number, status, total_ttc, paid_amount').eq('id', documentId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  const d = r.data as { id: string; number: string | null; status: string; total_ttc: number | string | null; paid_amount: number | string | null } | null;
  return d ? { id: d.id, number: d.number, status: d.status, totalTtc: Number(d.total_ttc) || 0, paidAmount: Number(d.paid_amount) || 0 } : null;
}

export type DossierHandover = { ready: boolean; at: string | null; by: string | null; origin: string | null };

/** Remise de la moto. Sans la migration : `ready = false`, l'écran ne propose pas la remise. */
export async function loadHandover(orId: string): Promise<DossierHandover> {
  const r = await loose.from('repair_order_handovers').select('handed_over_at, handed_over_by_name, origin').eq('or_id', orId).maybeSingle();
  if (r.error) return { ready: false, at: null, by: null, origin: null };
  const d = r.data as { handed_over_at: string; handed_over_by_name: string | null; origin: string | null } | null;
  return { ready: true, at: d?.handed_over_at ?? null, by: d?.handed_over_by_name ?? null, origin: d?.origin ?? null };
}

async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await loose.rpc(fn, args);
  if (error) throw new Error(error.message);
}

export const handOverMoto = (orId: string, note?: string | null) => call('repair_order_handover_set', { _or: orId, _note: note ?? null });
export const undoHandOver = (orId: string) => call('repair_order_handover_undo', { _or: orId });

/**
 * Km de l'OR depuis l'étape « Rentrer ». Le contrôle « inférieur au dernier relevé » reste en base :
 * l'erreur porte `hint = mileage_lower` et le relevé dans `details` (Q64, comme G8).
 */
export async function setOrMileage(orId: string, mileage: number, ackPrevious: number | null = null): Promise<void> {
  const row: Record<string, unknown> = { mileage };
  if (ackPrevious != null) row.mileage_ack_previous = ackPrevious;
  const { error } = await loose.from('repair_orders').update(row).eq('id', orId);
  if (error) throw Object.assign(new Error(error.message), { hint: error.hint, details: error.details });
}
