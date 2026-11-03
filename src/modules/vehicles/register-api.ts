/**
 * M3 — Registre des vehicules a moteur (AR n° 1 art. 28, circulaire 2018/C/47), VEH010 :
 * acces aux fonctions SQL de la migration 20261103190000 (table `vehicle_register`, append-only).
 * Le registre se remplit TOUT SEUL par declencheurs (OR, reprise, reception, depot-vente, vente) ;
 * l'ecran ne fait que lire, inscrire une sortie, ajouter une ligne manuelle (admin) ou rectifier (admin).
 * La table n'est pas encore dans `types.ts` (migration non appliquee) : appels non types, repli propre
 * si la migration manque (`registerSchemaReady`).
 */
import { supabase } from '@/integrations/supabase/client';
import type { RegisterLine, RegisterState } from './register';

type LooseResult = { data: unknown; error: { message: string; code?: string } | null };
type LooseRpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<LooseResult> };
const loose = supabase as unknown as LooseRpc;

const unwrap = <T,>(r: LooseResult): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

/** Roles qui voient le compteur « a facturer avant la fin du mois » dans la cloche. */
export const REGISTER_NOTIF_ROLES = ['admin', 'chef_atelier'] as const;

export type RegisterRow = RegisterLine & {
  number: string;
  establishment: string;
  nature_label: string;
  vehicle_label: string | null;
  contact_name: string | null;
  state: RegisterState;
  created_at: string;
};

export type RegisterFilter = 'all' | 'open' | 'to_invoice' | 'overdue' | 'closed';

/** La migration est-elle posee ? (fonction absente → l'ecran l'explique au lieu de planter). */
export async function registerSchemaReady(): Promise<boolean> {
  const r = await loose.rpc('vehicle_register_years', { _company: '00000000-0000-0000-0000-000000000000' });
  if (!r.error) return true;
  if (r.error.code === '42883' || r.error.code === 'PGRST202' || /vehicle_register/.test(r.error.message)) return false;
  throw new Error(r.error.message);
}

export async function listRegister(companyId: string, year: number | null, month: number | null, filter: RegisterFilter, vehicleId?: string | null): Promise<RegisterRow[]> {
  const r = await loose.rpc('vehicle_register_list', {
    _company: companyId, _year: year, _month: month, _filter: filter, _vehicle: vehicleId ?? null,
  });
  const rows = unwrap<RegisterRow[] | null>(r) ?? [];
  return rows.map((x) => ({ ...x, seq: Number(x.seq), year: Number(x.year) }));
}

export async function listRegisterYears(companyId: string): Promise<number[]> {
  const r = await loose.rpc('vehicle_register_years', { _company: companyId });
  return (unwrap<number[] | null>(r) ?? []).map(Number);
}

export type RegisterPending = { to_invoice: number; overdue: number; due_this_month: number; next_due: string | null };

const NO_PENDING: RegisterPending = { to_invoice: 0, overdue: 0, due_this_month: 0, next_due: null };

/** Sorties sans facture : a inscrire avant la fin du mois en cours, en retard, total. Migration absente : zero. */
export async function registerPending(companyId: string): Promise<RegisterPending> {
  const r = await loose.rpc('vehicle_register_pending', { _company: companyId });
  if (r.error && (r.error.code === '42883' || r.error.code === 'PGRST202')) return NO_PENDING;
  const d = unwrap<RegisterPending[] | RegisterPending | null>(r);
  const row = (Array.isArray(d) ? d[0] : d) ?? NO_PENDING;
  return {
    to_invoice: Number(row.to_invoice ?? 0), overdue: Number(row.overdue ?? 0),
    due_this_month: Number(row.due_this_month ?? 0), next_due: row.next_due ?? null,
  };
}

export async function addManualLine(p: {
  companyId: string; enteredAt: string; vehicleId?: string | null; vin?: string | null; plate?: string | null;
  contactId?: string | null; nature: string; note?: string | null;
}): Promise<string> {
  const r = await loose.rpc('vehicle_register_add_manual', {
    _company: p.companyId, _entered_at: p.enteredAt, _vehicle: p.vehicleId ?? null, _vin: p.vin ?? null, _plate: p.plate ?? null,
    _contact: p.contactId ?? null, _nature: p.nature, _note: p.note ?? null,
  });
  return unwrap<string>(r);
}

export async function setExit(p: { lineId: string; leftAt: string; invoiceDocumentId?: string | null; invoiceRef?: string | null; reason?: string | null }): Promise<void> {
  const r = await loose.rpc('vehicle_register_set_exit', {
    _line: p.lineId, _left_at: p.leftAt, _invoice_document: p.invoiceDocumentId ?? null, _invoice_ref: p.invoiceRef ?? null, _reason: p.reason ?? null,
  });
  unwrap(r);
}

export async function rectifyRegisterLine(p: {
  lineId: string; enteredAt?: string | null; vin?: string | null; plate?: string | null; nature?: string | null;
  leftAt?: string | null; invoiceRef?: string | null; reason?: string | null; note?: string | null; isVoid?: boolean;
}): Promise<string> {
  const r = await loose.rpc('vehicle_register_rectify', {
    _line: p.lineId, _entered_at: p.enteredAt ?? null, _vin: p.vin ?? null, _plate: p.plate ?? null, _nature: p.nature ?? null,
    _left_at: p.leftAt ?? null, _invoice_ref: p.invoiceRef ?? null, _reason: p.reason ?? null, _note: p.note ?? null, _void: !!p.isVoid,
  });
  return unwrap<string>(r);
}

export async function runBackfill(companyId: string, from: string): Promise<{ inserted: number; skipped: number }> {
  const r = await loose.rpc('vehicle_register_backfill', { _company: companyId, _from: from });
  const d = unwrap<{ inserted: number; skipped: number }[] | { inserted: number; skipped: number } | null>(r);
  const row = (Array.isArray(d) ? d[0] : d) ?? { inserted: 0, skipped: 0 };
  return { inserted: Number(row.inserted), skipped: Number(row.skipped) };
}

/** Telechargement d'un fichier texte (CSV) cote navigateur. */
export function downloadText(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
