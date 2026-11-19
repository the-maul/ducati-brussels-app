/**
 * M8 — Impression de l'OR et de la fiche de travail (PDF A4, jsPDF), rattrapage G8 du 18/11/2026.
 *
 * G8 « Edition Ordre de reparation » : type d'impression OR uniquement / fiche de travail uniquement /
 * OR + fiche de travail ; options « OR sans le nom du client » et « edition chiffree ».
 * - L'OR (remis au client) : societe, n°, recu le / promis le, operateur, client (sauf option),
 *   moto (marque, modele, reference, immat, chassis, km), travaux demandes, observations a la
 *   reception, points V / R coches, lignes (avec prix si chiffree), totaux, cadre de SIGNATURE DE DEPOT.
 * - La fiche de travail (atelier) : memes en-tete et moto, la grille complete des 30 points
 *   (cases V / R pre-cochees), les lignes, et la place pour les travaux effectues, le mecanicien,
 *   le temps passe.
 * Les « informations complementaires » (repair_orders.notes) ne sont JAMAIS imprimees.
 * Parcours mecanicien (19/11/2026) : lot C, etat de la moto a la reception + photos de reception en
 * ANNEXE (option) ; lot D, operations du plan d'entretien (fiche : liste cochee ; OR : operations non
 * realisees avec leur motif).
 * Document imprime : couleurs et polices de `sales/pdf-print-style` (charte §7), jamais de token CSS.
 */
import { patchPdfText } from '@/modules/documents/pdf-text';
import { PDF_COLORS, PDF_FONT, PDF_PAGE } from '@/modules/sales/pdf-print-style';
import { CHECK_POINTS, printLines, printParts, formatOrDate, type CheckPoints, type OrPrintOptions, type PrintLineIn } from './rules';

export type OrPdfLabels = {
  orTitle: string; ficheTitle: string; number: string; receivedAt: string; promisedAt: string; operator: string;
  client: string; vehicle: string; brandModel: string; reference: string; plate: string; vin: string; mileage: string;
  work: string; reception: string; checks: string; checkV: string; checkR: string; legendVR: string;
  colDesignation: string; colQty: string; colUnit: string; colTotal: string; warrantyMark: string;
  totalHt: string; totalVat: string; totalTtc: string;
  depositTitle: string; depositText: string; signClient: string; signReception: string; date: string;
  doneTitle: string; mechanic: string; timeSpent: string; page: string; none: string;
  /** Acompte verse (decision Q45 du 18/11) : imprime sur l'OR, chiffre ou non. */
  advance: string;
  checkLabels: Record<string, string>;
  /** Lots C et D du parcours mecanicien (19/11) : reception et operations du plan. */
  condition?: string; photosTitle?: string; missingPhotos?: string;
  opsTitle?: string; notDoneTitle?: string; opDone?: string; opNotDone?: string; opTodo?: string;
};

/** Photo de reception prete pour le PDF (JPEG allege). */
export type OrPdfPhoto = { label: string; comment: string | null; dataUrl: string; w: number; h: number };
/** Operation du plan d'entretien imprimee (fiche de travail). */
export type OrPdfOperation = { label: string; status: 'a_faire' | 'fait' | 'non_fait'; detail: string | null };

export type OrPdfData = {
  company: { name: string; address: string; vat: string | null; phone: string | null };
  or: {
    number: string | null; created_at: string; promised_at: string | null; operator: string | null; mileage: number | null;
    work_description: string | null; reception_notes: string | null; total_ht: number; total_vat: number; total_ttc: number;
  };
  checkPoints: CheckPoints;
  lines: PrintLineIn[];
  client: { name: string; address: string; phone: string | null; email: string | null } | null;
  vehicle: { brandModel: string; reference: string | null; plate: string | null; vin: string | null } | null;
  /** Acompte net percu sur l'OR (decision Q45 du 18/11) ; 0 / null = pas de ligne. */
  deposit?: number | null;
  /** Lot C : commentaire general, obligatoires manquantes (libelles), photos (annexe si option). */
  reception?: { comment: string | null; missing: string[]; photos: OrPdfPhoto[] } | null;
  /** Lot D : operations du plan d'entretien de l'OR. */
  operations?: OrPdfOperation[] | null;
};

const money = (n: number | null) => (n == null ? '' : `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} EUR`);
const kmText = (n: number | null) => (n == null ? '' : `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km`);

