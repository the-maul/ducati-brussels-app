/**
 * M6 (POS) — Remises en banque (rattrapage G8 du 18/11/2026, PDV009), types de mouvement de caisse,
 * banques, fond proposé à l'ouverture et données des journaux de caisse (PDV008).
 *
 * Tout passe par les fonctions SQL des migrations 20261118150000 / 20261118151000 (création, annulation,
 * modification motivées et tracées dans `events`, aucune écriture directe des remises). Tant que ces
 * migrations ne sont pas posées, les lectures renvoient « indisponible » (`DepositsUnavailable`) et la
 * caisse fonctionne comme avant. Les tables et fonctions sont typées ici (types.ts n'est pas régénéré).
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingDbObject } from './write-api';
import { parseJournalData, type JournalData } from './cash-journals';
import type { DepositKind, DepositSourceType } from './cash-deposit-rules';

/** Client sans typage des tables / fonctions ajoutées par les migrations du 18/11 (types.ts non régénéré). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Les migrations du 18/11 ne sont pas encore posées. */
export class DepositsUnavailable extends Error {
  constructor() { super('deposits-unavailable'); }
}
const guard = (error: unknown): never => {
  if (isMissingDbObject(error)) throw new DepositsUnavailable();
  throw error;
};

export type CashMovementType = { code: string; label: string; direction: 'in' | 'out' | 'both'; vatRate: number | null; account: string | null; system: boolean };
export type BankAccount = { code: string; label: string; iban: string | null; bic: string | null };

export type DepositCandidate = {
  source_type: DepositSourceType; source_id: string; occurred_at: string; label: string | null; contact_label: string | null;
  document_number: string | null; amount: number; deposit_id: string | null; deposit_number: number | null;
};

export type CashDeposit = {
  id: string; company_id: string; number: number; method: string; kind: DepositKind; status: 'active' | 'annulee';
  register_code: string; period_from: string | null; period_to: string; deposit_date: string;
  lines_total: number; deposited_amount: number; new_float: number | null; line_count: number;
  bank_code: string | null; bank_label: string | null; bank_iban: string | null; bank_bic: string | null;
  comment: string | null; session_id: string | null; created_by: string | null; created_at: string;
  amended_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
};
export type CashDepositLine = {
  id: string; deposit_id: string; source_type: DepositSourceType; source_id: string; occurred_at: string; label: string | null;
  contact_label: string | null; document_number: string | null; amount: number; active: boolean;
};
export type CashDepositComment = { id: string; deposit_id: string; body: string; created_by: string | null; created_at: string };

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Types de mouvement de caisse actifs (Paramètres → Tables → Types de mouvement de caisse). */
export async function listMovementTypes(companyId: string): Promise<CashMovementType[]> {
  const { data, error } = await supabase.from('reference_values').select('code, label, extra, sort_order')
    .eq('company_id', companyId).eq('table_key', 'cash_movement_type').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = (r.extra ?? {}) as { direction?: string; vat_rate?: number | string; account?: string; system?: boolean };
    const rate = x.vat_rate == null || x.vat_rate === '' ? null : Number(x.vat_rate);
    return {
      code: r.code, label: r.label,
      direction: x.direction === 'in' || x.direction === 'out' ? x.direction : 'both',
      vatRate: rate && rate > 0 ? rate : null, account: x.account?.trim() || null, system: x.system === true,
    };
  });
}

/** Banques de remise (Paramètres → Tables → Banques de remise). */
export async function listBankAccounts(companyId: string): Promise<BankAccount[]> {
  const { data, error } = await supabase.from('reference_values').select('code, label, extra, sort_order')
    .eq('company_id', companyId).eq('table_key', 'bank_account').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = (r.extra ?? {}) as { iban?: string; bic?: string };
    return { code: r.code, label: r.label, iban: x.iban ?? null, bic: x.bic ?? null };
  });
}

/**
 * Mouvement de fond de caisse typé (G8 : type, mode, commentaire, montant, confirmation). La base pose
 * le numéro, contrôle le sens du type, calcule la TVA comprise et reprend le compte du type. Avant la
 * migration, retombe sur le mouvement simple (motif libre).
 */
export async function addTypedMovement(companyId: string, sessionId: string | null, input: { kind: 'in' | 'out'; amount: number; method: string; reason: string; typeCode: string | null }): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const base = { company_id: companyId, session_id: sessionId, kind: input.kind, amount: Math.abs(input.amount), method: input.method, reason: input.reason, operator_id: user?.id ?? null };
  const { error } = await db.from('cash_movements').insert(input.typeCode ? { ...base, type_code: input.typeCode } : base);
  if (!error) return;
  if (input.typeCode && isMissingDbObject(error)) {
    const { error: e2 } = await supabase.from('cash_movements').insert(base);
    if (e2) throw e2;
    return;
  }
  throw error;
}

