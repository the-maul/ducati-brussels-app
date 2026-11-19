/**
 * Encaissements (rattrapage G8, 18/11/2026) — accès base : échéancier, chèques / échéances à
 * venir, relances d'impayés, clients débiteurs / créditeurs, bons d'achat, réglages.
 *
 * Fonctions et tables des migrations 20261118170000 → 20261118174000, ABSENTES de `types.ts`
 * tant qu'elles ne sont pas appliquées (on ne régénère pas les types à la main) : appels typés
 * localement via `rpc` / `from` non typés.
 */
import { supabase } from '@/integrations/supabase/client';
import type { DunningMedia, DunningTemplate } from './dunning';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ------------------------------------------------------------------ réglages */
export type ReceivableSettings = {
  dunning_mode: 'arrete' | 'test' | 'actif'; dunning_test_recipient: string | null; effective_test_recipient: string | null;
  default_installments: number; voucher_validity_days: number; voucher_min_amount: number;
};
export async function getReceivableSettings(companyId: string): Promise<ReceivableSettings> {
  const rows = await rpc<ReceivableSettings[]>('receivable_settings_get', { _company: companyId });
  const r = rows?.[0];
  return {
    dunning_mode: r?.dunning_mode === 'arrete' ? 'arrete' : r?.dunning_mode === 'actif' ? 'actif' : 'test',
    dunning_test_recipient: r?.dunning_test_recipient ?? null,
    effective_test_recipient: r?.effective_test_recipient ?? null,
    default_installments: num(r?.default_installments) || 12,
    voucher_validity_days: num(r?.voucher_validity_days) || 365,
    voucher_min_amount: num(r?.voucher_min_amount),
  };
}
export async function setReceivableSettings(companyId: string, patch: Partial<Omit<ReceivableSettings, 'effective_test_recipient'>>): Promise<void> {
  await rpc('receivable_settings_set', { _company: companyId, _patch: patch });
}

/* ------------------------------------------------------------------ échéancier */
export async function createPaymentSchedule(p: {
  documentId: string; total: number; count: number; firstDue: string; method: string;
  intervalMonths?: number; bank?: string | null; firstCheque?: string | null;
}): Promise<string> {
  return rpc<string>('payment_schedule_create', {
    _document: p.documentId, _total: p.total, _count: p.count, _first_due: p.firstDue, _method: p.method,
    _interval_months: p.intervalMonths ?? 1, _bank: p.bank ?? null, _first_cheque: p.firstCheque ?? null,
  });
}

export async function updateDeferredPayment(paymentId: string, dueDate: string | null, bank: string | null, cheque: string | null): Promise<void> {
  await rpc('payment_deferred_update', { _payment: paymentId, _due_date: dueDate, _bank: bank, _cheque: cheque });
}

export async function cancelInstallments(paymentIds: string[], reason: string): Promise<number> {
  return rpc<number>('payment_installments_cancel', { _payments: paymentIds, _reason: reason });
}

export type DeferredRow = {
  payment_id: string; document_id: string; doc_type: string; number: string | null; issue_date: string;
  contact_id: string | null; contact_code: string | null; contact_name: string | null;
  method: string; method_label: string; due_date: string | null; amount: number; bank_name: string | null;
  cheque_number: string | null; status: 'attendu' | 'recu' | 'annule'; is_overdue: boolean;
  schedule_id: string | null; installment_no: number | null; installments: number | null;
  paid_at: string | null; cancel_reason: string | null;
};
export async function listDeferredPayments(companyId: string, f: {
  dueFrom?: string | null; dueTo?: string | null; contactId?: string | null; asOf?: string | null; withDone?: boolean;
}): Promise<DeferredRow[]> {
  const rows = await rpc<DeferredRow[]>('deferred_payments_list', {
    _company: companyId, _due_from: f.dueFrom || null, _due_to: f.dueTo || null, _contact: f.contactId || null,
    _as_of: f.asOf || new Date().toISOString().slice(0, 10), _with_done: !!f.withDone,
  });
  return (rows ?? []).map((r) => ({ ...r, amount: num(r.amount) }));
}

