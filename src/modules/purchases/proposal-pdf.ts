/**
 * M4 — PDF joint au mail fournisseur (mission 02, carte 4) : bon de commande ou demande de prix,
 * une ligne par article (réf. fournisseur, notre réf., désignation, quantité, PA HT, total).
 * Polices standard jsPDF, texte assaini (`patchPdfText`), aucun code couleur en dur (niveaux de gris).
 */
import { patchPdfText } from '@/modules/documents/pdf-text';
import { t } from '@/lib/i18n';
import type { SupplierFileLine } from './proposal';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} EUR`;

export async function buildSupplierPdf(p: {
  kind: 'price_request' | 'order';
  companyName: string;
  supplierName: string;
  supplierCustomerNo?: string | null;
  date: string;
  lines: SupplierFileLine[];
}): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  const withPrices = p.kind === 'order';
  const M = 15; const W = 210; let y = 20;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(p.companyName, M, y);
  doc.setFontSize(12);
  doc.text(t(p.kind === 'order' ? 'proposal.pdfTitleOrder' : 'proposal.pdfTitlePrice'), W - M, y, { align: 'right' });
  y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${t('proposal.pdfSupplier')} : ${p.supplierName}`, M, y);
  doc.text(`${t('proposal.pdfDate')} : ${p.date}`, W - M, y, { align: 'right' });
  y += 5;
  if (p.supplierCustomerNo) { doc.text(`${t('proposal.pdfCustomerNo')} : ${p.supplierCustomerNo}`, M, y); y += 5; }
  y += 4;

  const cols = withPrices
    ? [{ x: M, w: 30 }, { x: M + 30, w: 30 }, { x: M + 60, w: 62 }, { x: M + 122, w: 14 }, { x: M + 136, w: 22 }, { x: M + 158, w: 22 }]
    : [{ x: M, w: 34 }, { x: M + 34, w: 34 }, { x: M + 68, w: 92 }, { x: M + 160, w: 20 }];
  const heads = withPrices
    ? [t('proposal.colSupplierRef'), t('proposal.colRef'), t('proposal.colDesignation'), t('proposal.colQty'), t('proposal.colPa'), t('proposal.colAmount')]
    : [t('proposal.colSupplierRef'), t('proposal.colRef'), t('proposal.colDesignation'), t('proposal.colQty')];
  const right = (i: number) => i >= 3;

  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    heads.forEach((h, i) => doc.text(h, right(i) ? cols[i].x + cols[i].w : cols[i].x, y, right(i) ? { align: 'right' } : undefined));
    y += 2; doc.setDrawColor(120); doc.line(M, y, W - M, y); y += 5;
    doc.setFont('helvetica', 'normal');
  };
  header();

  let total = 0;
  for (const l of p.lines) {
    const des = doc.splitTextToSize(l.designation, cols[2].w - 2) as string[];
    const h = Math.max(1, des.length) * 4.2;
    if (y + h > 275) { doc.addPage(); y = 20; header(); }
    doc.text(l.supplierRef || '-', cols[0].x, y);
    doc.text(l.reference || '-', cols[1].x, y);
    doc.text(des, cols[2].x, y);
    doc.text(String(l.qty).replace('.', ','), cols[3].x + cols[3].w, y, { align: 'right' });
    if (withPrices) {
      doc.text(l.unitPrice == null ? '-' : eur(l.unitPrice), cols[4].x + cols[4].w, y, { align: 'right' });
      const a = l.unitPrice == null ? null : l.qty * l.unitPrice;
      if (a != null) total += a;
      doc.text(a == null ? '-' : eur(a), cols[5].x + cols[5].w, y, { align: 'right' });
    }
    y += h + 1.5;
  }
  if (withPrices) {
    y += 2; doc.line(M + 110, y, W - M, y); y += 5;
    doc.setFont('helvetica', 'bold');
    doc.text(`${t('proposal.pdfTotal')} : ${eur(Math.round(total * 100) / 100)}`, W - M, y, { align: 'right' });
  }
  y += 10;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(t(p.kind === 'order' ? 'proposal.pdfFooterOrder' : 'proposal.pdfFooterPrice'), M, y);
  return new Uint8Array(doc.output('arraybuffer'));
}
