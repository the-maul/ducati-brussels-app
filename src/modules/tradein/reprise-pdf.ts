/**
 * M7 — Génération du PDF de la fiche de reprise, TÉLÉCHARGÉ directement dans
 * le navigateur (dossier Téléchargements → transmissible par mail/WhatsApp).
 * jsPDF en import dynamique (hors bundle initial). Mise en page A4 pro style
 * Ducati Bruxelles : en-tête rouge, sections, photos PLEINE LARGEUR.
 * Anonyme : seule la référence client interne apparaît.
 */
import type { RepriseSheet, RepriseSheetPhoto, RepriseSheetSection } from './reprise-print';
import { fetchImageForPdf, pdfSizingFor } from '@/lib/image-tools';
import { patchPdfText } from '@/modules/documents/pdf-text';

const PAGE_W = 210, PAGE_H = 297;          // A4 mm
const MARGIN = 12;
const CONTENT_W = PAGE_W - MARGIN * 2;      // 186 mm — photos pleine largeur
const RED: [number, number, number] = [200, 16, 46];   // #C8102E (identité)
const GREY: [number, number, number] = [102, 102, 102];
const BLACK: [number, number, number] = [17, 17, 17];

type Img = { dataUrl: string; format: 'JPEG'; w: number; h: number };

/**
 * Charge une image (URL signée) et la RÉ-ÉCHANTILLONNE à la résolution utile
 * pour l'impression A4 avant insertion (JPEG). Une photo de smartphone pèse
 * plusieurs Mo ; à 186 mm de large le PDF n'a besoin que de ~1400 px. C'est ce
 * qui fait passer la fiche de ~60 Mo à quelques Mo, sans perte visible.
 * `sizing` : 'thumb' pour l'aperçu en tête, sinon le réglage adaptatif calculé
 * d'après le nombre de clichés du dossier (pdfSizingFor).
 */
async function loadImage(url: string, sizing: Parameters<typeof fetchImageForPdf>[1]): Promise<Img | null> {
  const img = await fetchImageForPdf(url, sizing);
  return img ? { dataUrl: img.dataUrl, format: 'JPEG', w: img.w, h: img.h } : null;
}