type Doc = {
  text: (...a: unknown[]) => unknown; setFont: (f: string, s?: string) => unknown; setFontSize: (n: number) => unknown;
  setTextColor: (r: number, g: number, b: number) => unknown; setDrawColor: (r: number, g: number, b: number) => unknown;
  setFillColor: (r: number, g: number, b: number) => unknown; setLineWidth: (n: number) => unknown;
  rect: (x: number, y: number, w: number, h: number, style?: string) => unknown; line: (a: number, b: number, c: number, d: number) => unknown;
  splitTextToSize: (s: string, w: number) => string[]; addPage: () => unknown; getNumberOfPages: () => number; setPage: (n: number) => unknown;
  output: (t: 'arraybuffer') => ArrayBuffer;
  addImage: (data: string, format: string, x: number, y: number, w: number, h: number) => unknown;
};

export async function buildOrPdf(data: OrPdfData, opts: OrPrintOptions, L: OrPdfLabels): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const raw = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  patchPdfText(raw as unknown as { text: (...a: unknown[]) => unknown });
  const doc = raw as unknown as Doc;
  const W = PDF_PAGE.width;
  const H = PDF_PAGE.height;
  const M = PDF_PAGE.margin;
  const LH = PDF_PAGE.lineHeight;
  const bottom = H - M - PDF_PAGE.footer;
  const parts = printParts(opts.mode);
  let y = M;
  let first = true;

  const ink = (c: readonly [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, bold = false) => { doc.setFont(PDF_FONT.family, bold ? 'bold' : 'normal'); doc.setFontSize(size); };
  const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M; } };
  const newSection = () => { if (!first) { doc.addPage(); y = M; } first = false; };

  const header = (title: string) => {
    font(PDF_FONT.brand, true); ink(PDF_COLORS.brand);
    doc.text(data.company.name, M, y + 5);
    font(PDF_FONT.small); ink(PDF_COLORS.muted);
    const co = [data.company.address, data.company.vat, data.company.phone].filter(Boolean).join(' - ');
    if (co) doc.text(doc.splitTextToSize(co, 110), M, y + 10);
    font(PDF_FONT.title, true); ink(PDF_COLORS.ink);
    doc.text(title, W - M, y + 5, { align: 'right' });
    font(PDF_FONT.body); ink(PDF_COLORS.ink);
    const meta = [
      `${L.number} ${data.or.number ?? ''}`,
      `${L.receivedAt} : ${formatOrDate(data.or.created_at)}`,
      data.or.promised_at ? `${L.promisedAt} : ${formatOrDate(data.or.promised_at)}` : '',
      data.or.operator ? `${L.operator} : ${data.or.operator}` : '',
    ].filter(Boolean);
    meta.forEach((m, i) => doc.text(m, W - M, y + 11 + i * LH, { align: 'right' }));
    y += 11 + meta.length * LH + 3;
    doc.setDrawColor(PDF_COLORS.frame[0], PDF_COLORS.frame[1], PDF_COLORS.frame[2]);
    doc.setLineWidth(0.3);
    doc.line(M, y, W - M, y);
    y += 4;
  };

  /** Cadres client / moto cote a cote. */
  const parties = () => {
    const colW = (W - 2 * M - 4) / 2;
    const clientLines = opts.hideClient || !data.client ? [] : [
      data.client.name, data.client.address, data.client.phone ?? '', data.client.email ?? '',
    ].filter((s) => s && s.trim());
    const v = data.vehicle;
    const vehLines = [
      v?.brandModel ? `${L.brandModel} : ${v.brandModel}` : '',
      v?.reference ? `${L.reference} : ${v.reference}` : '',
      v?.plate ? `${L.plate} : ${v.plate}` : '',
      v?.vin ? `${L.vin} : ${v.vin}` : '',
      `${L.mileage} : ${kmText(data.or.mileage) || L.none}`,
    ].filter(Boolean);
    const rows = Math.max(clientLines.length, vehLines.length, 1);
    const h = 7 + rows * LH + 2;
    ensure(h);
    doc.setDrawColor(PDF_COLORS.frame[0], PDF_COLORS.frame[1], PDF_COLORS.frame[2]);
    doc.setLineWidth(0.2);
    const drawBox = (x: number, title: string, lines: string[]) => {
      doc.rect(x, y, colW, h);
      font(PDF_FONT.small, true); ink(PDF_COLORS.muted);
      doc.text(title.toUpperCase(), x + 2, y + 4);
      font(PDF_FONT.body); ink(PDF_COLORS.ink);
      lines.forEach((s, i) => doc.text(doc.splitTextToSize(s, colW - 4)[0] ?? '', x + 2, y + 9 + i * LH));
    };
    if (!opts.hideClient) drawBox(M, L.client, clientLines.length ? clientLines : [L.none]);
    drawBox(opts.hideClient ? M : M + colW + 4, L.vehicle, vehLines);
    y += h + 4;
  };

  const block = (title: string, text: string | null) => {
    const body = (text ?? '').trim();
    if (!body) return;
    font(PDF_FONT.body);
    const wrapped = doc.splitTextToSize(body, W - 2 * M);
    ensure(6 + wrapped.length * LH);
    font(PDF_FONT.small, true); ink(PDF_COLORS.muted);
    doc.text(title.toUpperCase(), M, y + 3);
    font(PDF_FONT.body); ink(PDF_COLORS.ink);
    doc.text(wrapped, M, y + 7.5);
    y += 6 + wrapped.length * LH + 2;
  };

  /** OR : seulement les points coches, sur deux colonnes. */
  const checkedPoints = () => {
    const marked = CHECK_POINTS.filter((c) => data.checkPoints[c]);
    if (!marked.length) return;
    const rows = Math.ceil(marked.length / 2);
    ensure(7 + rows * LH);
    font(PDF_FONT.small, true); ink(PDF_COLORS.muted);
    doc.text(`${L.checks.toUpperCase()} (${L.legendVR})`, M, y + 3);
    font(PDF_FONT.body); ink(PDF_COLORS.ink);
    const colW = (W - 2 * M) / 2;
    marked.forEach((c, i) => {
      const col = i < rows ? 0 : 1;
      const row = i < rows ? i : i - rows;
      doc.text(`[${data.checkPoints[c]}] ${L.checkLabels[c] ?? c}`, M + col * colW, y + 7.5 + row * LH);
    });
    y += 7 + rows * LH + 2;
  };

  /** Fiche : la grille complete des 30 points, cases V / R (pre-cochees), deux colonnes. */
  const checkGrid = () => {
    const rows = Math.ceil(CHECK_POINTS.length / 2);
    const rh = 5;
    ensure(8 + rows * rh);
    font(PDF_FONT.small, true); ink(PDF_COLORS.muted);
    doc.text(`${L.checks.toUpperCase()} (${L.legendVR})`, M, y + 3);
    const colW = (W - 2 * M - 4) / 2;
    const top = y + 6;
    doc.setDrawColor(PDF_COLORS.rule[0], PDF_COLORS.rule[1], PDF_COLORS.rule[2]);
    doc.setLineWidth(0.2);
    CHECK_POINTS.forEach((c, i) => {
      const col = i < rows ? 0 : 1;
      const row = i < rows ? i : i - rows;
      const x = M + col * (colW + 4);
      const yy = top + row * rh;
      const mark = data.checkPoints[c];
      // Deux cases : V puis R.
      font(PDF_FONT.tiny, true); ink(PDF_COLORS.muted);
      doc.rect(x, yy, 4, 4);
      doc.text(L.checkV, x + 2, yy + 3.2, { align: 'center' });
      doc.rect(x + 5, yy, 4, 4);
      doc.text(L.checkR, x + 7, yy + 3.2, { align: 'center' });
      if (mark) {
        const bx = mark === 'V' ? x : x + 5;
        doc.setFillColor(PDF_COLORS.frame[0], PDF_COLORS.frame[1], PDF_COLORS.frame[2]);
        doc.rect(bx + 0.8, yy + 0.8, 2.4, 2.4, 'F');
      }
      font(PDF_FONT.small); ink(PDF_COLORS.ink);
      doc.text(L.checkLabels[c] ?? c, x + 11, yy + 3.2);
    });
    y = top + rows * rh + 3;
  };

  const linesTable = (priced: boolean) => {
    const rows = printLines(data.lines, priced);
    if (!rows.length) return;
    const xQty = priced ? W - M - 62 : W - M - 2;
    const xUnit = W - M - 32;
    const xTot = W - M - 2;
    ensure(8 + LH * 2);
    doc.setFillColor(PDF_COLORS.zebra[0], PDF_COLORS.zebra[1], PDF_COLORS.zebra[2]);
    doc.rect(M, y, W - 2 * M, 6, 'F');
    font(PDF_FONT.small, true); ink(PDF_COLORS.muted);
    doc.text(L.colDesignation.toUpperCase(), M + 2, y + 4);
    doc.text(L.colQty.toUpperCase(), xQty, y + 4, { align: 'right' });
    if (priced) { doc.text(L.colUnit.toUpperCase(), xUnit, y + 4, { align: 'right' }); doc.text(L.colTotal.toUpperCase(), xTot, y + 4, { align: 'right' }); }
    y += 7;
    font(PDF_FONT.body); ink(PDF_COLORS.ink);
    const desigW = xQty - 16 - M;
    for (const r of rows) {
      const label = `${r.warranty ? `[${L.warrantyMark}] ` : ''}${r.designation}`;
      const wrapped = doc.splitTextToSize(label, desigW);
      ensure(wrapped.length * LH + 1);
      doc.text(wrapped, M + 2, y + 3);
      if (r.kind !== 'texte') doc.text(String(r.quantity).replace('.', ','), xQty, y + 3, { align: 'right' });
      if (priced && r.unitTtc != null) doc.text(money(r.unitTtc), xUnit, y + 3, { align: 'right' });
      if (priced && r.totalTtc != null) doc.text(money(r.totalTtc), xTot, y + 3, { align: 'right' });
      y += wrapped.length * LH + 1;
      doc.setDrawColor(PDF_COLORS.rule[0], PDF_COLORS.rule[1], PDF_COLORS.rule[2]);
      doc.line(M, y - 0.5, W - M, y - 0.5);
    }
    y += 2;
    if (priced) {
      ensure(LH * 3 + 4);
      const lx = W - M - 60;
      font(PDF_FONT.body);
      doc.text(L.totalHt, lx, y + 3); doc.text(money(data.or.total_ht), xTot, y + 3, { align: 'right' });
      doc.text(L.totalVat, lx, y + 3 + LH); doc.text(money(data.or.total_vat), xTot, y + 3 + LH, { align: 'right' });
      font(PDF_FONT.body, true);
      doc.text(L.totalTtc, lx, y + 3 + 2 * LH); doc.text(money(data.or.total_ttc), xTot, y + 3 + 2 * LH, { align: 'right' });
      y += LH * 3 + 4;
    }
  };

  /** Acompte verse (decision Q45) : sur l'OR remis au client, meme non chiffre. */
  const advance = () => {
    const a = Number(data.deposit ?? 0);
    if (!(Math.abs(a) >= 0.005)) return;
    ensure(LH + 3);
    font(PDF_FONT.body, true); ink(PDF_COLORS.ink);
    doc.text(L.advance, W - M - 60, y + 3);
    doc.text(money(a), W - M - 2, y + 3, { align: 'right' });
    font(PDF_FONT.body);
    y += LH + 3;
  };

  const deposit = () => {
    font(PDF_FONT.small);
    const text = doc.splitTextToSize(L.depositText, W - 2 * M - 4);
    const h = 8 + text.length * 3.4 + 24;
    ensure(h);
    doc.setDrawColor(PDF_COLORS.frame[0], PDF_COLORS.frame[1], PDF_COLORS.frame[2]);
    doc.setLineWidth(0.3);
    doc.rect(M, y, W - 2 * M, h);
    font(PDF_FONT.small, true); ink(PDF_COLORS.muted);
    doc.text(L.depositTitle.toUpperCase(), M + 2, y + 4);
    font(PDF_FONT.small); ink(PDF_COLORS.soft);
    doc.text(text, M + 2, y + 8);
    const sy = y + 8 + text.length * 3.4 + 4;
    const half = (W - 2 * M) / 2;
    ink(PDF_COLORS.ink);
    doc.text(`${L.date} : ____ / ____ / ________`, M + 2, sy);
    doc.text(L.signClient, M + 2, sy + 6);
    doc.text(L.signReception, M + half + 2, sy + 6);
    y += h + 3;
  };

  const doneBox = () => {
    const h = 44;
    ensure(h);
    doc.setDrawColor(PDF_COLORS.frame[0], PDF_COLORS.frame[1], PDF_COLORS.frame[2]);
    doc.setLineWidth(0.3);
    doc.rect(M, y, W - 2 * M, h);
    font(PDF_FONT.small, true); ink(PDF_COLORS.muted);
    doc.text(L.doneTitle.toUpperCase(), M + 2, y + 4);
    doc.setDrawColor(PDF_COLORS.rule[0], PDF_COLORS.rule[1], PDF_COLORS.rule[2]);
    for (let i = 1; i <= 5; i++) doc.line(M + 2, y + 4 + i * 6, W - M - 2, y + 4 + i * 6);
    font(PDF_FONT.small); ink(PDF_COLORS.ink);
    const third = (W - 2 * M) / 3;
    doc.text(`${L.mechanic} : ______________`, M + 2, y + h - 3);
    doc.text(`${L.timeSpent} : ________`, M + third + 2, y + h - 3);
    doc.text(`${L.date} : ____ / ____ / ________`, M + 2 * third + 2, y + h - 3);
    y += h + 3;
  };

  const rec = data.reception ?? null;
  const ops = data.operations ?? [];
  const missingText = rec?.missing.length && L.missingPhotos ? `${L.missingPhotos} : ${rec.missing.join(', ')}` : null;
  const conditionBlock = () => block(L.condition ?? L.reception, [rec?.comment ?? '', missingText ?? ''].filter(Boolean).join('\n'));
  /** OR (client) : les operations du plan non realisees, avec leur motif. */
  const notDoneBlock = () => {
    const list = ops.filter((o) => o.status === 'non_fait');
    if (!list.length) return;
    block(L.notDoneTitle ?? '', list.map((o) => `- ${o.label}${o.detail ? ` (${o.detail})` : ''}`).join('\n'));
  };
  /** Fiche de travail : la liste des operations du plan, case faite / non faite / a faire. */
  const opsList = () => {
    if (!ops.length) return;
    ensure(8 + LH * 2);
    font(PDF_FONT.small, true); ink(PDF_COLORS.muted);
    doc.text((L.opsTitle ?? '').toUpperCase(), M, y + 3);
    y += 6;
    doc.setDrawColor(PDF_COLORS.rule[0], PDF_COLORS.rule[1], PDF_COLORS.rule[2]);
    doc.setLineWidth(0.2);
    for (const o of ops) {
      font(PDF_FONT.small);
      const mark = o.status === 'fait' ? (L.opDone ?? 'OK') : o.status === 'non_fait' ? (L.opNotDone ?? '-') : (L.opTodo ?? '');
      const text = `${o.label}${o.status === 'non_fait' && o.detail ? ` (${o.detail})` : ''}`;
      const wrapped = doc.splitTextToSize(text, W - 2 * M - 34);
      ensure(wrapped.length * 3.6 + 1.5);
      doc.rect(M, y, 3.6, 3.6);
      if (o.status !== 'a_faire') {
        doc.setFillColor(PDF_COLORS.frame[0], PDF_COLORS.frame[1], PDF_COLORS.frame[2]);
        doc.rect(M + 0.8, y + 0.8, 2, 2, 'F');
      }
      ink(PDF_COLORS.ink);
      doc.text(wrapped, M + 6, y + 3);
      ink(PDF_COLORS.muted);
      doc.text(mark, W - M, y + 3, { align: 'right' });
      y += wrapped.length * 3.6 + 1.5;
    }
    y += 2;
  };
  /** Annexe : photos de reception, deux par ligne, avec case et commentaire. */
  const photosAnnex = () => {
    const photos = rec?.photos ?? [];
    if (!photos.length) return;
    doc.addPage(); y = M;
    header(L.photosTitle ?? L.orTitle);
    const colW = (W - 2 * M - 6) / 2;
    const maxH = 72;
    let col = 0;
    let rowH = 0;
    for (const p of photos) {
      const ratio = p.w > 0 ? p.h / p.w : 0.75;
      const h = Math.min(maxH, colW * ratio);
      const w = h / ratio;
      font(PDF_FONT.small);
      const caption = doc.splitTextToSize(`${p.label}${p.comment ? ` : ${p.comment}` : ''}`, colW);
      const cellH = h + 2 + caption.length * 3.4 + 4;
      if (col === 0) ensure(cellH);
      const x = M + col * (colW + 6);
      try { doc.addImage(p.dataUrl, 'JPEG', x, y, w, h); } catch { /* image illisible : la legende reste */ }
      ink(PDF_COLORS.ink);
      doc.text(caption, x, y + h + 4);
      rowH = Math.max(rowH, cellH);
      col += 1;
      if (col === 2) { col = 0; y += rowH; rowH = 0; }
    }
    if (col) y += rowH;
  };

  if (parts.or) {
    newSection();
    header(L.orTitle);
    parties();
    block(L.work, data.or.work_description);
    block(L.reception, data.or.reception_notes);
    conditionBlock();
    checkedPoints();
    notDoneBlock();
    linesTable(opts.priced);
    advance();
    deposit();
  }
  if (parts.fiche) {
    newSection();
    header(L.ficheTitle);
    parties();
    block(L.work, data.or.work_description);
    block(L.reception, data.or.reception_notes);
    conditionBlock();
    checkGrid();
    opsList();
    linesTable(opts.priced);
    doneBox();
  }
  photosAnnex();

  // Pied : numero de page.
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font(PDF_FONT.tiny); ink(PDF_COLORS.muted);
    doc.text(`${data.or.number ?? ''} - ${L.page} ${i} / ${n}`, W - M, H - M / 2, { align: 'right' });
  }
  return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
}
