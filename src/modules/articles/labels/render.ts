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

  // Lignes personnalisées (texte libre ajouté par l'utilisateur) : même rendu que
  // les éléments data-liés, texte pris tel quel.
  for (const c of cfg.custom ?? []) {
    if (!c.visible || !c.text) continue;
    const fs = (c.sizePt * PT_TO_MM).toFixed(2);
    const weight = c.bold ? '700' : '400';
    const transform = c.vertical ? ` transform="rotate(90 ${c.xMm} ${c.yMm})"` : '';
    parts.push(
      `<text x="${c.xMm}" y="${c.yMm}" font-family="${c.font}, sans-serif" font-size="${fs}" font-weight="${weight}" fill="#000" dominant-baseline="hanging"${transform}>${esc(c.text)}</text>`,
    );
  }

  if (cfg.barcode.visible && data.barcode_value) {
    parts.push(barcodeSvgMm(data.barcode_value, cfg.barcode.xMm, cfg.barcode.yMm, cfg.barcode.widthMm, cfg.barcode.heightMm, cfg.barcode.vertical));
  }

  // Rapprochement réception ↔ client (facultatif) : ligne "<n° document> — <client>"
  // placée en bande médiane (sous la désignation), sans chevaucher le pied
  // (prix / magasin / logo). N'impacte pas les étiquettes sans ces données.
  if (data.customerName || data.docNumber) {
    const line = [data.docNumber, data.customerName].filter(Boolean).join(' — ');
    const fs = (7 * PT_TO_MM).toFixed(2);
    const yMid = (cfg.heightMm * 0.5).toFixed(2);
    parts.push(
      `<text x="2.5" y="${yMid}" font-family="Arial, sans-serif" font-size="${fs}" font-weight="700" fill="#000" dominant-baseline="hanging">${esc(line)}</text>`,
    );
  }

  if (cfg.image.visible && cfg.image.dataUrl) {
    const im = cfg.image;
    parts.push(imageHref
      ? `<use href="#${imageHref}" x="${im.xMm}" y="${im.yMm}" width="${im.widthMm}" height="${im.heightMm}"/>`
      : `<image href="${esc(im.dataUrl)}" x="${im.xMm}" y="${im.yMm}" width="${im.widthMm}" height="${im.heightMm}" preserveAspectRatio="xMidYMid meet"/>`);
  }

  // Cadre (bordure) imprimé sur le pourtour — dessiné EN DERNIER pour rester
  // au-dessus des fonds, et présent à l'impression (pas seulement à l'aperçu).
  if (cfg.border?.visible) {
    const w = cfg.border.widthMm > 0 ? cfg.border.widthMm : 0.3;
    const inset = cfg.border.insetMm >= 0 ? cfg.border.insetMm : 0.4;
    const x = inset + w / 2;
    const y = inset + w / 2;
    const bw = Math.max(0, cfg.widthMm - 2 * x);
    const bh = Math.max(0, cfg.heightMm - 2 * y);
    parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="none" stroke="#000" stroke-width="${w}"/>`);
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

// ── Étiquette « texte libre » (impression rapide, style P-touch) ─────────────

export type QuickLabelStyle = {
  font: 'Arial' | 'Helvetica' | 'Courier';
  sizePt: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Proportions : étirement horizontal / vertical en % (100 = normal). */
  scaleX: number;
  scaleY: number;
  align: 'left' | 'center' | 'right';
};

export const DEFAULT_QUICK_STYLE: QuickLabelStyle = {
  font: 'Arial', sizePt: 19, bold: true, italic: false, underline: false,
  scaleX: 100, scaleY: 100, align: 'left',
};

/**
 * Rendu d'une étiquette de texte libre multi-lignes (unités = mm).
 * @param fit auto-ajuste la taille pour que TOUT tienne dans la zone imprimable
 *   (marge de sécurité comprise) et centre verticalement — évite tout rognage à
 *   l'impression sur les étiquettes physiques (Brother/P-touch). La taille `sizePt`
 *   est un MAXIMUM : on réduit si nécessaire, jamais on n'agrandit.
 */
export function renderFreeTextLabelSvg(
  dims: { widthMm: number; heightMm: number },
  lines: string[],
  style: QuickLabelStyle,
  showGuides = false,
  fit = false,
): string {
  // Marge de sécurité : les imprimantes d'étiquettes ne peuvent pas imprimer
  // jusqu'au bord. Plus généreuse en mode ajusté.
  const margin = fit ? 2.5 : 1.5;
  const sx = Math.max(0.1, style.scaleX / 100);
  const sy = Math.max(0.1, style.scaleY / 100);
  const drawn = lines.filter((l) => l.trim() !== '');
  const nLines = Math.max(1, drawn.length);

  let fsMm = style.sizePt * PT_TO_MM;
  if (fit) {
    const availW = Math.max(1, dims.widthMm - 2 * margin);
    const availH = Math.max(1, dims.heightMm - 2 * margin);
    // Largeur estimée du libellé le plus long (Arial gras MAJUSCULES ≈ 0,64·fs/car.)
    const maxChars = drawn.reduce((m, l) => Math.max(m, l.length), 1);
    const CHARW = 0.64;
    const wScale = availW / (maxChars * fsMm * CHARW * sx);
    const hScale = availH / (nLines * fsMm * 1.2 * sy);
    fsMm = fsMm * Math.min(1, wScale, hScale); // on ne fait que réduire
  }

  const lineH = fsMm * 1.2 * sy;
  const anchor = style.align === 'center' ? 'middle' : style.align === 'right' ? 'end' : 'start';
  const xBase = style.align === 'center' ? dims.widthMm / 2 : style.align === 'right' ? dims.widthMm - margin : margin;
  // Centrage vertical du bloc dans la zone imprimable (mode ajusté).
  const totalH = nLines * lineH;
  const yStart = fit ? margin + Math.max(0, (dims.heightMm - 2 * margin - totalH) / 2) : margin;

  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${dims.widthMm}" height="${dims.heightMm}" fill="#fff"${showGuides ? ' stroke="#bbb" stroke-width="0.2"' : ''}/>`);
  drawn.forEach((line, i) => {
    const y = yStart + i * lineH;
    parts.push(
      `<g transform="translate(${xBase} ${y}) scale(${sx} ${sy})">` +
      `<text x="0" y="0" font-family="${style.font}, sans-serif" font-size="${fsMm.toFixed(2)}"` +
      ` font-weight="${style.bold ? '700' : '400'}"${style.italic ? ' font-style="italic"' : ''}` +
      `${style.underline ? ' text-decoration="underline"' : ''} fill="#000" text-anchor="${anchor}" dominant-baseline="hanging">${esc(line)}</text></g>`,
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.widthMm}mm" height="${dims.heightMm}mm" viewBox="0 0 ${dims.widthMm} ${dims.heightMm}">${parts.join('')}</svg>`;
}

/** Dimensions d'impression (sous-ensemble d'un format — compatible LabelTemplateConfig). */
export type PrintDims = {
  widthMm: number; heightMm: number; sheetA4: boolean;
  paperWidthMm: number; paperHeightMm: number; gapXMm: number; gapYMm: number;
};

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

  return wrapPrintHtml(cfg, defs, labels);
}

