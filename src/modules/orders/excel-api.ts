/**
 * Sous-module « Commande Excel » — process Miro §1.6.
 * Catalogue Ducati (Demo/Courtoisie/Showroom) + génération du classeur .xlsx prérempli.
 * Types locaux (la régénération de types.ts suit la migration orders).
 */
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';
import type { ExcelTab } from './thresholds';

const sb = supabase as unknown as { from: (t: string) => any };

export type ExcelCatalogItem = {
  id: string;
  company_id: string;
  family: string | null;
  category: string | null;
  reference: string;
  description: string | null;
  models: string | null;
  discount_class: string | null;
  price_public_ht: number | null;
  price_dealer: number | null;
  availability: string | null;
};

export type ExcelOrderLine = {
  id: string;
  excel_order_id: string;
  tab: ExcelTab;
  reference: string;
  description: string | null;
  qty: number;
  price_dealer: number;
  extra_discount: number;
  moto_label: string | null;
  moto_vin: string | null;
  contact_id: string | null;
  sort_order: number;
};

export type ExcelOrder = {
  id: string;
  company_id: string;
  part_order_id: string | null;
  number: string | null;
  status: 'en_cours' | 'telecharge' | 'cloture' | 'archive';
  dealer_code: string | null;
  dealer_name: string | null;
  downloaded_at: string | null;
  archived_at: string | null;
  archive_path: string | null;
};

/** Recherche dans le catalogue Ducati (réf ou description). */
export async function searchExcelCatalog(companyId: string, term: string, limit = 20): Promise<ExcelCatalogItem[]> {
  const s = term.replace(/[,()%*]/g, ' ').trim();
  let q = sb.from('excel_catalog').select('*').eq('company_id', companyId).limit(limit);
  if (s) q = q.or(`reference.ilike.%${s}%,description.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ExcelCatalogItem[];
}

export async function listExcelOrderLines(excelOrderId: string): Promise<ExcelOrderLine[]> {
  const { data, error } = await sb.from('excel_order_lines').select('*').eq('excel_order_id', excelOrderId).order('sort_order');
  if (error) throw error;
  return (data ?? []) as ExcelOrderLine[];
}

/**
 * Construit le classeur .xlsx prérempli (3 onglets) à partir des lignes.
 * Reproduit les colonnes du template Ducati : Référence / Description / Q COMMANDE /
 * Prix dealer / Extra-remise / Valeur / Prix final + bloc moto en tête.
 */
export function buildExcelWorkbook(order: ExcelOrder, lines: ExcelOrderLine[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const tabs: ExcelTab[] = ['demo', 'courtoisie', 'showroom'];
  const tabLabel: Record<ExcelTab, string> = { demo: 'Demo', courtoisie: 'Courtoisie', showroom: 'Showroom' };

  for (const tab of tabs) {
    const tl = lines.filter((l) => l.tab === tab);
    const header = [
      ['Code concession', order.dealer_code ?? '', '', 'N° commande', order.number ?? ''],
      ['Nom concession', order.dealer_name ?? '', '', 'Montant remisé minimum', '2 000 euros'],
      [],
      ['REFERENCE', 'DESCRIPTION FR', 'Q COMMANDE', 'Prix dealer', 'Extra-remise', 'Valeur', 'Prix final', 'Moto', 'VIN'],
    ];
    const rows = tl.map((l) => {
      const value = l.price_dealer * l.qty;
      const final = value - value * l.extra_discount;
      return [l.reference, l.description ?? '', l.qty, l.price_dealer, l.extra_discount, round2(value), round2(final), l.moto_label ?? '', l.moto_vin ?? ''];
    });
    const total = tl.reduce((s, l) => s + (l.price_dealer * l.qty) * (1 - l.extra_discount), 0);
    rows.push([]);
    rows.push(['', '', '', '', '', '', round2(total), 'TOTAL', '']);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, tabLabel[tab]);
  }
  return wb;
}

/** Déclenche le téléchargement du classeur .xlsx dans le navigateur. */
export function downloadExcelWorkbook(order: ExcelOrder, lines: ExcelOrderLine[]): void {
  const wb = buildExcelWorkbook(order, lines);
  const fname = `Commande_Ducati_${order.number ?? order.id.slice(0, 8)}.xlsx`;
  XLSX.writeFile(wb, fname);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
