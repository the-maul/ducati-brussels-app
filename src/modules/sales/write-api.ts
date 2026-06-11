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

/** Paramètres du pied de facture (remise globale, mode HT/TTC, détaxe, port, net forcé). */
export type PiedInput = {
  priceMode?: 'ht' | 'ttc';
  taxExempt?: boolean;                 // détaxe : inhibe la TVA (export 0 %)
  globalDiscountPct?: number;          // remise globale en %
  globalDiscountAmount?: number;       // OU remise globale en montant HT
  shippingHt?: number;                 // frais de port HT
  shippingTaxed?: boolean;             // port taxé (défaut) ou non
  shippingVatRate?: number;            // taux TVA du port
  forcedTtc?: number | null;           // net TTC forcé (arrondi facture)
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function lineHtRaw(l: LineInput) {
  return l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
}
function lineTotals(l: LineInput, taxExempt = false) {
  const ht = lineHtRaw(l);
  const ttc = ht * (1 + (taxExempt ? 0 : l.vat_rate || 0) / 100);
  return { ht: r2(ht), ttc: r2(ttc) };
}

/**
 * Totaux d'un document, pied compris. La remise globale s'applique sur le HT des
 * lignes (pas sur le port, G8 p.66) et réduit la TVA au prorata ; la détaxe force la
 * TVA à 0 ; le net TTC forcé écrase le TTC et recalcule la TVA (arrondi de facture).
 */
export function computeTotals(lines: LineInput[], pied: PiedInput = {}) {
  let linesHt = 0, linesVat = 0;
  for (const l of lines) {
    const ht = lineHtRaw(l);
    linesHt += ht;
    linesVat += pied.taxExempt ? 0 : (ht * (l.vat_rate || 0)) / 100;
  }
  // remise globale (sur le HT des lignes uniquement)
  let discount = 0;
  if (pied.globalDiscountPct && pied.globalDiscountPct > 0) discount = (linesHt * pied.globalDiscountPct) / 100;
  else if (pied.globalDiscountAmount && pied.globalDiscountAmount > 0) discount = Math.min(pied.globalDiscountAmount, linesHt);
  const netLinesHt = linesHt - discount;
  const netLinesVat = linesHt > 0 ? linesVat * (netLinesHt / linesHt) : 0;
  // frais de port
  const shipHt = pied.shippingHt || 0;
  const shipVat = !pied.taxExempt && pied.shippingTaxed !== false && shipHt > 0
    ? (shipHt * (pied.shippingVatRate ?? 21)) / 100 : 0;

  let total_ht = r2(netLinesHt + shipHt);
  let total_vat = r2(netLinesVat + shipVat);
  let total_ttc = r2(total_ht + total_vat);
  // net TTC forcé → la TVA absorbe l'écart
  if (pied.forcedTtc != null && pied.forcedTtc > 0) {
    total_ttc = r2(pied.forcedTtc);
    total_vat = r2(total_ttc - total_ht);
  }
  return {
    total_ht, total_vat, total_ttc,
    lines_ht: r2(linesHt), global_discount: r2(discount),
    shipping_vat: r2(shipVat),
  };
}

async function nextNumber(companyId: string, docType: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('next_document_number', { _company: companyId, _doc_type: docType });
  if (error) throw error;
  return (data as string) ?? null;
}

export async function createDocument(p: {
  companyId: string; docType: string; contactId?: string | null; vehicleId?: string | null;
  issueDate: string; dueDate?: string | null; status: 'brouillon' | 'validee'; notes?: string | null;
  lines: LineInput[]; pied?: PiedInput;
}): Promise<string> {
  const pied = p.pied ?? {};
  const { total_ht, total_vat, total_ttc } = computeTotals(p.lines, pied);
  const number = p.status === 'validee' ? await nextNumber(p.companyId, p.docType) : null;

  const { data: doc, error } = await supabase.from('documents').insert({
    company_id: p.companyId, doc_type: p.docType, number, contact_id: p.contactId ?? null,
    vehicle_id: p.vehicleId ?? null, status: p.status, issue_date: p.issueDate, due_date: p.dueDate ?? null,
    notes: p.notes ?? null, total_ht, total_vat, total_ttc,
    price_mode: pied.priceMode ?? 'ttc', tax_exempt: !!pied.taxExempt,
    global_discount_pct: pied.globalDiscountPct ?? 0, global_discount_amount: pied.globalDiscountAmount ?? 0,
    shipping_ht: pied.shippingHt ?? 0, shipping_taxed: pied.shippingTaxed !== false,
    shipping_vat_rate: pied.shippingVatRate ?? 21, forced_ttc: pied.forcedTtc ?? null,
  }).select('id').single();
  if (error) throw error;
  const docId = doc.id as string;

  if (p.lines.length) {
    const rows = p.lines.map((l, i) => {
      const t = lineTotals(l, pied.taxExempt);
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
