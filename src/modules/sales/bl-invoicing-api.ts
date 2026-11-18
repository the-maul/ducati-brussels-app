/**
 * M6 — Facturation groupée des bons de livraison (G8 « Génération des factures par B.L. client »).
 * Lecture des BL à facturer et génération des factures : une facture validée par groupe (règles de
 * `bl-invoicing.ts`), acomptes des BL reportés, réservation des BL libérée (la facture sort le
 * stock réel, B4 / B7), BL passés « converti », filiation enregistrée (`document_sources`).
 * Comme la conversion d'un document, l'écriture se fait étape par étape depuis le navigateur :
 * un échec au milieu d'une facture est signalé avec la facture concernée (voir bible M06 §7).
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { contactDisplayName } from '@/modules/contacts/api';
import {
  createDocument, getDocumentFull, rowToLineInput, liberateReservation, docVatScheme, isMissingDbObject,
  type DocumentRow, type LineInput,
} from './write-api';
import {
  groupDeliveryNotes, blHeaderLine, blLinesForInvoice, surchargeLine, dueDateFor,
  type BlCandidate, type BlInvoicingParams,
} from './bl-invoicing';
import { linkSources, transferReceivedPayments } from './document-links-api';

export type BlFilters = { contactId: string | null; dateFrom: string; dateTo: string };

/** BL validés non facturés (ni brouillon, ni convertis, ni annulés) de la période. */
export async function listDeliveryNotesToInvoice(companyId: string, f: BlFilters): Promise<BlCandidate[]> {
  let q = supabase.from('documents')
    .select('*, contact:contacts!documents_contact_id_fkey(type, company_name, first_name, last_name)')
    .eq('company_id', companyId).eq('doc_type', 'BL').in('status', ['validee', 'payee'])
    .order('issue_date').order('number');
  if (f.contactId) q = q.eq('contact_id', f.contactId);
  if (f.dateFrom) q = q.gte('issue_date', f.dateFrom);
  if (f.dateTo) q = q.lte('issue_date', f.dateTo);
  const { data, error } = await q.limit(1000);
  if (error) throw error;
  return ((data ?? []) as unknown as (DocumentRow & { contact: { type: string | null; company_name: string | null; first_name: string | null; last_name: string | null } | null })[]).map((d) => ({
    id: d.id, number: d.number, issue_date: d.issue_date, contact_id: d.contact_id,
    contact_name: d.contact ? contactDisplayName(d.contact) : null,
    condition_reglement: d.condition_reglement, total_ht: Number(d.total_ht), total_ttc: Number(d.total_ttc),
    paid_amount: Number(d.paid_amount), operator: d.operator, tax_exempt: !!d.tax_exempt,
    vat_scheme: docVatScheme(d), notes: d.notes,
  }));
}

/** Conditions de règlement paramétrées (Paramètres → Tables → Conditions de règlement). */
export type PaymentTerm = { code: string; label: string; days: number | null; endOfMonth: boolean };
export async function listPaymentTerms(companyId: string): Promise<PaymentTerm[]> {
  const { data, error } = await supabase.from('reference_values').select('code, label, extra, is_active, sort_order')
    .eq('company_id', companyId).eq('table_key', 'payment_term').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = (r.extra ?? {}) as { days?: number | string | null; eom?: boolean | null };
    const days = x.days == null || x.days === '' ? null : Number(x.days);
    return { code: r.code, label: r.label, days: Number.isFinite(days as number) ? (days as number) : null, endOfMonth: x.eom === true };
  });
}

export type BlInvoiceResult = { invoiceId: string; number: string | null; blNumbers: string[]; error?: undefined }
  | { invoiceId: null; number: null; blNumbers: string[]; error: string };

/**
 * Génère les factures. Une facture par groupe ; un groupe en erreur n'arrête pas les suivants.
 * `labels` : textes déjà traduits (en-tête de BL « Livraison N° {number} du {date} », port, majoration).
 */
export async function invoiceDeliveryNotes(
  companyId: string, selected: BlCandidate[], params: BlInvoicingParams,
  labels: { blHeader: string; shipping: string; surcharge: string },
): Promise<BlInvoiceResult[]> {
  const results: BlInvoiceResult[] = [];
  for (const group of groupDeliveryNotes(selected, params.onePerBl)) {
    const blNumbers = group.map((b) => b.number ?? '');
    try {
      const fulls = await Promise.all(group.map((b) => getDocumentFull(b.id)));
      // Un BL déjà facturé entre-temps (autre poste) : on ne le refacture pas.
      if (fulls.some((f) => f.doc.status === 'converti' || f.doc.doc_type !== 'BL')) throw new Error(t('blInvoicing.alreadyInvoiced'));
      const single = fulls.length === 1;
      const lines: LineInput[] = [];
      for (const f of fulls) {
        lines.push(blHeaderLine(f.doc, labels.blHeader));
        const own = f.lines.map((l) => rowToLineInput(l));
        // Une facture par BL : le pied du BL est repris tel quel ; regroupement : replié sur les lignes.
        lines.push(...(single ? own : blLinesForInvoice(own, {
          global_discount_pct: Number(f.doc.global_discount_pct), global_discount_amount: Number(f.doc.global_discount_amount),
          shipping_ht: Number(f.doc.shipping_ht), shipping_taxed: f.doc.shipping_taxed !== false, shipping_vat_rate: Number(f.doc.shipping_vat_rate),
        }, labels.shipping)));
      }
      const extra = surchargeLine(lines, params, labels.surcharge);
      if (extra) lines.push(extra);
      const first = fulls[0].doc;
      const pied = single
        ? { priceMode: params.priceMode, taxExempt: !!first.tax_exempt, globalDiscountPct: Number(first.global_discount_pct), globalDiscountAmount: Number(first.global_discount_amount), shippingHt: Number(first.shipping_ht), shippingTaxed: first.shipping_taxed !== false, shippingVatRate: Number(first.shipping_vat_rate) }
        : { priceMode: params.priceMode, taxExempt: !!first.tax_exempt };
      const condition = params.paymentCondition ?? first.condition_reglement ?? null;
      const due = params.paymentCondition ? dueDateFor(params.invoiceDate, params.paymentDays, params.paymentEndOfMonth) : first.due_date;
      const invoiceId = await createDocument({
        companyId, docType: 'FAC', contactId: first.contact_id, vehicleId: single ? first.vehicle_id : null,
        issueDate: params.invoiceDate, dueDate: due, status: 'validee',
        notes: single ? first.notes : null, lines, pied, paymentCondition: condition,
        sourceDocumentId: single ? first.id : null,
      });
      for (const f of fulls) {
        await transferReceivedPayments(f.doc, invoiceId);
        await liberateReservation(f.doc.id);
        const { error } = await supabase.from('documents').update({ status: 'converti' }).eq('id', f.doc.id);
        if (error) throw error;
      }
      try { await linkSources(companyId, invoiceId, fulls.map((f) => f.doc.id), 'bl_grouping'); }
      catch (e) { if (!isMissingDbObject(e)) throw e; }
      const { data: inv } = await supabase.from('documents').select('number').eq('id', invoiceId).maybeSingle();
      results.push({ invoiceId, number: inv?.number ?? null, blNumbers });
    } catch (e) {
      results.push({ invoiceId: null, number: null, blNumbers, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
