/**
 * Encaissements (rattrapage G8, 18/11/2026) — PDF (jsPDF, déjà utilisé par les documents de
 * vente) : lettre de relance (A4 ou ticket 80 mm), bon d'achat (A4 ou ticket), listes imprimables
 * (chèques à échéance, clients débiteurs). Module PUR : les données arrivent toutes faites.
 * Couleurs et polices : uniquement `pdf-print-style.ts` (règle 9 : rien en dur ici).
 */
import { patchPdfText } from '@/modules/documents/pdf-text';
import { code128Svg } from '@/modules/articles/barcode';
import { PDF_COLORS, PDF_FONT, PDF_PAGE, type Rgb } from '@/modules/sales/pdf-print-style';
import { eurPdf, dmy } from '@/modules/sales/document-pdf';

type Pdf = import('jspdf').jsPDF;

export type PdfCompany = { name: string; address?: string | null; zip?: string | null; city?: string | null; vat_number?: string | null; iban?: string | null };
export type PdfAddressee = { name: string; address?: string | null; zip?: string | null; city?: string | null };

async function newDoc(format: 'a4' | [number, number], orientation: 'p' | 'l' = 'p'): Promise<Pdf> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format, orientation, compress: true });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  return doc;
}
const bytesOf = (doc: Pdf) => new Uint8Array(doc.output('arraybuffer'));

function helpers(doc: Pdf) {
  return {
    color: (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]),
    draw: (c: Rgb) => doc.setDrawColor(c[0], c[1], c[2]),
    fill: (c: Rgb) => doc.setFillColor(c[0], c[1], c[2]),
    font: (size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => { doc.setFont(PDF_FONT.family, style); doc.setFontSize(size); },
  };
}

function barcodeBars(value: string): { x: number; w: number }[] {
  const svg = code128Svg(value, { module: 1, height: 10 });
  const bars: { x: number; w: number }[] = [];
  const re = /<rect x="([\d.]+)" y="0" width="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) bars.push({ x: Number(m[1]), w: Number(m[2]) });
  return bars;
}
function drawBarcode(doc: Pdf, value: string, x: number, y: number, width: number, height: number) {
  const bars = barcodeBars(value);
  if (!bars.length) return;
  const total = Math.max(...bars.map((b) => b.x + b.w));
  const k = width / total;
  doc.setFillColor(PDF_COLORS.ink[0], PDF_COLORS.ink[1], PDF_COLORS.ink[2]);
  for (const b of bars) doc.rect(x + b.x * k, y, b.w * k, height, 'F');
}

/* ================================================================== lettre de relance */
export type DunningLetterPdf = {
  format: 'A4' | 'ticket';
  company: PdfCompany;
  addressee: PdfAddressee;
  dateIso: string;
  subject: string;
  header: string; body: string; closing: string; footer: string;
  rows: { number: string | null; issueDate: string; dueDate: string; amountDue: number }[];
  totalDue: number; fees: number;
  isTest: boolean;
  labels: { place: string; colNumber: string; colDate: string; colDue: string; colAmount: string; totalDue: string; fees: string; totalToPay: string; testBanner: string; letterTitle: string };
};

const ticketHeight = (d: DunningLetterPdf) =>
  Math.max(120, Math.round(90 + d.rows.length * 9 + (d.header.length + d.body.length + d.closing.length + d.footer.length) / 6));

/** Une ou plusieurs lettres dans UN seul PDF (« Éditer relance(s) ») : une page (ou plus) par lettre. */
export async function buildDunningLettersPdf(letters: DunningLetterPdf[]): Promise<Uint8Array> {
  if (letters.length === 0) throw new Error('no_letter');
  const first = letters[0];
  const doc = await newDoc(first.format === 'ticket' ? [80, ticketHeight(first)] : 'a4');
  letters.forEach((d, i) => {
    if (i > 0) doc.addPage(d.format === 'ticket' ? [80, ticketHeight(d)] : 'a4', 'p');
    if (d.format === 'ticket') drawDunningTicket(doc, d); else drawDunningA4(doc, d);
  });
  return bytesOf(doc);
}
export async function buildDunningLetterPdf(d: DunningLetterPdf): Promise<Uint8Array> {
  return buildDunningLettersPdf([d]);
}

