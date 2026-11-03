/**
 * M12 — Comptabilité : journal des ventes, registre TVA, export UBL (Peppol/Falco)
 * et export Winbooks. Lectures + génération de fichiers téléchargeables.
 */
import { supabase } from '@/integrations/supabase/client';
import { buildUblInvoice, type UblInvoice, type UblParty } from './ubl';
import { docVatScheme, isMargeDocument } from '@/modules/sales/write-api';
import { MARGIN_MENTION_KEY, MARGIN_DEFAULT_RATE } from '@/modules/sales/vat-scheme';
import { tIn } from '@/lib/i18n';
import { contactLocale } from '@/lib/i18n/client-locale';

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

  // Régime de la marge (M-89) : catégorie E 0 %, mention dans la langue du client, jamais `O`.
  const inv: UblInvoice = {
    number: doc.number ?? documentId.slice(0, 8), issueDate: doc.issue_date, dueDate: doc.due_date, isCredit: doc.doc_type === 'AVO',
    supplier, customer, iban: company!.iban, taxExempt: !!doc.tax_exempt && !isMargeDocument(doc),
    vatScheme: docVatScheme(doc), marginReason: isMargeDocument(doc) ? tIn(contactLocale(contact), MARGIN_MENTION_KEY) : null,
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

// ---- Date de bascule comptable (M12) ----
export async function getAccountingCutover(companyId: string): Promise<string | null> {
  const { data, error } = await supabase.from('companies').select('accounting_start_date').eq('id', companyId).maybeSingle();
  if (error) throw error;
  return (data?.accounting_start_date as string) ?? null;
}
export async function setAccountingCutover(companyId: string, date: string): Promise<void> {
  const { error } = await supabase.rpc('set_accounting_cutover', { _company: companyId, _date: date });
  if (error) throw error;
}

// ---- Clôture d'exercice + éditions pré-clôture (M12) ----
export type DebtorRow = { contact_id: string; contact_name: string; invoices: number; total_due: number };
export type DepositRow = { document_id: string; number: string | null; contact_name: string | null; deposit: number; issue_date: string };
export type EffectRow = { payment_id: string; document_number: string | null; method: string; amount: number; due_date: string | null };

export async function getDebtorsList(companyId: string, asOf: string): Promise<DebtorRow[]> {
  const { data, error } = await supabase.rpc('debtors_list', { _company: companyId, _as_of: asOf });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, invoices: Number(r.invoices), total_due: Number(r.total_due) }));
}
export async function getPendingDeposits(companyId: string): Promise<DepositRow[]> {
  const { data, error } = await supabase.rpc('pending_deposits', { _company: companyId });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, deposit: Number(r.deposit) }));
}
export async function getPendingEffects(companyId: string, to: string): Promise<EffectRow[]> {
  const { data, error } = await supabase.rpc('pending_effects', { _company: companyId, _to: to });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
}
export async function closeFiscalYear(companyId: string, from: string, to: string, label?: string): Promise<string> {
  // undefined : `_label` est DEFAULT NULL cote SQL, l'omettre equivaut a NULL.
  const { data, error } = await supabase.rpc('close_fiscal_year', { _company: companyId, _from: from, _to: to, _label: label ?? undefined });
  if (error) throw error;
  return data as string;
}
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
export type ClosureRow = import('@/integrations/supabase/types').Database['public']['Tables']['fiscal_closures']['Row'];
export async function listClosures(companyId: string): Promise<ClosureRow[]> {
  const { data, error } = await supabase.from('fiscal_closures').select('*').eq('company_id', companyId).order('period_to', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ---- TVA sur marge (VO) — B2, M-89 : registre par véhicule + base globale par période ----
/**
 * Une ligne du registre par véhicule (`vo_margin_register`, migration 20261103160000) : vente
 * (FAC / TIK) ou avoir (AVO, montants négatifs) d'un document en régime de la marge. La marge
 * par véhicule est **indicative** : la TVA due se calcule globalement par période (`vo_margin_periods`).
 */
export type VoMarginRow = {
  sale_date: string; doc_number: string | null; doc_type: string; document_id: string; vehicle_id: string | null; vin: string | null;
  designation: string; purchase_price: number; sale_ttc: number; margin: number; vat_margin: number; base_ht: number;
};
export type VoMarginSummary = { count_vo: number; total_sale: number; total_margin: number; total_vat_margin: number; total_base: number };
/** Un achat sous régime de la marge (moto O entrée en stock : prix de reprise payé au particulier). */
export type VoMarginPurchase = { purchase_date: string; reference: string; vehicle_id: string | null; vin: string | null; designation: string; purchase_price: number };
/** Une période de déclaration : base globale, TVA due, report (AR 53 art. 3). */
export type VoMarginPeriod = {
  period_key: string; period_start: string; period_end: string; count_sales: number; count_purchases: number;
  sales: number; purchases: number; carried_in: number; margin: number; base_ht: number; vat_due: number; carried_out: number;
};
export type MarginGranularity = 'month' | 'quarter';

const n = (v: unknown) => Number(v ?? 0);

export async function getVoMarginRegister(companyId: string, from: string, to: string): Promise<VoMarginRow[]> {
  const { data, error } = await supabase.rpc('vo_margin_register', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    sale_date: String(r.sale_date), doc_number: (r.doc_number as string) ?? null, doc_type: String(r.doc_type ?? 'FAC'), document_id: String(r.document_id),
    vehicle_id: (r.vehicle_id as string) ?? null, vin: (r.vin as string) ?? null, designation: String(r.designation ?? ''),
    purchase_price: n(r.purchase_price), sale_ttc: n(r.sale_ttc), margin: n(r.margin), vat_margin: n(r.vat_margin), base_ht: n(r.base_ht),
  }));
}