/** Espèces du tiroir = fond proposé à l'ouverture suivante ; null avant la migration. */
export async function getDrawerBalance(companyId: string): Promise<number | null> {
  const { data, error } = await db.rpc('cash_drawer_balance', { _company: companyId });
  if (error) { if (isMissingDbObject(error)) return null; throw error; }
  return num(data);
}

export async function listDepositCandidates(companyId: string, method: string, fromISO: string | null, toISO: string, includeDeposited: boolean): Promise<DepositCandidate[]> {
  const { data, error } = await db.rpc('cash_deposit_candidates', { _company: companyId, _method: method, _from: fromISO, _to: toISO, _include_deposited: includeDeposited });
  if (error) guard(error);
  return ((data ?? []) as DepositCandidate[]).map((r) => ({ ...r, amount: num(r.amount), deposit_number: r.deposit_number == null ? null : num(r.deposit_number) }));
}

export async function listDeposits(companyId: string, method?: string | null): Promise<CashDeposit[]> {
  let q = db.from('cash_deposits').select('*').eq('company_id', companyId);
  if (method) q = q.eq('method', method);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) guard(error);
  return ((data ?? []) as CashDeposit[]).map((d) => ({ ...d, lines_total: num(d.lines_total), deposited_amount: num(d.deposited_amount), new_float: d.new_float == null ? null : num(d.new_float) }));
}

/** Dernière remise active d'un mode (date de début proposée : G8 « depuis le dernier report »). */
export async function lastActiveDeposit(companyId: string, method: string): Promise<CashDeposit | null> {
  const { data, error } = await db.from('cash_deposits').select('*').eq('company_id', companyId).eq('method', method)
    .eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) guard(error);
  return (data as CashDeposit | null) ?? null;
}

export async function getDepositLines(depositId: string): Promise<CashDepositLine[]> {
  const { data, error } = await db.from('cash_deposit_lines').select('*').eq('deposit_id', depositId).order('occurred_at');
  if (error) guard(error);
  return ((data ?? []) as CashDepositLine[]).map((l) => ({ ...l, amount: num(l.amount) }));
}

export async function listDepositComments(depositId: string): Promise<CashDepositComment[]> {
  const { data, error } = await db.from('cash_deposit_comments').select('*').eq('deposit_id', depositId).order('created_at');
  if (error) guard(error);
  return (data ?? []) as CashDepositComment[];
}

export async function addDepositComment(companyId: string, depositId: string, body: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await db.from('cash_deposit_comments').insert({ company_id: companyId, deposit_id: depositId, body: body.trim(), created_by: user?.id ?? null });
  if (error) guard(error);
}

export type CreateDepositInput = {
  companyId: string; method: string; kind: DepositKind; fromISO: string | null; toISO: string; depositDate: string;
  items: { type: DepositSourceType; id: string }[]; deposited: number; bankCode: string | null; comment: string | null;
};
export async function createDeposit(i: CreateDepositInput): Promise<string> {
  const { data, error } = await db.rpc('cash_deposit_create', {
    _company: i.companyId, _method: i.method, _kind: i.kind, _period_from: i.fromISO, _period_to: i.toISO, _deposit_date: i.depositDate,
    _items: i.items, _deposited: i.deposited, _bank_code: i.bankCode, _comment: i.comment,
  });
  if (error) guard(error);
  return data as string;
}

export async function cancelDeposit(depositId: string, reason: string): Promise<void> {
  const { error } = await db.rpc('cash_deposit_cancel', { _deposit: depositId, _reason: reason });
  if (error) guard(error);
}

export async function amendDeposit(depositId: string, input: { deposited: number; depositDate: string; bankCode: string | null; reason: string }): Promise<void> {
  const { error } = await db.rpc('cash_deposit_amend', { _deposit: depositId, _deposited: input.deposited, _deposit_date: input.depositDate, _bank_code: input.bankCode, _reason: input.reason });
  if (error) guard(error);
}

/** Données des journaux de caisse d'une période (AAAA-MM-JJ, bornes incluses). */
export async function getJournalData(companyId: string, from: string, to: string): Promise<JournalData> {
  const { data, error } = await db.rpc('cash_journal_data', { _company: companyId, _from: from, _to: to });
  if (error) guard(error);
  return parseJournalData(data);
}
