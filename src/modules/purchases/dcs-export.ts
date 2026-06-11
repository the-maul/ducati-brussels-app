/**
 * M4 — Export DCS Ducati (ACH001). Le DCS est fermé (pas d'API) : on exporte au
 * format Excel/CSV imposé, en 2 fichiers distincts STANDARD et URGENTE.
 * Réf. G8 Achats [R1]. Le mapping exact des colonnes sera aligné sur le gabarit
 * Ducati fourni par le client ; ici : Référence ; Désignation ; Quantité.
 */
import type { PurchaseLine, PurchaseOrder } from './api';

export type DcsKind = 'STANDARD' | 'URGENTE';

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Construit le contenu CSV (séparateur ';', BOM UTF-8 pour Excel). */
export function buildDcsCsv(order: PurchaseOrder, lines: PurchaseLine[], kind: DcsKind): string {
  const header = ['Reference', 'Designation', 'Quantite', 'Type'];
  const rows = lines
    .filter((l) => Number(l.quantity) > 0)
    .map((l) => [l.supplier_ref || '', l.designation, Number(l.quantity), kind].map(csvCell).join(';'));
  return '﻿' + [header.join(';'), ...rows].join('\r\n');
}

/** Déclenche le téléchargement du fichier DCS. */
export function downloadDcs(order: PurchaseOrder, lines: PurchaseLine[], kind: DcsKind): void {
  const csv = buildDcsCsv(order, lines, kind);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DCS_${kind}_${order.number ?? order.id.slice(0, 8)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
