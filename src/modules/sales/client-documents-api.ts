/**
 * M6 — Lectures des onglets « Documents clients » (G8 Facturation › Documents clients) qui ne sont
 * pas des listes de documents de vente : disponibilité des réservations, réparations (OR) et leur
 * disponibilité, acomptes, régularisations, compensations, cessions. Filtres communs : période,
 * client, opérateur. Lecture seule. Lot G8 du 18/11/2026.
 */
import { supabase } from '@/integrations/supabase/client';
import { contactDisplayName } from '@/modules/contacts/api';
import { listStock } from '@/modules/stock/stock-api';
import { computeDocAvailability, type AvailabilityStatus } from './availability';
import { isRegularisation, type PaymentKind } from './client-documents';

export type ClientDocFilters = { dateFrom: string; dateTo: string; contactId: string | null; operatorUserId: string | null; operatorName: string | null };

type ContactEmbed = { type: string | null; company_name: string | null; first_name: string | null; last_name: string | null } | null;
const nameOf = (c: ContactEmbed) => (c ? contactDisplayName(c) : null);
const LIMIT = 1000;

// ---------------------------------------------------------------------------------------------
// Disponibilité des réservations (RES / BC ouverts) et des réparations (OR ouverts)
// ---------------------------------------------------------------------------------------------

export type AvailabilityRow = {
  id: string; kind: 'document' | 'or'; number: string | null; doc_type: string; date: string; contact_name: string | null;
  total_ttc: number; deposit: number; status: string; availability: { status: AvailabilityStatus; pct: number } | null;
};

export async function listReservationAvailability(companyId: string, f: ClientDocFilters): Promise<AvailabilityRow[]> {
  let q = supabase.from('documents').select('id, number, doc_type, issue_date, total_ttc, paid_amount, status, contact:contacts!documents_contact_id_fkey(type, company_name, first_name, last_name)')
    .eq('company_id', companyId).in('doc_type', ['RES', 'BC']).in('status', ['validee', 'payee']).order('issue_date', { ascending: false });
  if (f.dateFrom) q = q.gte('issue_date', f.dateFrom);
  if (f.dateTo) q = q.lte('issue_date', f.dateTo);
  if (f.contactId) q = q.eq('contact_id', f.contactId);
  if (f.operatorUserId) q = q.eq('operator_user_id', f.operatorUserId);
  const { data, error } = await q.limit(LIMIT);
  if (error) throw error;
  const docs = (data ?? []) as unknown as { id: string; number: string | null; doc_type: string; issue_date: string; total_ttc: number; paid_amount: number; status: string; contact: ContactEmbed }[];
  const ids = docs.map((d) => d.id);
  const [lines, stock] = await Promise.all([
    ids.length ? fetchInChunks(ids, (chunk) => supabase.from('document_lines').select('document_id, article_id, quantity').in('document_id', chunk)) : Promise.resolve([]),
    listStock(companyId),
  ]);
  const stockMap = new Map(stock.map((r) => [r.article_id, r.available_qty]));
  return docs.map((d) => ({
    id: d.id, kind: 'document', number: d.number, doc_type: d.doc_type, date: d.issue_date, contact_name: nameOf(d.contact),
    total_ttc: Number(d.total_ttc), deposit: Number(d.paid_amount), status: d.status,
    availability: computeDocAvailability((lines as { document_id: string; article_id: string | null; quantity: number }[]).filter((l) => l.document_id === d.id), stockMap),
  }));
}

export type RepairRow = {
  id: string; number: string | null; date: string; contact_name: string | null; status: string; operator: string | null;
  total_ht: number; total_ttc: number; invoice_document_id: string | null;
};

/** OR de la période (G8 onglet « Réparations »). L'opérateur d'un OR est un texte : filtre par nom. */
export async function listRepairOrdersFor(companyId: string, f: ClientDocFilters, openOnly = false): Promise<RepairRow[]> {
  let q = supabase.from('repair_orders').select('id, number, created_at, status, operator, total_ht, total_ttc, invoice_document_id, contact:contacts!repair_orders_contact_id_fkey(type, company_name, first_name, last_name)')
    .eq('company_id', companyId).order('created_at', { ascending: false });
  if (f.dateFrom) q = q.gte('created_at', `${f.dateFrom}T00:00:00`);
  if (f.dateTo) q = q.lte('created_at', `${f.dateTo}T23:59:59`);
  if (f.contactId) q = q.eq('contact_id', f.contactId);
  if (f.operatorName) q = q.ilike('operator', `%${f.operatorName}%`);
  if (openOnly) q = q.not('status', 'in', '("facture","annule")');
  const { data, error } = await q.limit(LIMIT);
  if (error) throw error;
  return ((data ?? []) as unknown as (Omit<RepairRow, 'date' | 'contact_name'> & { created_at: string; contact: ContactEmbed })[]).map((r) => ({
    id: r.id, number: r.number, date: r.created_at.slice(0, 10), contact_name: nameOf(r.contact), status: r.status, operator: r.operator,
    total_ht: Number(r.total_ht), total_ttc: Number(r.total_ttc), invoice_document_id: r.invoice_document_id,
  }));
}

