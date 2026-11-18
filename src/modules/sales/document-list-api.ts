/**
 * M6 — Lecture paginée des documents de vente (G8 « Liste des factures », « Documents clients »).
 * Chemin normal : fonction SQL `sales_document_list` (migration 20261118160000) = pagination,
 * filtres, colonnes calculées et totaux sur TOUTE la sélection côté serveur. Tant que la migration
 * n'est pas posée : repli sur une lecture directe paginée (`range`) avec compte exact ; totaux
 * relus par paquets de 1 000 ; marge = marge G8 reprise seulement (sinon « — »).
 */
import { supabase } from '@/integrations/supabase/client';
import { contactDisplayName } from '@/modules/contacts/api';
import {
  filtersToRpc, totalsOf, docDue, fiscalBounds,
  type DocListFilters, type DocListPage, type DocListRow, type DocListTotals, type DocListPayment,
} from './document-list';

const rpcLoose = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const isMissingFn = (e: { code?: string; message: string }) => e.code === 'PGRST202' || e.code === '42883' || /Could not find the function|does not exist/i.test(e.message);

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);

type RpcTotals = { count: number; sales_count: number; ht: number; vat: number; ttc: number; sales_ht: number; sales_ttc: number; due: number; discount: number; deposit: number; margin: number };

function rowFromRpc(r: Record<string, unknown>): DocListRow {
  return {
    id: String(r.id), doc_type: String(r.doc_type), number: (r.number as string) ?? null, legacy_number: (r.legacy_number as string) ?? null,
    status: String(r.status), issue_date: String(r.issue_date), due_date: (r.due_date as string) ?? null, created_at: (r.created_at as string) ?? null,
    contact_id: (r.contact_id as string) ?? null, contact_name: (r.contact_name as string) ?? null, contact_code: (r.contact_code as string) ?? null,
    contact_kind: (r.contact_kind as string) ?? null, operator: (r.operator as string) ?? null, operator_user_id: (r.operator_user_id as string) ?? null,
    total_ht: num(r.total_ht), total_vat: num(r.total_vat), total_ttc: num(r.total_ttc), paid_amount: num(r.paid_amount),
    due: num(r.due), discount: num(r.discount), deposit: num(r.deposit), margin: r.margin == null ? null : num(r.margin),
    tax_exempt: !!r.tax_exempt, condition_reglement: (r.condition_reglement as string) ?? null,
    compta_transferred: !!r.compta_transferred, date_transfert: (r.date_transfert as string) ?? null,
    notes: (r.notes as string) ?? null, source_document_id: (r.source_document_id as string) ?? null, vehicle_id: (r.vehicle_id as string) ?? null,
    payments: ((r.payments as DocListPayment[] | null) ?? []).map((p) => ({ method: p.method, amount: num(p.amount), status: p.status })),
  };
}

function totalsFromRpc(t: RpcTotals): DocListTotals {
  return {
    count: num(t.count), salesCount: num(t.sales_count), ht: num(t.ht), vat: num(t.vat), ttc: num(t.ttc),
    salesHt: num(t.sales_ht), salesTtc: num(t.sales_ttc), due: num(t.due), discount: num(t.discount), deposit: num(t.deposit),
    margin: t.margin == null ? null : num(t.margin),
  };
}

/** Une page de documents (offset / limite) avec le total et les totaux de toute la sélection. */
export async function listDocumentsPage(companyId: string, f: DocListFilters, offset: number, limit: number): Promise<DocListPage> {
  const { data, error } = await rpcLoose('sales_document_list', { _company: companyId, _filters: filtersToRpc(f), _offset: offset, _limit: limit });
  if (!error) {
    const d = (data ?? {}) as { total?: number; rows?: Record<string, unknown>[]; totals?: RpcTotals };
    return { total: num(d.total), rows: (d.rows ?? []).map(rowFromRpc), totals: totalsFromRpc(d.totals ?? ({} as RpcTotals)), marginExact: true };
  }
  if (!isMissingFn(error)) throw error;
  return fallbackPage(companyId, f, offset, limit);
}

/**
 * Toute la sélection (impression par plage, envoi groupé, export Excel), par pages de 500.
 * Plafond de sécurité : 5 000 documents (au-delà, restreindre la période).
 */
export const FETCH_ALL_CAP = 5000;
export async function listAllDocuments(companyId: string, f: DocListFilters): Promise<{ rows: DocListRow[]; truncated: boolean }> {
  const rows: DocListRow[] = [];
  let total = Infinity;
  for (let off = 0; off < total && off < FETCH_ALL_CAP; off += 500) {
    const page = await listDocumentsPage(companyId, f, off, 500);
    total = page.total;
    rows.push(...page.rows);
    if (page.rows.length < 500) break;
  }
  return { rows, truncated: total > FETCH_ALL_CAP };
}

// ---------------------------------------------------------------------------------------------
// Repli sans la migration 20261118160000
// ---------------------------------------------------------------------------------------------

type ContactEmbed = { type: string | null; code: string | null; legacy_code: string | null; company_name: string | null; first_name: string | null; last_name: string | null } | null;