export async function getVoMarginSummary(companyId: string, from: string, to: string): Promise<VoMarginSummary> {
  const { data, error } = await supabase.rpc('vo_margin_summary', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as VoMarginSummary | undefined;
  return r ? { count_vo: n(r.count_vo), total_sale: n(r.total_sale), total_margin: n(r.total_margin), total_vat_margin: n(r.total_vat_margin), total_base: n(r.total_base) } : { count_vo: 0, total_sale: 0, total_margin: 0, total_vat_margin: 0, total_base: 0 };
}

export async function getVoMarginPurchases(companyId: string, from: string, to: string): Promise<VoMarginPurchase[]> {
  const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>)('vo_margin_purchases', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    purchase_date: String(r.purchase_date), reference: String(r.reference ?? ''), vehicle_id: (r.vehicle_id as string) ?? null,
    vin: (r.vin as string) ?? null, designation: String(r.designation ?? ''), purchase_price: n(r.purchase_price),
  }));
}

/**
 * Base globale par période de déclaration (mois ou trimestre, réglable) : ventes marge − achats
 * marge + report entrant ; marge négative reportée. Calcul SQL (`vo_margin_periods`), même règle
 * que `marginPeriods` (vat-scheme.ts, testée).
 */
export async function getVoMarginPeriods(companyId: string, from: string, to: string, granularity: MarginGranularity): Promise<VoMarginPeriod[]> {
  const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>)('vo_margin_periods', { _company: companyId, _from: from, _to: to, _granularity: granularity });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    period_key: String(r.period_key), period_start: String(r.period_start), period_end: String(r.period_end),
    count_sales: n(r.count_sales), count_purchases: n(r.count_purchases),
    sales: n(r.sales), purchases: n(r.purchases), carried_in: n(r.carried_in), margin: n(r.margin), base_ht: n(r.base_ht), vat_due: n(r.vat_due), carried_out: n(r.carried_out),
  }));
}

