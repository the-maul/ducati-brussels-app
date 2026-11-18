/**
 * M8 — Motos de pret (rattrapage G8 du 18/11/2026) : ACCES BASE.
 * Tables `workshop_loaner_vehicles` / `workshop_loans` (migration 20261118121000, non appliquee a
 * l'ecriture : appels non types, meme parade que `accident/api.ts`). Regles pures : `rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import type { LoanStatus, FuelLevel } from './rules';

type LooseResult = { data: unknown; error: { code?: string; message: string } | null };
type LooseBuilder = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseBuilder;
  insert: (values: Record<string, unknown>) => LooseBuilder;
  update: (values: Record<string, unknown>) => LooseBuilder;
  eq: (col: string, value: unknown) => LooseBuilder;
  in: (col: string, values: unknown[]) => LooseBuilder;
  gte: (col: string, value: unknown) => LooseBuilder;
  lt: (col: string, value: unknown) => LooseBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => LooseBuilder;
  limit: (n: number) => LooseBuilder;
  maybeSingle: () => Promise<LooseResult>;
  single: () => Promise<LooseResult>;
};
const loose = supabase as unknown as { from: (table: string) => LooseBuilder };
const unwrap = <T,>(r: LooseResult): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

let probe: Promise<boolean> | null = null;
/** true quand la migration 20261118121000 est appliquee. */
export function loansSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    try { return !(await loose.from('workshop_loans').select('id').limit(1)).error; } catch { return false; }
  })();
  return probe;
}

export type LoanerVehicle = {
  id: string; company_id: string; vehicle_id: string | null; label: string; brand: string | null; plate: string | null;
  vin: string | null; color: string | null; first_registration: string | null; current_km: number | null;
  notes: string | null; sort_order: number; is_active: boolean;
};
export async function listLoanerVehicles(companyId: string): Promise<LoanerVehicle[]> {
  return unwrap<LoanerVehicle[]>(await loose.from('workshop_loaner_vehicles').select('*').eq('company_id', companyId).order('sort_order').order('label')) ?? [];
}
export async function saveLoanerVehicle(v: Partial<LoanerVehicle> & { company_id: string; label: string }): Promise<void> {
  const row: Record<string, unknown> = {
    company_id: v.company_id, label: v.label, brand: v.brand ?? null, plate: v.plate ?? null, vin: v.vin ?? null,
    color: v.color ?? null, first_registration: v.first_registration || null, current_km: v.current_km ?? null,
    notes: v.notes ?? null, sort_order: v.sort_order ?? 0, is_active: v.is_active ?? true,
  };
  if (v.id) unwrap(await loose.from('workshop_loaner_vehicles').update(row).eq('id', v.id));
  else unwrap(await loose.from('workshop_loaner_vehicles').insert(row));
}

export type Loan = {
  id: string; company_id: string; loaner_id: string; number: string | null; contact_id: string | null;
  appointment_id: string | null; or_id: string | null; status: LoanStatus; planned_start: string; planned_end: string;
  out_at: string | null; out_km: number | null; out_fuel: FuelLevel | null; out_notes: string | null;
  returned_at: string | null; return_km: number | null; return_fuel: FuelLevel | null; return_notes: string | null;
  created_at: string;
  contacts?: { first_name: string | null; last_name: string | null; company_name: string | null; type?: string | null } | null;
  repair_orders?: { number: string | null } | null;
};
const LOAN_COLS = '*, contacts(first_name, last_name, company_name, type), repair_orders(number)';

/** Prets qui touchent la periode, plus tous les prets encore sortis. */
export async function listLoans(companyId: string, fromISO: string, toISO: string): Promise<Loan[]> {
  const inRange = unwrap<Loan[]>(await loose.from('workshop_loans').select(LOAN_COLS).eq('company_id', companyId)
    .lt('planned_start', toISO).gte('planned_end', fromISO).order('planned_start')) ?? [];
  const out = unwrap<Loan[]>(await loose.from('workshop_loans').select(LOAN_COLS).eq('company_id', companyId)
    .eq('status', 'sorti').order('planned_start')) ?? [];
  const seen = new Set(inRange.map((l) => l.id));
  return [...inRange, ...out.filter((l) => !seen.has(l.id))];
}
export async function listLoansForAppointment(appointmentId: string): Promise<Loan[]> {
  return unwrap<Loan[]>(await loose.from('workshop_loans').select(LOAN_COLS).eq('appointment_id', appointmentId).order('planned_start')) ?? [];
}

export async function createLoan(p: {
  companyId: string; loanerId: string; contactId: string | null; appointmentId: string | null;
  plannedStart: string; plannedEnd: string;
}): Promise<string> {
  const r = unwrap<{ id: string }>(await loose.from('workshop_loans').insert({
    company_id: p.companyId, loaner_id: p.loanerId, contact_id: p.contactId, appointment_id: p.appointmentId,
    planned_start: p.plannedStart, planned_end: p.plannedEnd, status: 'reserve',
  }).select('id').single());
  return r.id;
}
export async function loanOut(id: string, p: { outAt: string; outKm: number; outFuel: FuelLevel | null; notes: string | null }): Promise<void> {
  unwrap(await loose.from('workshop_loans').update({ status: 'sorti', out_at: p.outAt, out_km: p.outKm, out_fuel: p.outFuel, out_notes: p.notes }).eq('id', id));
}
export async function loanReturn(id: string, p: { returnedAt: string; returnKm: number; returnFuel: FuelLevel | null; notes: string | null }): Promise<void> {
  unwrap(await loose.from('workshop_loans').update({ status: 'rendu', returned_at: p.returnedAt, return_km: p.returnKm, return_fuel: p.returnFuel, return_notes: p.notes }).eq('id', id));
}
export async function cancelLoan(id: string): Promise<void> {
  unwrap(await loose.from('workshop_loans').update({ status: 'annule' }).eq('id', id));
}
