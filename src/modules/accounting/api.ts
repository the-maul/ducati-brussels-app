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

// ---- TVA sur marge (VO) — B2 ----
export type VoMarginRow = { sale_date: string; doc_number: string | null; document_id: string; vehicle_id: string | null; vin: string | null; designation: string; purchase_price: number; sale_ttc: number; margin: number; vat_margin: number; base_ht: number };
export type VoMarginSummary = { count_vo: number; total_sale: number; total_margin: number; total_vat_margin: number; total_base: number };

export async function getVoMarginRegister(companyId: string, from: string, to: string): Promise<VoMarginRow[]> {
  const { data, error } = await supabase.rpc('vo_margin_register', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, purchase_price: Number(r.purchase_price), sale_ttc: Number(r.sale_ttc), margin: Number(r.margin), vat_margin: Number(r.vat_margin), base_ht: Number(r.base_ht) }));
}

export async function getVoMarginSummary(companyId: string, from: string, to: string): Promise<VoMarginSummary> {
  const { data, error } = await supabase.rpc('vo_margin_summary', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as VoMarginSummary | undefined;
  return r ? { count_vo: Number(r.count_vo), total_sale: Number(r.total_sale), total_margin: Number(r.total_margin), total_vat_margin: Number(r.total_vat_margin), total_base: Number(r.total_base) } : { count_vo: 0, total_sale: 0, total_margin: 0, total_vat_margin: 0, total_base: 0 };
}

/** Export CSV du registre VO (registre de comparaison art. 58 §4 CTVA). */
export async function exportVoRegister(companyId: string, from: string, to: string): Promise<void> {
  const rows = await getVoMarginRegister(companyId, from, to);
  const header = ['Date', 'Document', 'VIN', 'Designation', 'PrixAchat', 'PrixVenteTTC', 'Marge', 'BaseImposable', 'TVAMarge'];
  const csv = '﻿' + [header.join(';'), ...rows.map((r) => [
    r.sale_date, r.doc_number ?? '', r.vin ?? '', (r.designation ?? '').replace(/;/g, ','),
    r.purchase_price.toFixed(2), r.sale_ttc.toFixed(2), r.margin.toFixed(2), r.base_ht.toFixed(2), r.vat_margin.toFixed(2),
  ].join(';'))].join('\r\n');
  download(`REGISTRE_VO_${from}_${to}.csv`, csv, 'text/csv;charset=utf-8;');
  await logExport(companyId, 'vo_register', `${from}..${to}`, from, to);
}

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/**
 * Attestation TVA sur marge (VO) imprimable (TRAXIO) pré-remplie depuis la fiche
 * véhicule + la société. Ouvre une fenêtre d'impression (PDF), sans dépendance externe.
 */
export async function printVoMarginAttestation(companyId: string, row: VoMarginRow): Promise<void> {
  const { data: company } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
  const veh = row.vehicle_id ? (await supabase.from('vehicles').select('*').eq('id', row.vehicle_id).maybeSingle()).data : null;
  const c = (company ?? {}) as Record<string, unknown>;
  const v = (veh ?? {}) as Record<string, unknown>;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Attestation TVA marge ${esc(row.doc_number)}</title>
  <style>body{font-family:Arial,sans-serif;color:#111;margin:32px;font-size:13px}h1{font-size:18px}table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}.r{text-align:right}.muted{color:#666}.mention{margin-top:18px;padding:10px;border:1px solid #999;font-size:12px}</style></head>
  <body>
  <h1>Attestation — Régime particulier de la marge bénéficiaire</h1>
  <p class="muted">Article 58 §4 du Code de la TVA — véhicule d'occasion (TRAXIO)</p>
  <p><strong>${esc(c.legal_name || c.name)}</strong><br>${esc(c.address)}<br>${esc(c.zip)} ${esc(c.city)}<br>${c.vat_number ? 'TVA : ' + esc(c.vat_number) : ''}</p>
  <table>
    <tr><th>Document de vente</th><td>${esc(row.doc_number ?? '')} du ${esc(row.sale_date)}</td></tr>
    <tr><th>Véhicule</th><td>${esc(v.brand || '')} ${esc(v.model || '')}</td></tr>
    <tr><th>N° de châssis (VIN)</th><td>${esc(row.vin ?? v.vin ?? '')}</td></tr>
    <tr><th>1re immatriculation</th><td>${esc(v.first_registration_date ?? '')}</td></tr>
    <tr><th>Prix d'achat</th><td class="r">${eur(row.purchase_price)}</td></tr>
    <tr><th>Prix de vente TTC</th><td class="r">${eur(row.sale_ttc)}</td></tr>
    <tr><th>Marge bénéficiaire</th><td class="r">${eur(row.margin)}</td></tr>
    <tr><th>Base imposable (marge HT)</th><td class="r">${eur(row.base_ht)}</td></tr>
    <tr><th>TVA sur marge (21 %)</th><td class="r">${eur(row.vat_margin)}</td></tr>
  </table>
  <div class="mention">Livraison soumise au régime particulier d'imposition de la marge bénéficiaire — TVA non déductible (art. 58 §4 CTVA). « Régime de la marge — Biens d'occasion ».</div>
  <p class="muted" style="margin-top:24px">Fait à ${esc(c.city || 'Bruxelles')}, le ${new Date().toISOString().slice(0, 10)}.</p>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
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