/**
 * Réglages du régime de la marge (Paramètres → Tables → « TVA marge (occasions) »,
 * `reference_values.vat_margin_settings`, code = réglage, libellé = valeur). Défauts si absents :
 * taux 21, période mensuelle, grilles 00 / 03 / 54, code TVA Winbooks « MARGE », journal OD.
 * **À confirmer par le comptable** (grilles et code TVA Winbooks).
 */
export type VatMarginSettings = {
  rate: number; period: MarginGranularity; grid_sales: string; grid_base: string; grid_vat: string;
  winbooks_vat_code: string; winbooks_journal: string;
};
export const VAT_MARGIN_SETTINGS_KEY = 'vat_margin_settings';
export const DEFAULT_VAT_MARGIN_SETTINGS: VatMarginSettings = {
  rate: MARGIN_DEFAULT_RATE, period: 'month', grid_sales: '00', grid_base: '03', grid_vat: '54', winbooks_vat_code: 'MARGE', winbooks_journal: 'OD',
};
export function parseVatMarginSettings(rows: { code: string; label: string; is_active?: boolean }[]): VatMarginSettings {
  const s = { ...DEFAULT_VAT_MARGIN_SETTINGS };
  for (const r of rows) {
    if (r.is_active === false) continue;
    const v = (r.label ?? '').trim();
    switch (r.code) {
      case 'rate': { const x = Number(v.replace(',', '.')); if (Number.isFinite(x) && x > 0) s.rate = x; break; }
      case 'period': if (v === 'quarter' || v === 'month') s.period = v; break;
      case 'grid_sales': if (v) s.grid_sales = v; break;
      case 'grid_base': if (v) s.grid_base = v; break;
      case 'grid_vat': if (v) s.grid_vat = v; break;
      case 'winbooks_vat_code': s.winbooks_vat_code = v; break;
      case 'winbooks_journal': if (v) s.winbooks_journal = v; break;
    }
  }
  return s;
}
export async function loadVatMarginSettings(companyId: string): Promise<VatMarginSettings> {
  const { data, error } = await supabase.from('reference_values').select('code, label, is_active')
    .eq('company_id', companyId).eq('table_key', VAT_MARGIN_SETTINGS_KEY);
  if (error) return { ...DEFAULT_VAT_MARGIN_SETTINGS };
  return parseVatMarginSettings(data ?? []);
}

const n2s = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const csvCell = (v: unknown) => String(v ?? '').replace(/;/g, ',');

/** Contenu CSV du registre de la marge (périodes + ventes + achats), logique pure (testée). */
export function voMarginCsv(p: { periods: VoMarginPeriod[]; sales: VoMarginRow[]; purchases: VoMarginPurchase[]; settings: VatMarginSettings }): string {
  const rows: string[] = [];
  rows.push(['Periode', 'Du', 'Au', 'Achats', 'Ventes', 'ReportEntrant', 'Marge', `BaseHT_grille_${p.settings.grid_base}`, `TVA_due_grille_${p.settings.grid_vat}`, 'ReportSortant', `Ventes_grille_${p.settings.grid_sales}`].join(';'));
  for (const r of p.periods) rows.push([r.period_key, r.period_start, r.period_end, n2s(r.purchases), n2s(r.sales), n2s(r.carried_in), n2s(r.margin), n2s(r.base_ht), n2s(r.vat_due), n2s(r.carried_out), n2s(r.sales)].join(';'));
  rows.push('');
  rows.push(['Ventes', 'Date', 'Document', 'Type', 'VIN', 'Designation', 'PrixAchatFige', 'PrixVenteTTC', 'MargeIndicative', 'BaseIndicative', 'TVAIndicative'].join(';'));
  for (const r of p.sales) rows.push(['', r.sale_date, r.doc_number ?? '', r.doc_type, r.vin ?? '', csvCell(r.designation), n2s(r.purchase_price), n2s(r.sale_ttc), n2s(r.margin), n2s(r.base_ht), n2s(r.vat_margin)].join(';'));
  rows.push('');
  rows.push(['Achats', 'Date', 'Reference', 'VIN', 'Designation', 'PrixAchat'].join(';'));
  for (const r of p.purchases) rows.push(['', r.purchase_date, r.reference, r.vin ?? '', csvCell(r.designation), n2s(r.purchase_price)].join(';'));
  return '﻿' + rows.join('\r\n');
}

