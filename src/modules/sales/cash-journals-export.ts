/**
 * M6 (POS) — Journaux de caisse : PDF (aperçu / impression, A4 paysage) et classeur Excel (.xlsx, une
 * feuille par journal), à partir des tableaux génériques de `cash-journals.ts`. G8 : « Visualiser
 * sélection » / « Imprimer sélection » / « Exporter ». Couleurs et polices du PDF : `pdf-print-style.ts`.
 * Libellés dans la langue de l'utilisateur (documents internes).
 */
import * as XLSX from 'xlsx';
import { patchPdfText } from '@/modules/documents/pdf-text';
import { t, fillVars } from '@/lib/i18n';
import { PDF_COLORS, PDF_FONT, type Rgb } from './pdf-print-style';
import { frDay, type Cell, type ColKind, type Journal } from './cash-journals';

type Pdf = import('jspdf').jsPDF;

/** Affichage d'une cellule (écran et PDF) : montants « 1.234,56 », % , dates JJ/MM/AAAA. */
export function formatCell(v: Cell, kind: ColKind): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    if (kind === 'money') {
      const r = Math.round(v * 100) / 100;
      const [i, d] = Math.abs(r).toFixed(2).split('.');
      return `${r < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`;
    }
    if (kind === 'pct') return `${String(Math.round(v * 100) / 100).replace('.', ',')} %`;
    return String(Math.round(v * 1000) / 1000).replace('.', ',');
  }
  if (kind === 'date') return frDay(v);
  return v;
}

export const isRightAligned = (kind: ColKind) => kind === 'money' || kind === 'number' || kind === 'pct';

/* ---------------------------------------------------------------- PDF */
export type JournalPdfHeader = { companyName: string; period: string; register?: string | null };

function drawJournal(doc: Pdf, j: Journal, head: JournalPdfHeader, first: boolean): void {
  const M = 10; const W = 297; const H = 210; const LH = 4.2;
  const right = W - M;
  const color = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: 'normal' | 'bold' = 'normal') => { doc.setFont(PDF_FONT.family, style); doc.setFontSize(size); };
  if (!first) doc.addPage('a4', 'landscape');
  let y = M;
  const titleBlock = () => {
    font(PDF_FONT.title, 'bold'); color(PDF_COLORS.ink);
    doc.text(j.title, M, y + 5);
    font(PDF_FONT.small); color(PDF_COLORS.muted);
    doc.text([head.companyName, head.period, head.register ? `${t('cash.register')} : ${head.register}` : ''].filter(Boolean).join('  -  '), M, y + 10);
    y += 15;
  };
  const need = (h: number) => { if (y + h > H - M - 6) { doc.addPage('a4', 'landscape'); y = M; } };
  titleBlock();

  for (const sec of j.sections) {
    const n = sec.columns.length;
    // Largeurs : colonnes texte plus larges que les montants.
    const weights = sec.columns.map((c) => (c.kind === 'text' ? 2.4 : c.kind === 'date' || c.kind === 'time' ? 1.1 : 1.2));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => ((right - M) * w) / totalW);
    const xs = widths.reduce<number[]>((acc, w, i) => { acc.push(i === 0 ? M : acc[i - 1] + widths[i - 1]); return acc; }, []);
    const row = (cells: string[], bold: boolean, fill: boolean) => {
      need(LH + 1);
      if (fill) { doc.setFillColor(PDF_COLORS.zebra[0], PDF_COLORS.zebra[1], PDF_COLORS.zebra[2]); doc.rect(M, y - 3.1, right - M, LH, 'F'); }
      font(PDF_FONT.small, bold ? 'bold' : 'normal'); color(PDF_COLORS.ink);
      for (let i = 0; i < n; i++) {
        const text = (doc.splitTextToSize(cells[i] ?? '', widths[i] - 1.5) as string[])[0] ?? '';
        if (isRightAligned(sec.columns[i].kind)) doc.text(text, xs[i] + widths[i] - 0.8, y, { align: 'right' });
        else doc.text(text, xs[i] + 0.4, y);
      }
      y += LH;
    };
    need(LH * 3);
    if (sec.title) { font(PDF_FONT.body, 'bold'); color(PDF_COLORS.ink); doc.text(sec.title, M, y); y += LH; }
    font(PDF_FONT.small, 'bold'); color(PDF_COLORS.muted);
    row(sec.columns.map((c) => c.label), true, false);
    doc.setDrawColor(PDF_COLORS.rule[0], PDF_COLORS.rule[1], PDF_COLORS.rule[2]); doc.setLineWidth(0.2);
    doc.line(M, y - 3, right, y - 3);
    if (sec.rows.length === 0) row([t('cashJournals.empty')], false, false);
    for (const r of sec.rows) {
      const strong = r.tone === 'total' || r.tone === 'subtotal' || r.tone === 'group';
      row(r.cells.map((c, i) => formatCell(c, sec.columns[i]?.kind ?? 'text')), strong, r.tone === 'total' || r.tone === 'subtotal');
    }
    y += 2;
  }
  for (const note of j.notes) { need(LH); font(PDF_FONT.tiny); color(PDF_COLORS.soft); doc.text(note, M, y); y += LH - 0.6; }
}

/** PDF de plusieurs journaux (un journal = une nouvelle page). */
export async function buildJournalsPdf(journals: Journal[], head: JournalPdfHeader, compress = true): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  journals.forEach((j, i) => drawJournal(doc, j, head, i === 0));
  const pages = doc.getNumberOfPages();
  const printed = new Date().toLocaleString('fr-BE');
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont(PDF_FONT.family, 'normal'); doc.setFontSize(PDF_FONT.tiny);
    doc.setTextColor(PDF_COLORS.muted[0], PDF_COLORS.muted[1], PDF_COLORS.muted[2]);
    doc.text(`${fillVars(t('cashJournals.printedAt'), { date: printed })} - ${i}/${pages}`, 287, 205, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

/* ---------------------------------------------------------------- Excel */
/** Grille d'une feuille : titre, période, puis chaque section (titre, en-têtes, lignes, valeurs brutes). */
export function journalGrid(j: Journal, head: JournalPdfHeader): (string | number | null)[][] {
  const grid: (string | number | null)[][] = [[j.title], [head.companyName], [head.period], []];
  for (const sec of j.sections) {
    if (sec.title) grid.push([sec.title]);
    grid.push(sec.columns.map((c) => c.label));
    for (const r of sec.rows) grid.push(r.cells.map((c, i) => (sec.columns[i]?.kind === 'date' && typeof c === 'string' ? frDay(c) : c)));
    grid.push([]);
  }
  for (const n of j.notes) grid.push([n]);
  return grid;
}

/** Nom de feuille Excel valide (31 caractères, sans : \ / ? * [ ]) et unique. */
export function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[:\\/?*[\]]/g, ' ').slice(0, 28).trim() || 'Journal';
  let name = base; let i = 2;
  while (used.has(name)) name = `${base.slice(0, 26)} ${i++}`;
  used.add(name);
  return name;
}

export function buildJournalsXlsx(journals: Journal[], head: JournalPdfHeader): Uint8Array {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const j of journals) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(journalGrid(j, head)), sheetName(j.title, used));
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}

/** Téléchargement d'un fichier produit dans le navigateur. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