function drawDunningA4(doc: Pdf, d: DunningLetterPdf): void {
  const { color, draw, fill, font } = helpers(doc);
  const { margin: M, width: W, height: H, lineHeight: LH } = PDF_PAGE;
  const right = W - M;
  let y = M;

  if (d.isTest) {
    fill(PDF_COLORS.zebra); draw(PDF_COLORS.frame);
    doc.rect(M, y, right - M, 7, 'FD');
    font(PDF_FONT.small, 'bold'); color(PDF_COLORS.ink);
    doc.text(d.labels.testBanner, M + 2, y + 4.8);
    y += 10;
  }
  // Société (gauche)
  font(PDF_FONT.brand, 'bold'); color(PDF_COLORS.brand);
  doc.text(d.company.name, M, y + 6);
  font(PDF_FONT.small); color(PDF_COLORS.soft);
  let ly = y + 11;
  for (const l of [d.company.address, [d.company.zip, d.company.city].filter(Boolean).join(' '), d.company.vat_number].filter(Boolean) as string[]) {
    doc.text(l, M, ly); ly += 3.5;
  }
  // Destinataire (droite)
  const bx = W / 2 + 10;
  font(PDF_FONT.body, 'bold'); color(PDF_COLORS.ink);
  let ry = y + 22;
  doc.text(d.addressee.name, bx, ry); ry += LH;
  font(PDF_FONT.body);
  for (const l of [d.addressee.address, [d.addressee.zip, d.addressee.city].filter(Boolean).join(' ')].filter(Boolean) as string[]) {
    doc.text(l, bx, ry); ry += LH;
  }
  y = Math.max(ly, ry) + 10;
  font(PDF_FONT.body); color(PDF_COLORS.muted);
  doc.text(`${d.labels.place} ${dmy(d.dateIso)}`, right, y, { align: 'right' });
  y += 10;
  font(PDF_FONT.title, 'bold'); color(PDF_COLORS.ink);
  doc.text(doc.splitTextToSize(d.subject || d.labels.letterTitle, right - M) as string[], M, y);
  y += 9;

  const para = (text: string) => {
    if (!text.trim()) return;
    font(PDF_FONT.body); color(PDF_COLORS.ink);
    for (const p of text.split('\n')) {
      const lines = doc.splitTextToSize(p || ' ', right - M) as string[];
      for (const l of lines) { if (y > H - 25) { doc.addPage('a4', 'p'); y = M; } doc.text(l, M, y); y += LH + 0.6; }
    }
    y += 3;
  };
  para(d.header);
  para(d.body);

  // Tableau des factures
  const cols = [
    { label: d.labels.colNumber, x: M + 2, align: 'left' as const },
    { label: d.labels.colDate, x: M + 60, align: 'left' as const },
    { label: d.labels.colDue, x: M + 95, align: 'left' as const },
    { label: d.labels.colAmount, x: right - 2, align: 'right' as const },
  ];
  const head = () => {
    fill(PDF_COLORS.zebra); draw(PDF_COLORS.rule);
    doc.rect(M, y - 4, right - M, 6, 'F');
    font(PDF_FONT.small, 'bold'); color(PDF_COLORS.muted);
    for (const c of cols) doc.text(c.label, c.x, y, { align: c.align });
    y += 5;
  };
  head();
  font(PDF_FONT.body); color(PDF_COLORS.ink);
  for (const r of d.rows) {
    if (y > H - 30) { doc.addPage('a4', 'p'); y = M + 5; head(); font(PDF_FONT.body); color(PDF_COLORS.ink); }
    doc.text(r.number ?? '—', cols[0].x, y);
    doc.text(dmy(r.issueDate), cols[1].x, y);
    doc.text(dmy(r.dueDate), cols[2].x, y);
    doc.text(eurPdf(r.amountDue), cols[3].x, y, { align: 'right' });
    draw(PDF_COLORS.rule); doc.line(M, y + 1.5, right, y + 1.5);
    y += 5.5;
  }
  y += 2;
  const totals: [string, number, boolean][] = [[d.labels.totalDue, d.totalDue, d.fees <= 0.004]];
  if (d.fees > 0.004) { totals.push([d.labels.fees, d.fees, false], [d.labels.totalToPay, Math.round((d.totalDue + d.fees) * 100) / 100, true]); }
  for (const [label, value, strong] of totals) {
    font(PDF_FONT.body, strong ? 'bold' : 'normal'); color(PDF_COLORS.ink);
    doc.text(label, right - 50, y);
    doc.text(eurPdf(value), right - 2, y, { align: 'right' });
    y += LH + 1;
  }
  y += 5;
  para(d.closing);
  if (d.footer.trim()) {
    font(PDF_FONT.small); color(PDF_COLORS.soft);
    const lines = doc.splitTextToSize(d.footer, right - M) as string[];
    doc.text(lines, M, H - 14 - (lines.length - 1) * 3.2);
  }
}

