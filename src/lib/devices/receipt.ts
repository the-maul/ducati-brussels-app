/**
 * Ticket neutre (PDV030) : un ticket est une suite de BLOCS (texte, paire libelle / montant,
 * trait, saut, code-barres), mis en page en LIGNES de largeur fixe (colonnes) selon le papier.
 * Les memes lignes alimentent les trois sorties : HTML imprime par le navigateur, octets ESC/POS
 * (Epson ePOS, Web Serial, WebUSB) et requete Star WebPRNT. Pur, sans acces reseau.
 */
import type { PaperWidth } from './types';

export type Align = 'left' | 'center' | 'right';

export type ReceiptBlock =
  | { kind: 'text'; text: string; align?: Align; bold?: boolean; large?: boolean }
  | { kind: 'pair'; left: string; right: string; bold?: boolean; large?: boolean }
  | { kind: 'rule'; char?: '-' | '=' }
  | { kind: 'feed'; lines?: number }
  | { kind: 'barcode'; value: string };

/** Ticket pret a imprimer : titre (onglet du navigateur), blocs, largeur souhaitee. */
export type ReceiptDoc = { title: string; blocks: ReceiptBlock[]; widthMm?: PaperWidth };

/** Une ligne mise en page. `large` = double largeur et double hauteur (moitie moins de colonnes). */
export type ReceiptLine =
  | { kind: 'text'; text: string; align: Align; bold: boolean; large: boolean }
  | { kind: 'barcode'; value: string };

/** Cible de la mise en page : imprimante thermique (police A) ou navigateur (police plus grande). */
export type ReceiptTarget = 'printer' | 'browser';

/**
 * Colonnes par ligne. Imprimante : police A de 12 points sur 576 points (80 mm) = 48 colonnes,
 * 384 points (58 mm) = 32 colonnes. Navigateur : 42 / 32 pour rester lisible.
 */
export function receiptColumns(width: PaperWidth, target: ReceiptTarget = 'printer'): number {
  if (width === 58) return 32;
  return target === 'printer' ? 48 : 42;
}

/** Remplace les caracteres que le papier ne connait pas (espaces insecables, guillemets courbes, tirets longs). */
export function plainText(s: string): string {
  return String(s ?? '')
    .replace(/[\u00a0\u202f\u2007\u2009]/g, ' ')
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u00ab\u00bb]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\r\t]/g, ' ');
}

/** Coupe un texte en lignes de `cols` caracteres au plus (mots longs coupes net). */
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of plainText(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { out.push(''); continue; }
    let cur = '';
    for (let w of words) {
      while (w.length > cols) {
        if (cur) { out.push(cur); cur = ''; }
        out.push(w.slice(0, cols));
        w = w.slice(cols);
      }
      if (!w) continue;
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= cols) cur += ` ${w}`;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** « libelle ........ montant » sur `cols` colonnes ; libelle trop long : coupe, montant sur la derniere ligne. */
export function pairLines(left: string, right: string, cols: number): string[] {
  const r = plainText(right);
  const l = plainText(left);
  if (l.length + 1 + r.length <= cols) return [l + ' '.repeat(cols - l.length - r.length) + r];
  const wrapped = wrapText(l, cols);
  const last = wrapped[wrapped.length - 1] ?? '';
  if (last.length + 1 + r.length <= cols) {
    wrapped[wrapped.length - 1] = last + ' '.repeat(cols - last.length - r.length) + r;
    return wrapped;
  }
  return [...wrapped, ' '.repeat(Math.max(0, cols - r.length)) + r.slice(0, cols)];
}

/** Met un ticket en page sur `cols` colonnes. */
export function layoutReceipt(blocks: ReceiptBlock[], cols: number): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const push = (text: string, align: Align, bold: boolean, large: boolean) => lines.push({ kind: 'text', text, align, bold, large });
  for (const b of blocks) {
    if (b.kind === 'text') {
      const c = b.large ? Math.floor(cols / 2) : cols;
      for (const t of wrapText(b.text, c)) push(t, b.align ?? 'left', !!b.bold, !!b.large);
    } else if (b.kind === 'pair') {
      const c = b.large ? Math.floor(cols / 2) : cols;
      for (const t of pairLines(b.left, b.right, c)) push(t, 'left', !!b.bold, !!b.large);
    } else if (b.kind === 'rule') {
      push((b.char ?? '-').repeat(cols), 'left', false, false);
    } else if (b.kind === 'feed') {
      for (let i = 0; i < Math.max(1, b.lines ?? 1); i++) push('', 'left', false, false);
    } else if (b.kind === 'barcode') {
      if (b.value) lines.push({ kind: 'barcode', value: plainText(b.value) });
    }
  }
  return lines;
}

/** Nombre de lignes « hauteur simple » occupees (une ligne large compte double, un code-barres 4). */
export function receiptHeightUnits(lines: ReceiptLine[]): number {
  return lines.reduce((s, l) => s + (l.kind === 'barcode' ? 4 : l.large ? 2 : 1), 0);
}

/** Montant au format belge, sans symbole : 1234.5 → « 1 234,50 » (espace simple, pas insecable). */
export function receiptAmount(n: number): string {
  const v = Math.round(Number(n) * 100) / 100;
  const neg = v < 0;
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${grouped},${dec}`;
}
