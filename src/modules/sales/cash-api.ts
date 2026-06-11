/**
 * M6 (POS) — Caisse : sessions (fond de caisse), mouvements de fond de caisse,
 * clôture/journal Z. Réf. G8 Facturation p.128-131, p.164-179.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type CashSession = Database['public']['Tables']['cash_sessions']['Row'];
export type CashMovement = Database['public']['Tables']['cash_movements']['Row'];

/** Session ouverte de la société (au plus une à la fois), sinon null. */
export async function getOpenSession(companyId: string): Promise<CashSession | null> {
  const { data, error } = await supabase
    .from('cash_sessions').select('*').eq('company_id', companyId).eq('status', 'open')
    .order('opened_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function listSessions(companyId: string): Promise<CashSession[]> {
  const { data, error } = await supabase
    .from('cash_sessions').select('*').eq('company_id', companyId)
    .order('opened_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function openSession(companyId: string, openingFloat: number, note?: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('cash_sessions').insert({
    company_id: companyId, opening_float: openingFloat, opened_by: user?.id ?? null, note: note ?? null,
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function closeSession(sessionId: string, countedCash: number, denominations: Record<string, number>): Promise<void> {
  const { error } = await supabase.from('cash_sessions').update({
    status: 'closed', closed_at: new Date().toISOString(),
    counted_cash: countedCash, denominations,
  }).eq('id', sessionId);
  if (error) throw error;
}

export async function listSessionMovements(companyId: string, fromISO: string, toISO: string): Promise<CashMovement[]> {
  const { data, error } = await supabase
    .from('cash_movements').select('*').eq('company_id', companyId)
    .gte('occurred_at', fromISO).lt('occurred_at', toISO).order('occurred_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addMovement(companyId: string, sessionId: string | null, kind: 'in' | 'out', amount: number, method: string, reason: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('cash_movements').insert({
    company_id: companyId, session_id: sessionId, kind, amount: Math.abs(amount), method, reason, operator_id: user?.id ?? null,
  });
  if (error) throw error;
}

export type ZPaymentRow = { method: string; sales: number; deposits: number; refunds: number; total: number };
export type ZVatRow = { vat_rate: number; base_ht: number; vat: number };
export type ZReport = { payments_by_method: ZPaymentRow[]; vat_breakdown: ZVatRow[]; cash_in: number; cash_out: number };

/** Journal Z d'une période (encaissements par mode, ventilation TVA, mouvements de caisse). */
export async function getZReport(companyId: string, fromISO: string, toISO: string): Promise<ZReport> {
  const { data, error } = await supabase.rpc('cash_z_report', { _company: companyId, _from: fromISO, _to: toISO });
  if (error) throw error;
  const r = (data ?? {}) as Partial<ZReport>;
  return {
    payments_by_method: (r.payments_by_method ?? []).map((p) => ({
      method: p.method, sales: Number(p.sales), deposits: Number(p.deposits), refunds: Number(p.refunds), total: Number(p.total),
    })),
    vat_breakdown: (r.vat_breakdown ?? []).map((v) => ({ vat_rate: Number(v.vat_rate), base_ht: Number(v.base_ht), vat: Number(v.vat) })),
    cash_in: Number(r.cash_in ?? 0), cash_out: Number(r.cash_out ?? 0),
  };
}
