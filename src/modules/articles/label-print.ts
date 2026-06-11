/**
 * M2/M5 (B12) — Impression d'étiquettes articles avec code-barres Code128 scannable.
 * Ouvre une fenêtre d'impression (planche d'étiquettes) → imprimante / PDF.
 */
import { code128Svg } from './barcode';

export type LabelItem = { code: string; designation: string; price?: number | null; withPrice?: boolean };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

/** Imprime `copies` étiquettes par article. */
export function printLabels(items: LabelItem[], copies = 1): void {
  const labels: string[] = [];
  for (const it of items) {
    for (let i = 0; i < Math.max(1, copies); i++) {
      labels.push(`<div class="label">
        <div class="bc">${code128Svg(it.code, { height: 46, module: 1.4 })}</div>
        <div class="code">${esc(it.code)}</div>
        <div class="desig">${esc(it.designation)}</div>
        ${it.withPrice && it.price != null ? `<div class="price">${eur(Number(it.price))}</div>` : ''}
      </div>`);
    }
  }
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 8mm; }
  .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
  .label { width: 50mm; height: 30mm; border: 1px solid #ddd; border-radius: 4px; padding: 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-inside: avoid; }
  .bc svg { display: block; }
  .code { font-family: monospace; font-size: 10px; margin-top: 1px; letter-spacing: 1px; }
  .desig { font-size: 9px; text-align: center; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .price { font-size: 13px; font-weight: bold; }
  @media print { .label { border: none; } body { margin: 5mm; } }
</style></head>
<body><div class="sheet">${labels.join('')}</div>
<script>window.onload = function(){ window.print(); };</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
