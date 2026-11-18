/**
 * Rattrapage G8 (18/11/2026, lot parc) — PDF des affichettes (moto ou article), A4 portrait,
 * 1 ou 2 affichettes par page. Le contenu vient de `fillTemplate` (poster-rules.ts).
 * Document imprime : couleurs et polices de `pdf-print-style` (charte §7), jamais de token CSS.
 */
import { patchPdfText } from '@/modules/documents/pdf-text';
import { PDF_COLORS, PDF_FONT } from '@/modules/sales/pdf-print-style';
import { paginate, type PosterLine } from './poster-rules';

/** Tailles (pt) par style, pour 1 affichette par page ; 2 par page = x 0,72. */
const SIZE: Record<PosterLine['style'], number> = { title: 40, subtitle: 22, price: 48, text: 16 };

export async function buildPosterPdf(posters: ReadonlyArray<PosterLine[]>, perPage: 1 | 2): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  const W = 210;
  const H = 297;
  const M = 12;
  const scale = perPage === 2 ? 0.72 : 1;
  const ptToMm = 0.3528;

  const pages = paginate(posters, perPage);
  pages.forEach((page, pi) => {
    if (pi > 0) doc.addPage();
    const slotH = (H - 2 * M - (perPage === 2 ? M : 0)) / perPage;
    page.forEach((lines, si) => {
      const top = M + si * (slotH + M);
      doc.setDrawColor(...PDF_COLORS.frame);
      doc.setLineWidth(0.4);
      doc.rect(M, top, W - 2 * M, slotH);

      // hauteur totale pour centrer verticalement
      const blocks = lines.map((l) => {
        const size = SIZE[l.style] * scale;
        doc.setFont(PDF_FONT.family, l.style === 'text' ? 'normal' : 'bold');
        doc.setFontSize(size);
        const wrapped = l.text ? (doc.splitTextToSize(l.text, W - 2 * M - 16) as string[]) : [''];
        const lineH = size * ptToMm * 1.25;
        return { l, size, wrapped, h: wrapped.length * lineH, lineH };
      });
      const total = blocks.reduce((s, b) => s + b.h, 0);
      let y = top + Math.max(8, (slotH - total) / 2);
      for (const b of blocks) {
        doc.setFont(PDF_FONT.family, b.l.style === 'text' ? 'normal' : 'bold');
        doc.setFontSize(b.size);
        doc.setTextColor(...(b.l.style === 'subtitle' ? PDF_COLORS.muted : PDF_COLORS.ink));
        for (const w of b.wrapped) {
          y += b.lineH;
          if (y > top + slotH - 4) break;
          if (w) doc.text(w, W / 2, y - b.lineH * 0.25, { align: 'center' });
        }
      }
    });
  });
  return doc.output('blob');
}