/** Requête filtrée (mêmes règles que la fonction SQL, sauf recherche par nom de client). */
function filteredQuery(companyId: string, f: DocListFilters, select: string, count: boolean) {
  const fy = fiscalBounds(f.fiscal);
  const from = [fy.from, f.dateFrom || null].filter(Boolean).sort().pop() ?? null;
  const to = [fy.to, f.dateTo || null].filter(Boolean).sort()[0] ?? null;
  // Pro / public : jointure obligatoire sur la fiche client.
  const embed = f.clientKind !== 'all'
    ? 'contact:contacts!documents_contact_id_fkey!inner(type, code, legacy_code, company_name, first_name, last_name)'
    : 'contact:contacts!documents_contact_id_fkey(type, code, legacy_code, company_name, first_name, last_name)';
  let q = supabase.from('documents').select(`${select}, ${embed}`, count ? { count: 'exact' } : undefined)
    .eq('company_id', companyId).in('doc_type', f.docTypes);
  if (!f.includeDrafts) q = q.neq('status', 'brouillon');
  if (f.statuses?.length) q = q.in('status', f.statuses);
  if (from) q = q.gte('issue_date', from);
  if (to) q = q.lte('issue_date', to);
  if (f.numberFrom.trim()) q = q.gte('number', f.numberFrom.trim());
  if (f.numberTo.trim()) q = q.lte('number', f.numberTo.trim());
  const amin = Number(f.amountMin.replace(',', '.')); if (f.amountMin.trim() && Number.isFinite(amin)) q = q.gte('total_ttc', amin);
  const amax = Number(f.amountMax.replace(',', '.')); if (f.amountMax.trim() && Number.isFinite(amax)) q = q.lte('total_ttc', amax);
  if (f.contactId) q = q.eq('contact_id', f.contactId);
  if (f.operatorUserId) q = q.eq('operator_user_id', f.operatorUserId);
  if (f.clientKind === 'pro') q = q.eq('contact.type', 'professionnel');
  if (f.clientKind === 'public') q = q.neq('contact.type', 'professionnel');
  if (f.transfer === 'done') q = q.eq('compta_transferred', true);
  if (f.transfer === 'pending') q = q.eq('compta_transferred', false);
  const s = f.search.trim().replace(/[,()]/g, ' ');
  if (s) q = q.or(`number.ilike.%${s}%,legacy_number.ilike.%${s}%`);
  return q;
}

async function fallbackPage(companyId: string, f: DocListFilters, offset: number, limit: number): Promise<DocListPage> {
  let q = filteredQuery(companyId, f, '*', true);
  const asc = f.sort === 'date_asc' || f.sort === 'number_asc';
  const col = f.sort.startsWith('number') ? 'number' : f.sort === 'amount_desc' ? 'total_ttc' : 'issue_date';
  q = q.order(col, { ascending: asc }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  const docs = (data ?? []) as unknown as (Record<string, unknown> & { contact: ContactEmbed })[];
  const ids = docs.map((d) => String(d.id));
  const pays = ids.length
    ? ((await supabase.from('document_payments').select('document_id, method, amount, status, note, paid_at').in('document_id', ids).order('paid_at')).data ?? [])
    : [];
  const rows = docs.map((d) => {
    const mine = pays.filter((p) => p.document_id === d.id && Number(p.amount) !== 0);
    const c = d.contact;
    const row: DocListRow = rowFromRpc({
      ...d,
      contact_name: c ? contactDisplayName({ company_name: c.company_name, first_name: c.first_name, last_name: c.last_name, type: c.type }) : null,
      contact_code: c?.legacy_code ?? c?.code ?? (d.code_client_legacy as string | null) ?? null,
      contact_kind: c?.type ?? null,
      due: docDue({ doc_type: String(d.doc_type), total_ttc: num(d.total_ttc), paid_amount: num(d.paid_amount) }),
      discount: d.remise_ttc != null ? num(d.remise_ttc) : num(d.global_discount_amount),
      deposit: mine.filter((p) => p.status === 'recu' && /^acompte/i.test(String(p.note ?? ''))).reduce((s, p) => s + Number(p.amount), 0),
      margin: d.marge == null ? null : num(d.marge),
      payments: mine.filter((p) => p.status === 'recu' || p.status === 'attendu'),
    });
    return row;
  });
  return { total: count ?? rows.length, rows, totals: await fallbackTotals(companyId, f), marginExact: false };
}

async function fallbackTotals(companyId: string, f: DocListFilters): Promise<DocListTotals> {
  const light: DocListRow[] = [];
  for (let off = 0; off < 20000; off += 1000) {
    const { data, error } = await filteredQuery(companyId, f, 'id, doc_type, total_ht, total_vat, total_ttc, paid_amount, marge, remise_ttc, global_discount_amount', false)
      .range(off, off + 999);
    if (error) throw error;
    for (const d of (data ?? []) as unknown as Record<string, unknown>[]) {
      light.push({
        doc_type: String(d.doc_type), total_ht: num(d.total_ht), total_vat: num(d.total_vat), total_ttc: num(d.total_ttc),
        due: docDue({ doc_type: String(d.doc_type), total_ttc: num(d.total_ttc), paid_amount: num(d.paid_amount) }),
        discount: d.remise_ttc != null ? num(d.remise_ttc) : num(d.global_discount_amount), deposit: 0,
        margin: d.marge == null ? null : num(d.marge),
      } as DocListRow);
    }
    if ((data ?? []).length < 1000) break;
  }
  return totalsOf(light);
}
