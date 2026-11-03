/**
 * Ticket imprime par le navigateur (PDV030) : le seul chemin qui marche partout (PC Windows,
 * tablette Android, iPad), avec le pilote de l'imprimante installe sur l'appareil. Page CSS
 * `@page` a la largeur du rouleau (80 / 58 mm) et a la HAUTEUR du ticket (calculee depuis le
 * nombre de lignes) : le pilote coupe a la fin, pas de 29 cm de papier blanc.
 * Gabarit d'impression (hors charte d'ecran) : noir sur blanc, police a chasse fixe pour que les
 * colonnes de montants restent alignees, comme sur une imprimante thermique. Pur.
 */
import type { PaperWidth } from './types';
import { layoutReceipt, receiptColumns, receiptHeightUnits, type ReceiptDoc, type ReceiptLine } from './receipt';
import { code128Svg } from '@/modules/articles/barcode';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Geometrie du ticket navigateur pour une largeur de rouleau. */
export function browserReceiptGeometry(width: PaperWidth) {
  const cols = receiptColumns(width, 'browser');
  const marginMm = width === 58 ? 2 : 4;              // marges laterales (zone non imprimable)
  const printableMm = width - 2 * marginMm;
  // Courier : un caractere = 0,6 em → taille de police pour remplir la largeur imprimable.
  const fontMm = Math.round((printableMm / cols / 0.6) * 100) / 100;
  const lineMm = Math.round(fontMm * 1.25 * 100) / 100;
  return { cols, marginMm, printableMm, fontMm, lineMm };
}

/** Hauteur de page en mm : lignes + marges haut / bas, arrondie au mm superieur. */
export function browserReceiptHeightMm(lines: ReceiptLine[], width: PaperWidth): number {
  const g = browserReceiptGeometry(width);
  return Math.ceil(receiptHeightUnits(lines) * g.lineMm + 12);
}

/** Page HTML complete du ticket (impression lancee au chargement). */
export function receiptHtml(doc: ReceiptDoc, width: PaperWidth, autoPrint = true): string {
  const g = browserReceiptGeometry(width);
  const lines = layoutReceipt(doc.blocks, g.cols);
  const heightMm = browserReceiptHeightMm(lines, width);
  const body = lines.map((l) => {
    if (l.kind === 'barcode') return `<div class="bc">${code128Svg(l.value, { height: 40, module: 1.2 })}</div>`;
    const cls = [l.bold ? 'b' : '', l.large ? 'l' : '', `a-${l.align}`].filter(Boolean).join(' ');
    return `<div class="${cls}">${l.text ? esc(l.text) : '&nbsp;'}</div>`;
  }).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>
  @page { size: ${width}mm ${heightMm}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}mm; }
  body { padding: 4mm ${g.marginMm}mm; font-family: 'Courier New', Courier, monospace; font-size: ${g.fontMm}mm; line-height: ${g.lineMm}mm; }
  div { white-space: pre; overflow: hidden; }
  .b { font-weight: bold; }
  .l { font-size: ${g.fontMm * 2}mm; line-height: ${g.lineMm * 2}mm; }
  .a-center { text-align: center; } .a-right { text-align: right; } .a-left { text-align: left; }
  .bc { text-align: center; height: ${g.lineMm * 4}mm; }
  .bc svg { height: ${g.lineMm * 3.6}mm; max-width: 100%; }
</style></head>
<body data-width="${width}" data-cols="${g.cols}">${body}
${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>' : ''}
</body></html>`;
}
