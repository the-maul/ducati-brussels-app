/**
 * M6 — Écriture des documents de vente : création, totaux, numérotation, décrément stock, règlement.
 * Le POS complet (encaissement multi-modes, clôture Z, avoirs) viendra étoffer ce socle.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type DocumentRow = Database['public']['Tables']['documents']['Row'];
export type DocumentLine = Database['public']['Tables']['document_lines']['Row'];

export type LineInput = {
  article_id?: string | null;
  designation: string;
  quantity: number;
  unit_price_ht: number;
  vat_rate: number;
  discount_pct: number;
};

export const SALE_DOC_TYPES = ['FAC', 'TIK', 'BL'] as const; // documents qui sortent du stock

function lineTotals(l: LineInput) {
  const ht = l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
  const ttc = ht * (1 + (l.vat_rate || 0) / 100);
  return { ht: Math.round(ht * 100) / 100, ttc: Math.round(ttc * 100) / 100 };
}

export function computeTotals(lines: LineInput[]) {
  let ht = 0, ttc = 0;
  for (const l of lines) { const t = lineTotals(l); ht += t.ht; ttc += t.ttc; }
  ht = Math.round(ht * 100) / 100; ttc = Math.round(ttc * 100) / 100;
  return { total_ht: ht, total_vat: Math.round((ttc - ht) * 100) / 100, total_ttc: ttc };
}

async function nextNumber(companyId: string, docType: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('next_document_number', { _company: companyId, _doc_type: docType });
  if (error) throw error;
  return (data as string) ?? null;
}

export async function createDocument(p: {
  companyId: string; docType: string; contactId?: string | null; vehicleId?: string | null;
  issueDate: string; dueDate?: string | null; status: 'brouillon' | 'validee'; notes?: string | null; lines: LineInput[];
}): Promise<string> {
  const totals = computeTotals(p.lines);
  const number = p.status === 'validee' ? await nextNumber(p.companyId, p.docType) : null;

  const { data: doc, error } = await supabase.from('documents').insert({
    company_id: p.companyId, doc_type: p.docType, number, contact_id: p.contactId ?? null,
    vehicle_id: p.vehicleId ?? null, status: p.status, issue_date: p.issueDate, due_date: p.dueDate ?? null,
    notes: p.notes ?? null, ...totals,
  }).select('id').single();
  if (error) throw error;
  const docId = doc.id as string;

  if (p.lines.length) {
    const rows = p.lines.map((l, i) => {
      const t = lineTotals(l);
      return {
        document_id: docId, article_id: l.article_id ?? null, designation: l.designation,
        quantity: l.quantity, unit_price_ht: l.unit_price_ht, vat_rate: l.vat_rate,
        discount_pct: l.discount_pct || 0, line_ht: t.ht, line_ttc: t.ttc, sort_order: i,
      };
    });
    const { error: le } = await supabase.from('document_lines').insert(rows);
    if (le) throw le;
  }

  // Décrément de stock à la validation d'un document de vente (B7)
  if (p.status === 'validee' && (SALE_DOC_TYPES as readonly string[]).includes(p.docType)) {
    for (const l of p.lines) {
      if (!l.article_id || l.quantity <= 0) continue;
      const { error: se } = await supabase.rpc('record_stock_move', {
        _article: l.article_id, _type: 'sortie', _qty: -Math.abs(l.quantity), _unit_cost: null,
        _is_reservation: false, _bin: null, _origin: 'sale', _ref: number, _note: null,
      });
      if (se) throw se;
    }
  }
  return docId;
}

export type SaleArticle = { id: string; reference: string; designation: string; sale_price_ht: number; vat_rate: number };
export async function searchSaleArticles(companyId: string, term: string): Promise<SaleArticle[]> {
  const s = term.replace(/[,()%*]/g, ' ').trim();
  let q = supabase.from('articles').select('id, reference, designation, sale_price_ht, vat_rate').eq('company_id', companyId).limit(8);
  if (s) q = q.or(`reference.ilike.%${s}%,designation.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((a) => ({ id: a.id, reference: a.reference, designation: a.designation, sale_price_ht: Number(a.sale_price_ht), vat_rate: Number(a.vat_rate) }));
}

export type DocumentFull = { doc: DocumentRow; lines: DocumentLine[] };
export async function getDocumentFull(id: string): Promise<DocumentFull> {
  const [{ data: doc, error: de }, { data: lines, error: le }] = await Promise.all([
    supabase.from('documents').select('*').eq('id', id).single(),
    supabase.from('document_lines').select('*').eq('document_id', id).order('sort_order'),
  ]);
  if (de) throw de; if (le) throw le;
  return { doc: doc as DocumentRow, lines: lines ?? [] };
}

export async function listDocuments(companyId: string, docType?: string): Promise<DocumentRow[]> {
  let q = supabase.from('documents').select('*').eq('company_id', companyId).order('issue_date', { ascending: false }).limit(100);
  if (docType) q = q.eq('doc_type', docType);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Enregistre un règlement et met à jour le montant réglé / le statut. */
export async function recordPayment(documentId: string, method: string, amount: number): Promise<void> {
  const { error: pe } = await supabase.from('document_payments').insert({ document_id: documentId, method, amount });
  if (pe) throw pe;
  const { data: doc } = await supabase.from('documents').select('total_ttc, paid_amount').eq('id', documentId).single();
  if (doc) {
    const paid = Number(doc.paid_amount) + amount;
    const status = paid + 0.005 >= Number(doc.total_ttc) ? 'payee' : undefined;
    const patch: Record<string, unknown> = { paid_amount: paid };
    if (status) patch.status = status;
    await supabase.from('documents').update(patch).eq('id', documentId);
  }
}
