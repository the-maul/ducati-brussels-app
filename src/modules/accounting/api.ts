/**
 * M12 — Comptabilité : journal des ventes, registre TVA, export UBL (Peppol/Falco)
 * et export Winbooks. Lectures + génération de fichiers téléchargeables.
 */
import { supabase } from '@/integrations/supabase/client';
import { buildUblInvoice, type UblInvoice, type UblParty } from './ubl';

export type JournalRow = { document_id: string; number: string | null; issue_date: string; contact_id: string | null; total_ht: number; total_vat: number; total_ttc: number; paid_amount: number };
export type VatRow = { vat_rate: number; base_ht: number; vat: number };

export async function getSalesJournal(companyId: string, from: string, to: string): Promise<JournalRow[]> {
  const { data, error } = await supabase.rpc('sales_journal', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, total_ht: Number(r.total_ht), total_vat: Number(r.total_vat), total_ttc: Number(r.total_ttc), paid_amount: Number(r.paid_amount) }));
}

export async function getVatRegister(companyId: string, from: string, to: string): Promise<VatRow[]> {
  const { data, error } = await supabase.rpc('vat_register', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  return (data ?? []).map((r) => ({ vat_rate: Number(r.vat_rate), base_ht: Number(r.base_ht), vat: Number(r.vat) }));
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function logExport(companyId: string, kind: string, reference: string | null, from?: string, to?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('accounting_exports').insert({ company_id: companyId, kind, reference, period_from: from ?? null, period_to: to ?? null, created_by: user?.id ?? null });
}

/** Génère et télécharge l'UBL d'une facture (Peppol BIS 3.0). */
export async function exportInvoiceUbl(documentId: string): Promise<void> {
  const { data: doc, error } = await supabase.from('documents').select('*').eq('id', documentId).single();
  if (error) throw error;
  const { data: lines } = await supabase.from('document_lines').select('*').eq('document_id', documentId).order('sort_order');
  const { data: company } = await supabase.from('companies').select('*').eq('id', doc.company_id).single();
  const contact = doc.contact_id ? (await supabase.from('contacts').select('*').eq('id', doc.contact_id).maybeSingle()).data : null;

  const supplier: UblParty = { name: company!.legal_name || company!.name, vat: company!.vat_number, street: company!.address, zip: company!.zip, city: company!.city, country: company!.country || 'BE', peppolId: company!.peppol_id };
  const cName = contact ? (contact.company_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ')) : 'Client comptoir';
  const customer: UblParty = { name: cName || 'Client', vat: contact?.vat_number ?? null, street: contact?.address ?? null, zip: contact?.zip ?? null, city: contact?.city ?? null, country: contact?.country ?? 'BE', peppolId: null };

  const inv: UblInvoice = {
    number: doc.number ?? documentId.slice(0, 8), issueDate: doc.issue_date, dueDate: doc.due_date, isCredit: doc.doc_type === 'AVO',
    supplier, customer, iban: company!.iban, taxExempt: !!doc.tax_exempt,
    totalHt: Math.abs(Number(doc.total_ht)), totalVat: Math.abs(Number(doc.total_vat)), totalTtc: Math.abs(Number(doc.total_ttc)),
    lines: (lines ?? []).map((l, i) => ({ id: i + 1, designation: l.designation, quantity: Math.abs(Number(l.quantity)), unitPriceHt: Number(l.unit_price_ht), lineHt: Math.abs(Number(l.line_ht)), vatRate: Number(l.vat_rate) })),
  };
  download(`UBL_${inv.number}.xml`, buildUblInvoice(inv), 'application/xml;charset=utf-8;');
  await logExport(doc.company_id, 'ubl', inv.number);
}

/**
 * Export Winbooks (journal des ventes) : une ligne par facture, format CSV ';'.
 * Colonnes alignables sur le gabarit d'import du comptable (Winbooks « Actage »).
 */
export async function exportWinbooks(companyId: string, from: string, to: string): Promise<void> {
  const rows = await getSalesJournal(companyId, from, to);
  const header = ['DocType', 'Date', 'DocNumber', 'CustomerAccount', 'TotalHT', 'TotalVAT', 'TotalTTC'];
  const csv = '﻿' + [header.join(';'), ...rows.map((r) => [
    'VEN', r.issue_date, r.number ?? '', r.contact_id ?? '', r.total_ht.toFixed(2), r.total_vat.toFixed(2), r.total_ttc.toFixed(2),
  ].join(';'))].join('\r\n');
  download(`WINBOOKS_VENTES_${from}_${to}.csv`, csv, 'text/csv;charset=utf-8;');
  await logExport(companyId, 'winbooks', `${from}..${to}`, from, to);
}
