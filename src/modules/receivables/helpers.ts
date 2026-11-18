/**
 * Encaissements (rattrapage G8, 18/11/2026) — petits utilitaires d'écran : société pour les PDF,
 * export Excel, formats.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PdfCompany } from './receivables-pdf';

export const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
export const fmtDate = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-BE') : '—');
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const plusDaysIso = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
export const parseAmount = (s: string) => { const n = Number(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export async function loadPdfCompany(companyId: string): Promise<PdfCompany & { legal_name?: string | null; bic?: string | null; sepa_creditor_id?: string | null }> {
  const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
  const c = (data ?? {}) as Record<string, string | null>;
  return {
    name: c.legal_name || c.name || '', address: c.address, zip: c.zip, city: c.city, vat_number: c.vat_number,
    iban: c.iban, legal_name: c.legal_name, bic: c.bic, sepa_creditor_id: c.sepa_creditor_id,
  };
}

/** Export Excel (.xlsx) d'un tableau : en-têtes + lignes (nombres gardés en nombres). */
export async function exportXlsx(fileName: string, sheet: string, header: string[], rows: (string | number | null)[][]): Promise<void> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}
