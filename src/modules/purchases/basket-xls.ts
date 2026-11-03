/**
 * Fichier ExportDucati.xls — construction du classeur (pur : pas d'accès Supabase, testé par
 * tests/purchases-baskets.test.ts cellule par cellule). Format Excel 97 / BIFF8 (SheetJS `xlsx`).
 */
import * as XLSX from 'xlsx';
import { exportGrid, exportRows, type BasketLine } from './basket';

export const EXPORT_SHEET_NAME = 'Sheet1';

/** Classeur SheetJS du fichier ExportDucati (une feuille, grille de la carte 2). */
export function buildExportWorkbook(lines: Pick<BasketLine, 'reference' | 'qty' | 'contactLabel'>[], orderedAt: Date): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(exportGrid(exportRows(lines, orderedAt)));
  XLSX.utils.book_append_sheet(wb, ws, EXPORT_SHEET_NAME);
  return wb;
}

/** Octets du fichier .xls (Excel 97 / BIFF8). */
export function buildExportBytes(lines: Pick<BasketLine, 'reference' | 'qty' | 'contactLabel'>[], orderedAt: Date): Uint8Array {
  const out = XLSX.write(buildExportWorkbook(lines, orderedAt), { bookType: 'biff8', type: 'array' }) as ArrayBuffer;
  return new Uint8Array(out);
}
