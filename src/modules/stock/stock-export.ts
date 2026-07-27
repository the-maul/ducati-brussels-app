/**
 * M5 — Export CSV de l'inventaire filtré (liste triple stock à date).
 * Même gabarit que l'export DCS (ACH001) : séparateur ';', BOM UTF-8, Blob + <a download>.
 */
import type { StockRow } from './stock-api';

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvNumber(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

/** Construit le contenu CSV de l'inventaire (colonnes fixes, ordre imposé). */
export function buildStockCsv(rows: StockRow[]): string {
  const header = ['Reference', 'Designation', 'Localisation', 'Rayon', 'Reel', 'Reserve', 'Disponible', 'PAMP', 'Valeur'];
  const lines = rows.map((r) => [
    r.reference, r.designation, r.bin_location ?? '', r.category_path ?? '',
    csvNumber(r.real_qty), csvNumber(r.reserved_qty), csvNumber(r.available_qty),
    csvNumber(r.pamp), csvNumber(r.stock_value),
  ].map(csvCell).join(';'));
  return '﻿' + [header.join(';'), ...lines].join('\r\n');
}

/** Déclenche le téléchargement de l'inventaire filtré. */
export function downloadStockCsv(rows: StockRow[]): void {
  const csv = buildStockCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `inventaire_${date}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