function drawDunningTicket(doc: Pdf, d: DunningLetterPdf): void {
  const width = 80, M = 4;
  const { color, font } = helpers(doc);
  const right = width - M;
  let y = M + 4;
  const line = (text: string, size: number = PDF_FONT.small, style: 'normal' | 'bold' = 'normal', align: 'left' | 'center' | 'right' = 'left') => {
    font(size, style); color(PDF_COLORS.ink);
    for (const p of String(text).split('\n')) {
      const lines = doc.splitTextToSize(p || ' ', right - M) as string[];
      for (const l of lines) { doc.text(l, align === 'center' ? width / 2 : align === 'right' ? right : M, y, { align }); y += 3.6; }
    }
  };
  if (d.isTest) { line(d.labels.testBanner, PDF_FONT.small, 'bold', 'center'); y += 1; }
  line(d.company.name, PDF_FONT.body, 'bold', 'center');
  line([d.company.address, [d.company.zip, d.company.city].filter(Boolean).join(' ')].filter(Boolean).join(' - '), PDF_FONT.tiny, 'normal', 'center');
  y += 2;
  line(d.addressee.name, PDF_FONT.small, 'bold');
  line(`${d.labels.place} ${dmy(d.dateIso)}`, PDF_FONT.tiny);
  y += 1;
  line(d.subject || d.labels.letterTitle, PDF_FONT.small, 'bold');
  y += 1;
  if (d.header.trim()) line(d.header);
  if (d.body.trim()) line(d.body);
  y += 1;
  for (const r of d.rows) {
    font(PDF_FONT.tiny); color(PDF_COLORS.ink);
    doc.text(`${r.number ?? '—'}  ${dmy(r.dueDate)}`, M, y);
    doc.text(eurPdf(r.amountDue), right, y, { align: 'right' });
    y += 3.6;
  }
  y += 1;
  font(PDF_FONT.small, 'bold');
  doc.text(d.labels.totalDue, M, y); doc.text(eurPdf(d.totalDue), right, y, { align: 'right' }); y += 4;
  if (d.fees > 0.004) {
    font(PDF_FONT.small);
    doc.text(d.labels.fees, M, y); doc.text(eurPdf(d.fees), right, y, { align: 'right' }); y += 4;
    font(PDF_FONT.small, 'bold');
    doc.text(d.labels.totalToPay, M, y); doc.text(eurPdf(d.totalDue + d.fees), right, y, { align: 'right' }); y += 4;
  }
  y += 1;
  if (d.closing.trim()) line(d.closing);
  if (d.footer.trim()) line(d.footer, PDF_FONT.tiny);
}

