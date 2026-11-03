/**
 * M8 — PDF des photos avant reparation d'un dossier accident (mission 09, carte 5) : une photo
 * par page A4, titre « Photos avant réparation — <modele> — <VIN> », legende et horodatage
 * sous chaque photo. Les photos sont relues depuis la GED (URL signee) et re-echantillonnees
 * (`fetchImageForPdf`) pour que le PDF reste une piece jointe de quelques Mo (meme technique
 * que la fiche de reprise M7). jsPDF en import dynamique (hors bundle initial).
 */
import { fetchImageForPdf, pdfSizingFor } from '@/lib/image-tools';
import { patchPdfText } from '@/modules/documents/pdf-text';

const PAGE_W = 210, PAGE_H = 297, MARGIN = 12;
const CONTENT_W = PAGE_W - MARGIN * 2;
const GREY: [number, number, number] = [102, 102, 102];
const BLACK: [number, number, number] = [17, 17, 17];

export type PhotosPdfItem = {
  /** URL signee de la photo (GED). */
  url: string;
  caption: string | null;
  takenAt: string | null;
  isVin: boolean;
};

export type PhotosPdfInput = {
  title: string;
  companyName: string;
  generatedAt: Date;
  items: PhotosPdfItem[];
};

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' });
};

/** Construit le PDF et renvoie ses octets (le nom du fichier est choisi par l'appelant). */
export async function buildAccidentPhotosPdf(input: PhotosPdfInput, labels: { vin: string; photo: string; page: string }): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  const sizing = pdfSizingFor(input.items.length);
  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const stamp = fmtDateTime(input.generatedAt.toISOString());

  let first = true;
  let index = 0;
  for (const item of input.items) {
    index++;
    if (!first) doc.addPage();
    first = false;
    // En-tete de page : titre, societe, horodatage de generation.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setColor(BLACK);
    doc.text(input.title, MARGIN, MARGIN + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setColor(GREY);
    doc.text(`${input.companyName} · ${stamp}`, MARGIN, MARGIN + 9);
    const top = MARGIN + 14;
    const img = await fetchImageForPdf(item.url, sizing);
    const captionParts = [
      `${labels.photo} ${index}/${input.items.length}`,
      item.isVin ? labels.vin : null,
      item.caption?.trim() || null,
      fmtDateTime(item.takenAt) || null,
    ].filter(Boolean) as string[];
    if (img) {
      let w = CONTENT_W;
      let h = (img.h / img.w) * w;
      const maxH = PAGE_H - top - MARGIN - 14;
      if (h > maxH) { h = maxH; w = (img.w / img.h) * h; }
      const x = MARGIN + (CONTENT_W - w) / 2;
      try { doc.addImage(img.dataUrl, 'JPEG', x, top, w, h, undefined, 'FAST'); } catch { /* image illisible : legende seule */ }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setColor(BLACK);
      doc.text(captionParts.join(' — '), PAGE_W / 2, top + h + 6, { align: 'center' });
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setColor(GREY);
      doc.text(captionParts.join(' — '), MARGIN, top + 6);
    }
  }
  if (first) {
    // Aucune photo : une page avec le titre seulement (ne devrait pas arriver : la checklist bloque).
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setColor(BLACK);
    doc.text(input.title, MARGIN, MARGIN + 4);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setColor(GREY);
    doc.text(`${input.title} · ${labels.page} ${i}/${pages}`, PAGE_W / 2, PAGE_H - 6, { align: 'center' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
