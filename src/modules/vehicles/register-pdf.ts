/**
 * M3 — Registre des vehicules a moteur : export PDF (A4 paysage) conforme a l'art. 28 AR n° 1 :
 * un en-tete par siege d'exploitation (societe, adresse, n° TVA, annee / mois), puis une ligne par
 * inscription avec les colonnes legales : n° d'ordre, date d'entree, plaque, chassis, donneur d'ordre
 * (n° TVA UE), nature de l'operation, date de sortie, reference de la facture ou motif.
 * Les lignes rectifiees sont barrees et renvoient a leur rectification ; une annulation est signalee.
 * Document imprime : couleurs et polices de `pdf-print-style` (charte §7), jamais de token CSS.
 */
import { patchPdfText } from '@/modules/documents/pdf-text';
import { PDF_COLORS, PDF_FONT } from '@/modules/sales/pdf-print-style';
import type { RegisterRow } from './register-api';

export type RegisterPdfHeader = {
  companyName: string;
  establishment: string;
  vatNumber: string | null;
  periodLabel: string;     // ex. « Annee 2026 » ou « Mars 2026 »
  printedAt: string;       // AAAA-MM-JJ
  labels: {
    title: string; subtitle: string; establishment: string; vat: string; period: string; printed: string; page: string;
    colNumber: string; colEntered: string; colPlate: string; colVin: string; colPrincipal: string; colNature: string;
    colLeft: string; colInvoice: string; colNote: string; rectifiedBy: string; rectifies: string; voided: string; backfill: string;
    stateLabels: Record<string, string>;
  };
};

const frDate = (iso: string | null): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

type Col = { key: string; w: number; get: (r: RegisterRow) => string };

export async function buildRegisterPdf(rows: ReadonlyArray<RegisterRow>, h: RegisterPdfHeader): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  const W = 297;
  const H = 210;
  const M = 10;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const numberOf = (id: string | null) => (id ? byId.get(id)?.number ?? '' : '');
  const L = h.labels;

  const cols: Col[] = [
    { key: 'n', w: 18, get: (r) => r.number },
    { key: 'in', w: 18, get: (r) => frDate(r.entered_at) },
    { key: 'plate', w: 22, get: (r) => r.plate ?? '' },
    { key: 'vin', w: 36, get: (r) => r.vin ?? '' },
    { key: 'principal', w: 44, get: (r) => [r.contact_name ?? '', r.principal_vat ? `${L.vat} ${r.principal_vat}` : ''].filter(Boolean).join(' - ') },
    { key: 'nature', w: 52, get: (r) => `${r.nature_code} - ${r.nature_label}` },
    { key: 'out', w: 18, get: (r) => frDate(r.left_at) },
    { key: 'inv', w: 40, get: (r) => r.invoice_ref ?? r.no_document_reason ?? '' },
    { key: 'note', w: 29, get: (r) => {
      const bits: string[] = [];
      if (r.rectified_by_id) bits.push(`${L.rectifiedBy} ${numberOf(r.rectified_by_id)}`);
      if (r.rectifies_id) bits.push(`${L.rectifies} ${numberOf(r.rectifies_id)}`);
      if (r.is_void) bits.push(L.voided);
      if (r.is_backfill) bits.push(L.backfill);
      return bits.join(' ; ');
    } },
  ];
  const headers: Record<string, string> = {
    n: L.colNumber, in: L.colEntered, plate: L.colPlate, vin: L.colVin, principal: L.colPrincipal,
    nature: L.colNature, out: L.colLeft, inv: L.colInvoice, note: L.colNote,
  };

  let page = 1;
  let y = 0;

  const header = () => {
    doc.setFont(PDF_FONT.family, 'bold');
    doc.setFontSize(PDF_FONT.title);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text(L.title, M, 14);
    doc.setFont(PDF_FONT.family, 'normal');
    doc.setFontSize(PDF_FONT.small);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text(L.subtitle, M, 19);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.setFontSize(PDF_FONT.body);
    doc.text(`${h.companyName}${h.vatNumber ? ` - ${L.vat} ${h.vatNumber}` : ''}`, M, 25);
    doc.text(`${L.establishment} : ${h.establishment}`, M, 29.5);
    doc.text(`${L.period} : ${h.periodLabel}`, W - M, 25, { align: 'right' });
    doc.text(`${L.printed} : ${frDate(h.printedAt)}`, W - M, 29.5, { align: 'right' });
    // en-tete du tableau
    y = 35;
    doc.setFillColor(...PDF_COLORS.zebra);
    doc.rect(M, y, W - 2 * M, 6, 'F');
    doc.setFont(PDF_FONT.family, 'bold');
    doc.setFontSize(PDF_FONT.small);
    let x = M + 1;
    for (const c of cols) { doc.text(headers[c.key], x, y + 4); x += c.w; }
    y += 6;
    doc.setFont(PDF_FONT.family, 'normal');
  };

  const footer = () => {
    doc.setFontSize(PDF_FONT.tiny);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text(`${L.page} ${page}`, W - M, H - 5, { align: 'right' });
    doc.setTextColor(...PDF_COLORS.ink);
  };

  header();
  doc.setFontSize(PDF_FONT.small);
  for (const r of rows) {
    const cells = cols.map((c) => doc.splitTextToSize(c.get(r), c.w - 2) as string[]);
    const lines = Math.max(1, ...cells.map((c) => c.length));
    const rowH = lines * 3.4 + 1.6;
    if (y + rowH > H - 12) { footer(); doc.addPage(); page += 1; header(); doc.setFontSize(PDF_FONT.small); }
    doc.setDrawColor(...PDF_COLORS.rule);
    doc.line(M, y + rowH, W - M, y + rowH);
    if (r.rectified_by_id || r.is_void) doc.setTextColor(...PDF_COLORS.muted); else doc.setTextColor(...PDF_COLORS.ink);
    let x = M + 1;
    cols.forEach((c, i) => { doc.text(cells[i], x, y + 3.6); x += c.w; });
    if (r.rectified_by_id) {
      // ligne barree : la correction reste lisible (circulaire 2018/C/47)
      doc.setDrawColor(...PDF_COLORS.frame);
      doc.line(M, y + rowH / 2, W - M, y + rowH / 2);
    }
    y += rowH;
  }
  footer();
  return doc.output('blob');
}