/* ================================================================== bon d'achat */
export type VoucherPdf = {
  format: 'A4' | 'ticket';
  company: PdfCompany;
  number: string; amount: number; remaining: number; validFrom: string; validUntil: string;
  holder: string | null; note: string | null;
  labels: { title: string; number: string; amount: string; remaining: string; validity: string; holder: string; conditions: string };
};

export async function buildVoucherPdf(v: VoucherPdf): Promise<Uint8Array> {
  if (v.format === 'ticket') {
    const width = 80, M = 4;
    const doc = await newDoc([width, 120]);
    const { color, font } = helpers(doc);
    let y = M + 5;
    const c = (text: string, size: number, style: 'normal' | 'bold' = 'normal') => {
      font(size, style); color(PDF_COLORS.ink);
      for (const l of doc.splitTextToSize(text, width - 2 * M) as string[]) { doc.text(l, width / 2, y, { align: 'center' }); y += size * 0.45; }
      y += 1;
    };
    c(v.company.name, PDF_FONT.body, 'bold');
    c(v.labels.title, PDF_FONT.title, 'bold');
    c(eurPdf(v.amount), PDF_FONT.brand, 'bold');
    if (Math.abs(v.remaining - v.amount) > 0.004) c(`${v.labels.remaining} ${eurPdf(v.remaining)}`, PDF_FONT.small);
    c(`${v.labels.number} ${v.number}`, PDF_FONT.small, 'bold');
    drawBarcode(doc, v.number, M + 8, y, width - 2 * M - 16, 10); y += 14;
    if (v.holder) c(`${v.labels.holder} ${v.holder}`, PDF_FONT.small);
    c(`${v.labels.validity} ${dmy(v.validFrom)} - ${dmy(v.validUntil)}`, PDF_FONT.small);
    if (v.note) c(v.note, PDF_FONT.tiny);
    c(v.labels.conditions, PDF_FONT.tiny);
    return bytesOf(doc);
  }
  const doc = await newDoc('a4');
  const { color, draw, font } = helpers(doc);
  const { margin: M, width: W } = PDF_PAGE;
  const right = W - M;
  // Bon sur le tiers haut de la page (découpable), cadre.
  const top = M + 5, h = 95;
  draw(PDF_COLORS.frame); doc.setLineWidth(0.4);
  doc.rect(M, top, right - M, h);
  font(PDF_FONT.brand, 'bold'); color(PDF_COLORS.brand);
  doc.text(v.company.name, M + 6, top + 12);
  font(PDF_FONT.small); color(PDF_COLORS.soft);
  doc.text([v.company.address, [v.company.zip, v.company.city].filter(Boolean).join(' ')].filter(Boolean).join(' - '), M + 6, top + 17);
  font(22, 'bold'); color(PDF_COLORS.ink);
  doc.text(v.labels.title, W / 2, top + 34, { align: 'center' });
  font(30, 'bold');
  doc.text(eurPdf(v.amount), W / 2, top + 50, { align: 'center' });
  font(PDF_FONT.body); color(PDF_COLORS.muted);
  let y = top + 60;
  if (Math.abs(v.remaining - v.amount) > 0.004) { doc.text(`${v.labels.remaining} ${eurPdf(v.remaining)}`, W / 2, y, { align: 'center' }); y += 5; }
  if (v.holder) { doc.text(`${v.labels.holder} ${v.holder}`, M + 6, y + 6); }
  doc.text(`${v.labels.validity} ${dmy(v.validFrom)} - ${dmy(v.validUntil)}`, M + 6, y + 12);
  if (v.note) { font(PDF_FONT.small); doc.text(doc.splitTextToSize(v.note, 100) as string[], M + 6, y + 18); }
  font(PDF_FONT.body, 'bold'); color(PDF_COLORS.ink);
  doc.text(`${v.labels.number} ${v.number}`, right - 6, top + 70, { align: 'right' });
  drawBarcode(doc, v.number, right - 66, top + 73, 60, 12);
  font(PDF_FONT.tiny); color(PDF_COLORS.soft);
  doc.text(doc.splitTextToSize(v.labels.conditions, right - M - 12) as string[], M + 6, top + h - 4);
  return bytesOf(doc);
}