/* ------------------------------------------------------------------ relances */
export type DunningTemplateRow = DunningTemplate & { id: string; company_id: string };
export async function listDunningTemplates(companyId: string): Promise<DunningTemplateRow[]> {
  const { data, error } = await db.from('dunning_templates').select('*').eq('company_id', companyId).order('level').order('sort_order');
  if (error) throw error;
  return ((data ?? []) as DunningTemplateRow[]).map((t) => ({
    ...t, min_amount: num(t.min_amount), fee_fixed: num(t.fee_fixed), surcharge_pct: num(t.surcharge_pct),
  }));
}
export async function saveDunningTemplate(companyId: string, tpl: Partial<DunningTemplateRow> & { code: string; label: string }): Promise<void> {
  const row = {
    company_id: companyId, code: tpl.code.trim(), label: tpl.label.trim(), level: tpl.level ?? 1, format: tpl.format ?? 'A4',
    min_amount: tpl.min_amount ?? 0, fee_fixed: tpl.fee_fixed ?? 0, surcharge_pct: tpl.surcharge_pct ?? 0,
    subject: tpl.subject ?? '', header_text: tpl.header_text ?? '', body_text: tpl.body_text ?? '',
    closing_text: tpl.closing_text ?? '', footer_text: tpl.footer_text ?? '', is_active: tpl.is_active ?? true,
    sort_order: tpl.sort_order ?? 0,
  };
  const q = tpl.id
    ? db.from('dunning_templates').update(row).eq('id', tpl.id)
    : db.from('dunning_templates').insert(row);
  const { error } = await q;
  if (error) throw error;
}
export async function deleteDunningTemplate(id: string): Promise<void> {
  const { error } = await db.from('dunning_templates').delete().eq('id', id);
  if (error) throw error;
}

export type DunningCandidate = {
  document_id: string; doc_type: string; number: string | null; issue_date: string; due_date: string;
  total_ttc: number; amount_due: number; scheduled: number; contact_id: string; contact_code: string | null;
  contact_name: string; email: string | null; accounting_account: string | null;
  last_code: string | null; last_label: string | null; last_level: number | null; last_date: string | null;
  last_media: DunningMedia | null; last_is_test: boolean | null; next_code: string | null;
};
export async function listDunningCandidates(companyId: string, f: {
  dueTo: string; side?: 'debit' | 'credit'; contactId?: string | null; minAmount?: number; lastCode?: string | null;
}): Promise<DunningCandidate[]> {
  const rows = await rpc<DunningCandidate[]>('dunning_candidates', {
    _company: companyId, _due_to: f.dueTo, _side: f.side ?? 'debit', _contact: f.contactId || null,
    _min_amount: f.minAmount ?? 0, _last_code: f.lastCode ?? null,
  });
  return (rows ?? []).map((r) => ({ ...r, total_ttc: num(r.total_ttc), amount_due: num(r.amount_due), scheduled: num(r.scheduled) }));
}