export async function downloadRepriseSheetPdf(s: RepriseSheet): Promise<void> {
  const { jsPDF } = await import('jspdf');
  // compress: true → flux PDF déflatés (gain supplémentaire sur le texte/objets)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  // Compression adaptative : plus il y a de clichés, plus on serre, pour que la
  // fiche reste envoyable par e-mail quel que soit le nombre de photos.
  const sizing = pdfSizingFor(s.photos.length + s.documents.length);
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  let y = MARGIN;

  const ensure = (h: number) => {
    if (y + h > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN; }
  };
  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  // ── En-tête ──────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); setColor(BLACK);
  doc.text(s.companyName.toUpperCase(), MARGIN, y + 6);
  doc.setFontSize(8.5); setColor(GREY); doc.setFont('helvetica', 'normal');
  doc.text('FICHE DE REPRISE MOTO', MARGIN, y + 11);
  doc.setFont('courier', 'bold'); doc.setFontSize(12); setColor(BLACK);
  doc.text(s.number, PAGE_W - MARGIN, y + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor(GREY);
  doc.text(s.date, PAGE_W - MARGIN, y + 9.5, { align: 'right' });
  if (s.clientRef) doc.text(`Réf. client interne : ${s.clientRef}`, PAGE_W - MARGIN, y + 13.5, { align: 'right' });
  y += 16;
  doc.setDrawColor(RED[0], RED[1], RED[2]); doc.setLineWidth(1.1);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // ── Titre + mention TVA ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); setColor(BLACK);
  doc.text(s.title.toUpperCase(), MARGIN, y);
  if (s.vatDeductible != null) {
    const label = s.vatDeductible ? 'TVA DÉDUCTIBLE' : 'TVA NON DÉDUCTIBLE';
    doc.setFontSize(9); setColor(RED);
    doc.text(label, PAGE_W - MARGIN, y, { align: 'right' });
  }
  y += 7;

  // ── Aperçu du véhicule (photo « Côté droit ») juste sous marque/modèle ────
  if (s.heroPhoto) {
    const hero = await loadImage(s.heroPhoto.url, 'thumb');
    if (hero) {
      const maxW = CONTENT_W;
      const maxH = 78; // hauteur maîtrisée : le reste de la fiche tient sur la page
      let w = maxW;
      let h = (hero.h / hero.w) * w;
      if (h > maxH) { h = maxH; w = (hero.w / hero.h) * h; }
      ensure(h + 4);
      const x = MARGIN + (CONTENT_W - w) / 2;
      try {
        doc.addImage(hero.dataUrl, hero.format, x, y, w, h, undefined, 'FAST');
        doc.setDrawColor(221, 221, 221); doc.setLineWidth(0.25);
        doc.rect(x, y, w, h);
        y += h + 5;
      } catch { /* aperçu non bloquant */ }
    }
  }

  // ── Sections libellé / valeur ────────────────────────────────────────────
  const sectionTitle = (title: string) => {
    ensure(12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setColor(RED);
    doc.text(title.toUpperCase(), MARGIN, y);
    doc.setDrawColor(221, 221, 221); doc.setLineWidth(0.25);
    doc.line(MARGIN, y + 1.5, PAGE_W - MARGIN, y + 1.5);
    y += 6;
  };
  const renderSection = (sec: RepriseSheetSection) => {
    const rows = sec.rows.filter((r) => r.value);
    if (rows.length === 0) return;
    sectionTitle(sec.title);
    doc.setFontSize(10);
    for (const r of rows) {
      const lines = doc.splitTextToSize(r.value, CONTENT_W - 80) as string[];
      ensure(lines.length * 5 + 1);
      doc.setFont('helvetica', 'normal'); setColor(GREY);
      doc.text(r.label, MARGIN, y);
      doc.setFont('helvetica', 'bold'); setColor(BLACK);
      doc.text(lines, MARGIN + 80, y);
      y += lines.length * 5 + 1;
    }
    y += 3;
  };
  s.sections.forEach(renderSection);

  if (s.accessories.length) {
    sectionTitle('Accessoires & options');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setColor(BLACK);
    const lines = doc.splitTextToSize(s.accessories.join(' · '), CONTENT_W) as string[];
    ensure(lines.length * 5);
    doc.text(lines, MARGIN, y);
    y += lines.length * 5 + 3;
  }

  if (s.remarks) {
    sectionTitle('Remarques');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setColor(BLACK);
    const lines = doc.splitTextToSize(s.remarks, CONTENT_W) as string[];
    for (const line of lines) { ensure(5); doc.text(line, MARGIN, y); y += 5; }
    y += 3;
  }

  // ── Photos / documents en PLEINE LARGEUR ────────────────────────────────
  const renderPhotos = async (title: string, items: RepriseSheetPhoto[]) => {
    if (items.length === 0) return;
    sectionTitle(`${title} (${items.length})`);
    for (const p of items) {
      const img = await loadImage(p.url, sizing);
      if (!img) continue;
      let w = CONTENT_W;
      let h = (img.h / img.w) * w;
      const maxH = PAGE_H - MARGIN * 2 - 10;
      if (h > maxH) { h = maxH; w = (img.w / img.h) * h; }
      ensure(h + 8);
      const x = MARGIN + (CONTENT_W - w) / 2;
      // 'FAST' : pas de ré-encodage par jsPDF (l'image est déjà optimisée)
      try { doc.addImage(img.dataUrl, img.format, x, y, w, h, undefined, 'FAST'); } catch { continue; }
      y += h + 2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setColor(GREY);
      doc.text(p.label.toUpperCase(), PAGE_W / 2, y + 2, { align: 'center' });
      y += 7;
    }
  };
  await renderPhotos('Photos du véhicule', s.photos);
  await renderPhotos('Documents', s.documents);

  // ── Pied de page (toutes pages) ──────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setColor(GREY);
    doc.text(`${s.companyName} — ${s.number} · ${s.date} · page ${i}/${pages}`, PAGE_W / 2, PAGE_H - 6, { align: 'center' });
  }

  doc.save(`${s.number.replace(/[^\w-]+/g, '_')}.pdf`);
}