/* ================================================================== liste imprimable */
export type TablePdf = {
  title: string; subtitle?: string; companyName: string;
  columns: { label: string; width: number; align?: 'left' | 'right' }[];
  rows: string[][];
  totalLabel?: string; totalValue?: string;
  landscape?: boolean;
};

export async function buildTablePdf(t: TablePdf): Promise<Uint8Array> {
  const doc = await newDoc('a4', t.landscape ? 'l' : 'p');
  const { color, draw, fill, font } = helpers(doc);
  const M = PDF_PAGE.margin;
  const W = t.landscape ? PDF_PAGE.height : PDF_PAGE.width;
  const H = t.landscape ? PDF_PAGE.width : PDF_PAGE.height;
  const right = W - M;
  const scale = (right - M) / t.columns.reduce((s, c) => s + c.width, 0);
  const xs: number[] = [];
  let acc = M;
  for (const c of t.columns) { xs.push(acc); acc += c.width * scale; }
  let y = M + 4;
  let page = 1;
  const header = () => {
    font(PDF_FONT.title, 'bold'); color(PDF_COLORS.ink);
    doc.text(t.title, M, y);
    font(PDF_FONT.small); color(PDF_COLORS.muted);
    doc.text(t.companyName, right, y, { align: 'right' });
    y += 5;
    if (t.subtitle) { doc.text(t.subtitle, M, y); y += 5; }
    fill(PDF_COLORS.zebra);
    doc.rect(M, y - 3.6, right - M, 5.4, 'F');
    font(PDF_FONT.tiny, 'bold'); color(PDF_COLORS.muted);
    t.columns.forEach((c, i) => {
      const x = c.align === 'right' ? xs[i] + c.width * scale - 1 : xs[i] + 1;
      doc.text(c.label, x, y, { align: c.align === 'right' ? 'right' : 'left' });
    });
    y += 4.6;
  };
  header();
  for (const r of t.rows) {
    if (y > H - 14) {
      font(PDF_FONT.tiny); color(PDF_COLORS.soft); doc.text(String(page), right, H - 6, { align: 'right' });
      doc.addPage(); page += 1; y = M + 4; header();
    }
    font(PDF_FONT.tiny); color(PDF_COLORS.ink);
    t.columns.forEach((c, i) => {
      const max = c.width * scale - 2;
      const txt = (doc.splitTextToSize(String(r[i] ?? ''), max) as string[])[0] ?? '';
      const x = c.align === 'right' ? xs[i] + c.width * scale - 1 : xs[i] + 1;
      doc.text(txt, x, y, { align: c.align === 'right' ? 'right' : 'left' });
    });
    draw(PDF_COLORS.rule); doc.line(M, y + 1.3, right, y + 1.3);
    y += 4.4;
  }
  if (t.totalLabel) {
    y += 2;
    font(PDF_FONT.small, 'bold'); color(PDF_COLORS.ink);
    doc.text(t.totalLabel, M, y);
    if (t.totalValue) doc.text(t.totalValue, right, y, { align: 'right' });
  }
  font(PDF_FONT.tiny); color(PDF_COLORS.soft); doc.text(String(page), right, H - 6, { align: 'right' });
  return bytesOf(doc);
}

/** Ouvre un PDF dans un nouvel onglet (lire, imprimer, télécharger). */
export function openPdf(bytes: Uint8Array, win?: Window | null): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  if (win) win.location.href = url; else window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