export type DunningLetterRow = {
  id: string; batch_id: string; contact_id: string | null; document_id: string | null; template_code: string;
  template_label: string | null; level: number; media: DunningMedia; sent_to: string | null; is_test: boolean;
  with_invoice: boolean; amount_due: number; fees: number; subject: string | null; sent_at: string;
  documents?: { number: string | null } | null;
};
export async function recordDunningLetters(companyId: string, rows: Omit<DunningLetterRow, 'id' | 'sent_at' | 'documents'>[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from('dunning_letters').insert(rows.map((r) => ({ ...r, company_id: companyId })));
  if (error) throw error;
}
export async function listContactDunningLetters(contactId: string): Promise<DunningLetterRow[]> {
  const { data, error } = await db.from('dunning_letters').select('*, documents(number)').eq('contact_id', contactId).order('sent_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as DunningLetterRow[];
}

/* ------------------------------------------------------------------ débiteurs / créditeurs */
export type DebtorDetailRow = {
  contact_id: string; contact_code: string | null; contact_name: string; accounting_account: string | null; email: string | null;
  document_id: string; doc_type: string; number: string | null; issue_date: string; due_date: string;
  total_ttc: number; amount_due: number; scheduled: number;
  last_code: string | null; last_label: string | null; last_date: string | null; last_media: string | null;
};
export async function listDebtorsDetailed(companyId: string, f: {
  dueFrom?: string | null; dueTo?: string | null; asOf?: string | null; contactId?: string | null;
  side?: 'debit' | 'credit'; onlyScheduled?: boolean;
}): Promise<DebtorDetailRow[]> {
  const rows = await rpc<DebtorDetailRow[]>('debtors_detailed', {
    _company: companyId, _due_from: f.dueFrom || null, _due_to: f.dueTo || null,
    _as_of: f.asOf || new Date().toISOString().slice(0, 10), _contact: f.contactId || null,
    _side: f.side ?? 'debit', _only_scheduled: !!f.onlyScheduled,
  });
  return (rows ?? []).map((r) => ({ ...r, total_ttc: num(r.total_ttc), amount_due: num(r.amount_due), scheduled: num(r.scheduled) }));
}

/* ------------------------------------------------------------------ bons d'achat */
export type VoucherRow = {
  id: string; number: string; contact_id: string | null; contact_code: string | null; contact_name: string | null;
  email: string | null; mobile: string | null; amount: number; remaining: number; valid_from: string; valid_until: string;
  status: 'actif' | 'utilise' | 'annule'; effective_status: 'actif' | 'utilise' | 'annule' | 'expire';
  origin: 'vente' | 'geste' | 'avoir' | 'autre'; note: string | null; created_at: string;
};
export async function listVouchers(companyId: string, status: string | null, contactId?: string | null): Promise<VoucherRow[]> {
  const rows = await rpc<VoucherRow[]>('vouchers_list', { _company: companyId, _status: status, _contact: contactId ?? null });
  return (rows ?? []).map((r) => ({ ...r, amount: num(r.amount), remaining: num(r.remaining) }));
}
export async function createVoucher(companyId: string, p: {
  amount: number; contactId?: string | null; validFrom?: string | null; validUntil?: string | null;
  origin?: VoucherRow['origin']; note?: string | null;
}): Promise<string> {
  return rpc<string>('voucher_create', {
    _company: companyId, _amount: p.amount, _contact: p.contactId || null, _valid_from: p.validFrom || null,
    _valid_until: p.validUntil || null, _origin: p.origin ?? 'geste', _note: p.note ?? null, _source_document: null,
  });
}
export async function cancelVoucher(id: string, reason: string): Promise<void> {
  await rpc('voucher_cancel', { _voucher: id, _reason: reason });
}
/** Bons utilisables au comptoir (actifs, valables aujourd'hui, solde > 0). */
export async function listUsableVouchers(companyId: string): Promise<VoucherRow[]> {
  const rows = await listVouchers(companyId, 'actif');
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter((v) => v.remaining > 0.005 && v.valid_from <= today && v.valid_until >= today);
}

/* ------------------------------------------------------------------ contacts (recherche simple) */
export type ContactPick = { id: string; code: string | null; name: string };
export async function searchContacts(companyId: string, term: string): Promise<ContactPick[]> {
  const t = term.trim();
  let q = supabase.from('contacts').select('id, code, first_name, last_name, company_name').eq('company_id', companyId).limit(30);
  if (t) {
    const s = t.replace(/[%,()]/g, ' ');
    q = q.or(`last_name.ilike.%${s}%,first_name.ilike.%${s}%,company_name.ilike.%${s}%,code.ilike.%${s}%`);
  }
  const { data, error } = await q.order('last_name');
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id, code: (c.code as string | null) ?? null,
    name: c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—',
  }));
}
