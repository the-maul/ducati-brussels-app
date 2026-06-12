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

// ---- Moteur d'écritures comptables (M12) ----
export type EntryLine = { line_no: number; account_code: string; account_label: string | null; auxiliary_code: string | null; debit: number; credit: number; vat_rate: number | null; label: string | null };
export type AccountingEntry = { id: string; journal_code: string; entry_date: string; doc_type: string | null; doc_number: string | null; source: string; label: string | null; lines: EntryLine[] };

/** Génère les écritures (ventes + règlements) de la période (idempotent). Retourne le nb de pièces créées. */
export async function generateEntries(companyId: string, from: string, to: string): Promise<number> {
  const { data, error } = await supabase.rpc('generate_accounting_entries', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Liste les pièces comptables de la période avec leurs lignes (prévisualisation avant export). */
export async function listEntries(companyId: string, from: string, to: string): Promise<AccountingEntry[]> {
  const { data, error } = await supabase
    .from('accounting_entries')
    .select('id, journal_code, entry_date, doc_type, doc_number, source, label, accounting_entry_lines(line_no, account_code, account_label, auxiliary_code, debit, credit, vat_rate, label)')
    .eq('company_id', companyId).gte('entry_date', from).lte('entry_date', to)
    .order('entry_date').order('journal_code');
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id, journal_code: e.journal_code, entry_date: e.entry_date, doc_type: e.doc_type, doc_number: e.doc_number, source: e.source, label: e.label,
    lines: ((e.accounting_entry_lines ?? []) as EntryLine[])
      .map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) }))
      .sort((a, b) => a.line_no - b.line_no),
  }));
}

// Type de pièce Winbooks par journal (2 = vente, 3 = financier, 1 = achat, 0 = OD).
const WB_DOCTYPE: Record<string, string> = { VEN: '2', FIN: '3', ACH: '1' };
const r2s = (n: number) => n.toFixed(2);

/**
 * Export Winbooks (format ASCII « Actage ») depuis les ÉCRITURES générées : une ligne
 * par ligne d'écriture, avec le **compte général réel** (PCMN) et le **compte tiers réel**
 * (auxiliaire), montant signé (débit +, crédit −). Plus d'UUID en compte client.
 * Génère d'abord les écritures manquantes de la période. Colonnes alignables sur le
 * gabarit exact du comptable (on calera après réception du fichier exemple).
 */
export async function exportWinbooks(companyId: string, from: string, to: string): Promise<void> {
  await generateEntries(companyId, from, to);
  const entries = await listEntries(companyId, from, to);
  const header = ['DocType', 'DbkCode', 'DocNumber', 'DocOrder', 'AccountGL', 'AccountRP', 'BookYear', 'Period', 'Date', 'Comment', 'Amount', 'VatCode'];
  const rows: string[] = [header.join(';')];
  for (const e of entries) {
    const d = new Date(e.entry_date);
    const yyyy = e.entry_date.slice(0, 4);
    const period = e.entry_date.slice(5, 7);
    const dmy = `${e.entry_date.slice(8, 10)}/${period}/${yyyy}`;
    for (const l of e.lines) {
      const amount = r2s(l.debit - l.credit); // débit positif, crédit négatif (convention ACT)
      rows.push([
        WB_DOCTYPE[e.journal_code] ?? '0', e.journal_code, e.doc_number ?? '', String(l.line_no + 1),
        l.account_code, l.auxiliary_code ?? '', yyyy, period, dmy,
        (l.label ?? e.label ?? '').replace(/;/g, ','), amount, l.vat_rate != null ? String(l.vat_rate) : '',
      ].join(';'));
    }
  }
  const csv = '﻿' + rows.join('\r\n');
  download(`WINBOOKS_ACT_${from}_${to}.csv`, csv, 'text/csv;charset=utf-8;');
  await logExport(companyId, 'winbooks', `${from}..${to}`, from, to);
}