/** Export CSV du registre de la marge (registre de comparaison, AR 53) : périodes, ventes, achats. */
export async function exportVoRegister(companyId: string, from: string, to: string, granularity?: MarginGranularity): Promise<void> {
  const settings = await loadVatMarginSettings(companyId);
  const g = granularity ?? settings.period;
  const [periods, sales, purchases] = await Promise.all([
    getVoMarginPeriods(companyId, from, to, g), getVoMarginRegister(companyId, from, to), getVoMarginPurchases(companyId, from, to),
  ]);
  download(`REGISTRE_MARGE_${from}_${to}.csv`, voMarginCsv({ periods, sales, purchases, settings }), 'text/csv;charset=utf-8;');
  await logExport(companyId, 'vo_register', `${from}..${to}`, from, to);
}

/**
 * Lignes Winbooks (format ACT, mêmes colonnes que `exportWinbooks`) de l'OD de fin de période :
 * débit « ventes marge » / crédit « TVA sur marge » = TVA due de chaque période, avec le code TVA
 * paramétré. Logique pure (testée) ; les comptes viennent de `account_mappings`
 * (`sales_margin`, `vat_margin`). Une période sans TVA due ne produit aucune ligne.
 */
export function voMarginWinbooksRows(p: { periods: VoMarginPeriod[]; settings: VatMarginSettings; salesAccount: string; vatAccount: string }): string[] {
  const rows: string[] = [];
  for (const r of p.periods) {
    if (r.vat_due <= 0) continue;
    const yyyy = r.period_end.slice(0, 4), mm = r.period_end.slice(5, 7);
    const dmy = `${r.period_end.slice(8, 10)}/${mm}/${yyyy}`;
    const label = `TVA marge ${r.period_key}`;
    rows.push(['0', p.settings.winbooks_journal, `MARGE-${r.period_key}`, '1', p.salesAccount, '', yyyy, mm, dmy, label, n2s(r.vat_due), p.settings.winbooks_vat_code].join(';'));
    rows.push(['0', p.settings.winbooks_journal, `MARGE-${r.period_key}`, '2', p.vatAccount, '', yyyy, mm, dmy, label, n2s(-r.vat_due), p.settings.winbooks_vat_code].join(';'));
  }
  return rows;
}

export async function exportVoMarginWinbooks(companyId: string, from: string, to: string, granularity?: MarginGranularity): Promise<void> {
  const settings = await loadVatMarginSettings(companyId);
  const periods = await getVoMarginPeriods(companyId, from, to, granularity ?? settings.period);
  const { data: maps } = await supabase.from('account_mappings').select('dimension, account_code').eq('company_id', companyId).in('dimension', ['sales_margin', 'vat_margin']).eq('match_key', '*');
  const acct = (dim: string, fallback: string) => (maps ?? []).find((m) => m.dimension === dim)?.account_code ?? fallback;
  const header = ['DocType', 'DbkCode', 'DocNumber', 'DocOrder', 'AccountGL', 'AccountRP', 'BookYear', 'Period', 'Date', 'Comment', 'Amount', 'VatCode'];
  const rows = voMarginWinbooksRows({ periods, settings, salesAccount: acct('sales_margin', '700200'), vatAccount: acct('vat_margin', '451090') });
  download(`WINBOOKS_MARGE_${from}_${to}.csv`, '﻿' + [header.join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8;');
  await logExport(companyId, 'vo_margin_winbooks', `${from}..${to}`, from, to);
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
