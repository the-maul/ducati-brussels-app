/**
 * M2/M5 (B12) — Rendu des étiquettes personnalisées : un SVG à l'échelle mm,
 * IDENTIQUE en prévisualisation (éditeur, aperçu) et à l'impression (WYSIWYG).
 * Code-barres Code128 vectoriel (barcode.ts), image importée (dataURL), textes
 * positionnés/orientés. Impression : rouleau (1 étiquette / page papier) ou
 * planche A4 (grille avec espacements).
 */
import { code128Svg } from '../barcode';
import {
  resolveElementText, type LabelTemplateConfig, type LabelData,
} from './template-types';

const PT_TO_MM = 0.352778;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
));

/** Sous-SVG code-barres redimensionné en mm (rotation optionnelle). */
function barcodeSvgMm(value: string, xMm: number, yMm: number, wMm: number, hMm: number, vertical: boolean): string {
  const svg = code128Svg(value || ' ', { height: 40, module: 1.5 });
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  if (!vb) return '';
  const nested = `<svg x="0" y="0" width="${wMm}" height="${hMm}" viewBox="0 0 ${vb[1]} ${vb[2]}" preserveAspectRatio="none">${inner}</svg>`;
  const transform = vertical
    ? `translate(${xMm} ${yMm}) rotate(90) translate(0 ${-hMm})`
    : `translate(${xMm} ${yMm})`;
  return `<g transform="${transform}">${nested}</g>`;
}

/**
 * Rendu d'UNE étiquette en SVG (unités = mm).
 * @param showGuides bord + fond gris clair (aperçu éditeur uniquement)
 * @param imageHref id d'un <symbol> partagé pour l'image (impression en masse :
 *   l'image n'est définie qu'UNE fois dans la page, pas dupliquée par étiquette)
 */
export function renderLabelSvg(cfg: LabelTemplateConfig, data: LabelData, now: Date, showGuides = false, imageHref?: string): string {
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${cfg.widthMm}" height="${cfg.heightMm}" fill="#fff"${showGuides ? ' stroke="#bbb" stroke-width="0.2"' : ''}/>`);

  for (const el of cfg.elements) {
    if (!el.visible) continue;
    const text = resolveElementText(el.key, data, cfg, now);
    if (!text) continue;
    const fs = (el.sizePt * PT_TO_MM).toFixed(2);
    const weight = el.bold ? '700' : '400';
    const transform = el.vertical ? ` transform="rotate(90 ${el.xMm} ${el.yMm})"` : '';
    parts.push(
      `<text x="${el.xMm}" y="${el.yMm}" font-family="${el.font}, sans-serif" font-size="${fs}" font-weight="${weight}" fill="#000" dominant-baseline="hanging"${transform}>${esc(text)}</text>`,
    );
  }

  if (cfg.barcode.visible && data.barcode_value) {
    parts.push(barcodeSvgMm(data.barcode_value, cfg.barcode.xMm, cfg.barcode.yMm, cfg.barcode.widthMm, cfg.barcode.heightMm, cfg.barcode.vertical));
  }

  if (cfg.image.visible && cfg.image.dataUrl) {
    const im = cfg.image;
    parts.push(imageHref
      ? `<use href="#${imageHref}" x="${im.xMm}" y="${im.yMm}" width="${im.widthMm}" height="${im.heightMm}"/>`
      : `<image href="${esc(im.dataUrl)}" x="${im.xMm}" y="${im.yMm}" width="${im.widthMm}" height="${im.heightMm}" preserveAspectRatio="xMidYMid meet"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.widthMm}mm" height="${cfg.heightMm}mm" viewBox="0 0 ${cfg.widthMm} ${cfg.heightMm}">${parts.join('')}</svg>`;
}

/** Nb max d'étiquettes par impression (garde-fou mémoire/spool). */
const MAX_PRINT_LABELS = 5000;

/** Définition partagée de l'image du format (une seule fois par page d'impression). */
function sharedImageDefs(cfg: LabelTemplateConfig, id: string): string {
  if (!cfg.image.visible || !cfg.image.dataUrl) return '';
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>` +
    `<symbol id="${id}" viewBox="0 0 100 100">` +
    `<image href="${esc(cfg.image.dataUrl)}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>` +
    `</symbol></defs></svg>`;
}

export type TemplateLabelItem = { data: LabelData; qty: number };

/** Page d'impression : rouleau (une étiquette par page papier) ou planche A4. */
export function buildPrintHtml(cfg: LabelTemplateConfig, items: TemplateLabelItem[], now: Date): string {
  const IMG_ID = 'tpl-shared-image';
  const hasSharedImage = cfg.image.visible && !!cfg.image.dataUrl;
  const defs = sharedImageDefs(cfg, IMG_ID);

  const labels: string[] = [];
  let total = 0;
  for (const it of items) {
    // Qté bornée et finie (garde-fou : Infinity/NaN/valeurs énormes → gel de l'onglet)
    const qty = Number.isFinite(it.qty) ? Math.max(1, Math.min(MAX_PRINT_LABELS, Math.round(it.qty))) : 1;
    if (total >= MAX_PRINT_LABELS) break;
    const n = Math.min(qty, MAX_PRINT_LABELS - total);
    const svg = renderLabelSvg(cfg, it.data, now, false, hasSharedImage ? IMG_ID : undefined);
    for (let i = 0; i < n; i++) labels.push(svg);
    total += n;
  }

  if (cfg.sheetA4) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  @page { size: A4; margin: 8mm; }
  body { font-family: Arial, sans-serif; }
  .sheet { display: flex; flex-wrap: wrap; column-gap: ${cfg.gapXMm}mm; row-gap: ${cfg.gapYMm}mm; }
  .label { width: ${cfg.widthMm}mm; height: ${cfg.heightMm}mm; overflow: hidden; page-break-inside: avoid; }
  .label svg { display: block; }
</style></head>
<body>${defs}<div class="sheet">${labels.map((s) => `<div class="label">${s}</div>`).join('')}</div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body></html>`;
  }

  // Rouleau : chaque page = papier ; étiquette posée en haut-gauche du papier.
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  @page { size: ${cfg.paperWidthMm}mm ${cfg.paperHeightMm}mm; margin: 0; }
  body { font-family: Arial, sans-serif; }
  .page { width: ${cfg.paperWidthMm}mm; height: ${cfg.paperHeightMm}mm; page-break-after: always; overflow: hidden; }
  .page svg { display: block; }
</style></head>
<body>${defs}${labels.map((s) => `<div class="page">${s}</div>`).join('')}
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body></html>`;
}

/** Ouvre la fenêtre d'impression avec le format personnalisé. */
export function printLabelsWithTemplate(cfg: LabelTemplateConfig, items: TemplateLabelItem[]): void {
  const html = buildPrintHtml(cfg, items, new Date());
  const w = window.open('', '_blank', 'width=900,height=900');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
