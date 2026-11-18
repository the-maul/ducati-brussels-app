/**
 * M8 — Document specifique « accident » (G8 : case « Imprimer le document specifique accident »
 * de l'onglet Assurance de l'OR), rattrapage G8 du 18/11/2026.
 *
 * Une page A4 pour l'assureur, l'expert et le client : OR, client, moto, cabinet d'assurance,
 * expert et date de passage, franchise a percevoir, valeur venale, cote, accord de demarrage des
 * travaux, travaux demandes, signatures. Distinct du dossier Ducati (formulaire Excel) qui part a
 * Ducati West Europe. jsPDF en import dynamique (hors bundle initial), libelles fournis par
 * l'appelant (i18n).
 */
import { patchPdfText } from '@/modules/documents/pdf-text';

const PAGE_W = 210, MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;
const GREY: [number, number, number] = [102, 102, 102];
const BLACK: [number, number, number] = [17, 17, 17];
const RULE: [number, number, number] = [204, 204, 204];

export type AccidentSheetInput = {
  companyName: string;
  generatedAt: Date;
  orNumber: string | null;
  orDate: string | null;
  client: string;
  clientContact: string | null;
  vehicle: string;
  vin: string | null;
  plate: string | null;
  mileage: number | null;
  insurer: { name: string; address: string | null; phone: string | null; email: string | null } | null;
  claimNumber: string | null;
  expert: string | null;
  expertVisit: string | null;
  deductible: string;
  marketValue: string;
  argusValue: string;
  workStartAccepted: boolean;
  workStartAcceptedAt: string | null;
  workDescription: string | null;
};

export type AccidentSheetLabels = {
  title: string; or: string; date: string; client: string; vehicle: string; vin: string; plate: string; mileage: string;
  insurer: string; claim: string; expert: string; visit: string; deductible: string; marketValue: string; argus: string;
  workStart: string; yes: string; no: string; work: string; signClient: string; signExpert: string; signWorkshop: string;
};

export async function buildAccidentSheetPdf(input: AccidentSheetInput, labels: AccidentSheetLabels): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  let y = MARGIN + 4;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); color(BLACK);
  doc.text(labels.title, MARGIN, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(GREY);
  doc.text(`${input.companyName} · ${input.generatedAt.toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}`, MARGIN, y + 5);
  y += 14;

  const section = (title: string) => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); color(BLACK);
    doc.text(title, MARGIN, y);
    y += 6;
  };
  const row = (label: string, value: string | null | undefined, x = MARGIN, w = CONTENT_W) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color(GREY);
    doc.text(label, x, y);
    doc.setFontSize(10); color(BLACK);
    const lines = doc.splitTextToSize(value && value.trim() ? value : '—', w - 45) as string[];
    doc.text(lines, x + 45, y);
    y += Math.max(1, lines.length) * 5;
  };

  section(`${labels.or} ${input.orNumber ?? ''}`.trim());
  row(labels.date, input.orDate);
  row(labels.client, [input.client, input.clientContact].filter(Boolean).join(' · '));
  row(labels.vehicle, input.vehicle);
  row(labels.vin, input.vin);
  row(labels.plate, input.plate);
  row(labels.mileage, input.mileage != null ? `${new Intl.NumberFormat('fr-BE').format(input.mileage)} km` : null);
  y += 2;

  section(labels.insurer);
  row(labels.insurer, input.insurer ? [input.insurer.name, input.insurer.address, input.insurer.phone, input.insurer.email].filter(Boolean).join(' · ') : null);
  row(labels.claim, input.claimNumber);
  row(labels.expert, input.expert);
  row(labels.visit, input.expertVisit);
  row(labels.deductible, input.deductible);
  row(labels.marketValue, input.marketValue);
  row(labels.argus, input.argusValue);
  row(labels.workStart, input.workStartAccepted ? `${labels.yes}${input.workStartAcceptedAt ? ` (${input.workStartAcceptedAt})` : ''}` : labels.no);
  y += 2;

  section(labels.work);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); color(BLACK);
  const work = doc.splitTextToSize(input.workDescription?.trim() || '—', CONTENT_W) as string[];
  doc.text(work, MARGIN, y);
  y += work.length * 5 + 10;

  // Trois cadres de signature.
  const boxW = (CONTENT_W - 8) / 3;
  const boxH = 28;
  [labels.signClient, labels.signExpert, labels.signWorkshop].forEach((l, i) => {
    const x = MARGIN + i * (boxW + 4);
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.rect(x, y, boxW, boxH);
    doc.setFontSize(8.5); color(GREY);
    doc.text(l, x + 2, y + 5);
  });

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}