/** OR ouverts avec la disponibilité de leurs pièces (G8 « Disponibilité réparations »). */
export async function listRepairAvailability(companyId: string, f: ClientDocFilters): Promise<AvailabilityRow[]> {
  const ors = await listRepairOrdersFor(companyId, f, true);
  const ids = ors.map((o) => o.id);
  const [lines, stock] = await Promise.all([
    ids.length ? fetchInChunks(ids, (chunk) => supabase.from('repair_order_lines').select('or_id, article_id, quantity, is_warranty').in('or_id', chunk)) : Promise.resolve([]),
    listStock(companyId),
  ]);
  const stockMap = new Map(stock.map((r) => [r.article_id, r.available_qty]));
  return ors.map((o) => ({
    id: o.id, kind: 'or', number: o.number, doc_type: 'OR', date: o.date, contact_name: o.contact_name,
    total_ttc: o.total_ttc, deposit: 0, status: o.status,
    availability: computeDocAvailability((lines as { or_id: string; article_id: string | null; quantity: number }[]).filter((l) => l.or_id === o.id), stockMap),
  }));
}

// ---------------------------------------------------------------------------------------------
// Acomptes, régularisations, compensations
// ---------------------------------------------------------------------------------------------

export type PaymentListRow = {
  id: string; paid_at: string; method: string; amount: number; status: string; note: string | null;
  document_id: string; doc_type: string; number: string | null; issue_date: string; contact_name: string | null;
};

/** Règlements d'un genre (acomptes, régularisations, compensations) sur la période. */
export async function listPaymentsOfKind(companyId: string, f: ClientDocFilters, kind: PaymentKind): Promise<PaymentListRow[]> {
  const docTypes = kind === 'deposit' ? ['DEV', 'BC', 'RES', 'BL', 'ACD'] : kind === 'regularisation' ? ['FAC', 'TIK', 'FAA'] : ['FAC', 'TIK', 'FAA', 'AVO'];
  let q = supabase.from('document_payments')
    .select('id, paid_at, method, amount, status, note, document_id, doc:documents!inner(doc_type, number, issue_date, company_id, contact_id, operator_user_id, contact:contacts!documents_contact_id_fkey(type, company_name, first_name, last_name))')
    .eq('doc.company_id', companyId).in('doc.doc_type', docTypes).neq('amount', 0)
    .order('paid_at', { ascending: false });
  if (kind === 'compensation') q = q.eq('method', 'AVO');
  else q = q.eq('status', 'recu').neq('method', 'AVO');
  if (f.dateFrom) q = q.gte('paid_at', `${f.dateFrom}T00:00:00`);
  if (f.dateTo) q = q.lte('paid_at', `${f.dateTo}T23:59:59`);
  if (f.contactId) q = q.eq('doc.contact_id', f.contactId);
  if (f.operatorUserId) q = q.eq('doc.operator_user_id', f.operatorUserId);
  const { data, error } = await q.limit(LIMIT);
  if (error) throw error;
  type Raw = { id: string; paid_at: string; method: string; amount: number; status: string; note: string | null; document_id: string;
    doc: { doc_type: string; number: string | null; issue_date: string; contact: ContactEmbed } };
  return ((data ?? []) as unknown as Raw[])
    .filter((p) => kind !== 'regularisation' || isRegularisation({ paid_at: p.paid_at, issue_date: p.doc.issue_date, note: p.note }))
    // Un acompte reporté (« Acompte reporté … ») est le même argent que l'acompte d'origine : pas compté deux fois.
    .filter((p) => kind !== 'deposit' || !/^acompte report/i.test(p.note ?? ''))
    .map((p) => ({
      id: p.id, paid_at: p.paid_at, method: p.method, amount: Number(p.amount), status: p.status, note: p.note,
      document_id: p.document_id, doc_type: p.doc.doc_type, number: p.doc.number, issue_date: p.doc.issue_date, contact_name: nameOf(p.doc.contact),
    }));
}

// ---------------------------------------------------------------------------------------------
// Cessions internes (stock_moves de type cession)
// ---------------------------------------------------------------------------------------------

export type CessionRow = { id: number; occurred_at: string; reference: string | null; designation: string | null; qty: number; cession_type: string | null; note: string | null; value: number | null };

export async function listCessionsFor(companyId: string, f: ClientDocFilters): Promise<CessionRow[]> {
  let q = supabase.from('stock_moves').select('id, occurred_at, qty_delta, ref, note, unit_cost, article:articles!stock_moves_article_id_fkey(reference, designation, pamp)')
    .eq('company_id', companyId).eq('move_type', 'cession').order('occurred_at', { ascending: false });
  if (f.dateFrom) q = q.gte('occurred_at', `${f.dateFrom}T00:00:00`);
  if (f.dateTo) q = q.lte('occurred_at', `${f.dateTo}T23:59:59`);
  if (f.operatorUserId) q = q.eq('operator_id', f.operatorUserId);
  const { data, error } = await q.limit(LIMIT);
  if (error) throw error;
  type Raw = { id: number; occurred_at: string; qty_delta: number; ref: string | null; note: string | null; unit_cost: number | null; article: { reference: string | null; designation: string | null; pamp: number | null } | null };
  return ((data ?? []) as unknown as Raw[]).map((m) => {
    const qty = Math.abs(Number(m.qty_delta));
    const unit = m.unit_cost != null ? Number(m.unit_cost) : m.article?.pamp != null ? Number(m.article.pamp) : null;
    return {
      id: m.id, occurred_at: m.occurred_at, reference: m.article?.reference ?? null, designation: m.article?.designation ?? null,
      qty, cession_type: m.ref, note: m.note, value: unit == null ? null : Math.round(unit * qty * 100) / 100,
    };
  });
}

/** `.in()` découpé (URL courte) puis recollé. */
async function fetchInChunks<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await run(ids.slice(i, i + 150));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}