/** Enveloppe HTML d'impression : rouleau (1 étiquette/page papier) ou planche A4. */
function wrapPrintHtml(dims: PrintDims, defs: string, labels: string[]): string {
  if (dims.sheetA4) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  @page { size: A4; margin: 8mm; }
  body { font-family: Arial, sans-serif; }
  .sheet { display: flex; flex-wrap: wrap; column-gap: ${dims.gapXMm}mm; row-gap: ${dims.gapYMm}mm; }
  .label { width: ${dims.widthMm}mm; height: ${dims.heightMm}mm; overflow: hidden; page-break-inside: avoid; }
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
  @page { size: ${dims.paperWidthMm}mm ${dims.paperHeightMm}mm; margin: 0; }
  body { font-family: Arial, sans-serif; }
  .page { width: ${dims.paperWidthMm}mm; height: ${dims.paperHeightMm}mm; page-break-after: always; overflow: hidden; }
  .page svg { display: block; }
</style></head>
<body>${defs}${labels.map((s) => `<div class="page">${s}</div>`).join('')}
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body></html>`;
}

function openPrintWindow(html: string): void {
  const w = window.open('', '_blank', 'width=900,height=900');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

/** Ouvre la fenêtre d'impression avec le format personnalisé. */
export function printLabelsWithTemplate(cfg: LabelTemplateConfig, items: TemplateLabelItem[]): void {
  openPrintWindow(buildPrintHtml(cfg, items, new Date()));
}

/** Impression de SVG déjà rendus (texte libre, étiquette client…) — copies bornées. */
export function printRawLabels(dims: PrintDims, svg: string, copies: number): void {
  const n = Number.isFinite(copies) ? Math.max(1, Math.min(MAX_PRINT_LABELS, Math.round(copies))) : 1;
  const labels = Array.from({ length: n }, () => svg);
  openPrintWindow(wrapPrintHtml(dims, '', labels));
}
