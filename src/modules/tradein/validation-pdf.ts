/**
 * M7/M9 — PDF d'archive de la reprise validée : TOUTES les données (client,
 * véhicule, checklist de réception, régime TVA, prix de reprise) MAIS JAMAIS
 * les prix de vente (demande magasin). Attaché en GED à la fiche du véhicule
 * ET à celle du client. Document imprimé : styles en dur autorisés (charte §7).
 */
import { uploadAttachment } from '@/modules/documents/ged-api';
import { CHECKLIST_KEYS, type ValidationData } from './validate-data';
import { t } from '@/lib/i18n';

export type ValidationSheetData = {
  number: string;                       // REP-AAAA-NNNNN
  client: { name: string; company?: string | null; email?: string | null; phone?: string | null; address?: string | null };
  vehicle: { label: string; vin?: string | null; engine?: string | null; mileage?: number | null; firstRegistration?: string | null; displacement?: number | null; power?: string | null };
  data: ValidationData;
  attestation: { place: string; date: string; signed: boolean } | null;
};

// Espaces insécables (U+00A0 / U+202F) remplacés : hors WinAnsi, jsPDF les rendrait mal
const clean = (s: string) => s.split(String.fromCharCode(0xA0)).join(' ').split(String.fromCharCode(0x202F)).join(' ');
const eur = (n: number) => clean(`${n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`);

export async function buildValidationPdf(s: ValidationSheetData): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 16;
  let y = 0;

  // Bandeau titre
  doc.setFillColor('#C8102E');
  doc.rect(0, 0, W, 22, 'F');
  doc.setTextColor('#FFFFFF');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`${t('tradein.valPdfTitle')} ${s.number}`, M, 14);
  doc.setTextColor('#000000');
  y = 32;

  const section = (title: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor('#C8102E');
    doc.text(title.toUpperCase(), M, y);
    doc.setTextColor('#000000');
    doc.setDrawColor('#C8102E');
    doc.line(M, y + 1.5, W - M, y + 1.5);
    doc.setDrawColor('#000000');
    y += 8;
  };
  const row = (label: string, value: string | null | undefined) => {
    if (!value) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(label, M, y);
    doc.setFont('helvetica', 'bold');
    const lines = doc.splitTextToSize(value, W - M - 78);
    doc.text(lines, M + 62, y);
    y += Math.max(1, lines.length) * 5.2 + 0.8;
    if (y > 270) { doc.addPage(); y = 20; }
  };

  section(t('tradein.valPdfClient'));
  row(t('contacts.lastName') + ' :', s.client.name);
  row(t('contacts.companyName') + ' :', s.client.company ?? '');
  row('E-mail :', s.client.email ?? '');
  row(t('contacts.phone') + ' :', s.client.phone ?? '');
  row(t('contacts.street') + ' :', s.client.address ?? '');
  y += 3;

  section(t('tradein.valPdfVehicle'));
  row(t('tradein.colMoto') + ' :', s.vehicle.label);
  row('VIN :', s.vehicle.vin?.toUpperCase() ?? '');
  row(t('vehicles.engineNumber') + ' :', s.vehicle.engine ?? '');
  row(t('vehicles.mileage') + ' :', s.vehicle.mileage != null ? clean(`${s.vehicle.mileage.toLocaleString('fr-BE')} km`) : '');
  row(t('vehicles.firstRegistration') + ' :', s.vehicle.firstRegistration ?? '');
  row(t('vehicles.displacement') + ' :', s.vehicle.displacement != null ? `${s.vehicle.displacement} cm³` : '');
  row(t('tradein.valPower') + ' :', s.vehicle.power ?? '');
  y += 3;

  section(t('tradein.valStep1Title'));
  for (const key of CHECKLIST_KEYS) {
    const checked = s.data.checklist[key];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.rect(M, y - 3.4, 3.8, 3.8);
    if (checked) { doc.setFont('helvetica', 'bold'); doc.text('X', M + 0.9, y - 0.2); doc.setFont('helvetica', 'normal'); }
    doc.text(t(`tradein.chk_${key}`), M + 7, y);
    y += 6;
    if (y > 270) { doc.addPage(); y = 20; }
  }
  y += 3;

  section(t('tradein.valPdfTerms'));
  row(t('tradein.valSellerStatus') + ' :', t(`tradein.vat_${s.data.seller_vat_status}`));
  row(t('tradein.valVatRate') + ' :', `${s.data.vat_rate} %`);
  row(t('tradein.valBuyTtc') + ' :', eur(s.data.buy_price_ttc));
  row(t('tradein.valBuyHt') + ' :', eur(s.data.buy_price_ht));
  if (s.attestation) {
    row(t('tradein.attTitleShort') + ' :',
      `${s.attestation.signed ? t('tradein.attSigned') : t('tradein.attNotSigned')} — ${s.attestation.place}, ${s.attestation.date}`);
  }
  row(t('tradein.valClassification') + ' :',
    `${s.data.classification.supplier} / ${s.data.classification.rayon} / ${s.data.classification.sub_rayon} / ${s.data.classification.category}`);

  // Pied de page
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor('#666666');
  doc.text('DUCATI BRUXELLES', M, 289);
  doc.text(new Date().toLocaleDateString('fr-BE'), W - M, 289, { align: 'right' });

  return doc.output('blob');
}

/** Attache un PDF en GED (véhicule et/ou contact) — best effort, non bloquant. */
export async function attachPdfToGed(
  companyId: string, blob: Blob, fileName: string,
  targets: { entityType: 'vehicle' | 'contact'; entityId: string }[],
  folder: string, note: string,
): Promise<void> {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  for (const tgt of targets) {
    try {
      await uploadAttachment(companyId, tgt.entityType, tgt.entityId, file, Date.now() + Math.floor(Math.random() * 1000), note, folder);
    } catch { /* GED indisponible — le PDF reste téléchargeable */ }
  }
}
