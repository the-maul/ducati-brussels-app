/**
 * M7/M9 (B2) — Attestation « TVA : régime particulier de la marge pour les
 * moyens de transport d'occasion » (modèle sectoriel belge), reproduite
 * digitalement : champs préremplis (client + véhicule), statut du vendeur
 * coché, lieu/date, signature manuscrite incrustée. Sortie : PDF A4 (Blob).
 * Document imprimé : polices/couleurs en dur autorisées (charte §7).
 */
export type AttestationData = {
  lastName: string;
  firstName: string;
  sellerStatus: 'particulier' | 'morale_non_assujettie' | 'assujetti_44' | 'assujetti_56';
  brand: string;
  model: string;
  displacement: string;      // cylindrée (cm³)
  power: string;             // puissance moteur
  vin: string;
  firstRegistration: string; // date 1re mise en circulation (affichée telle quelle)
  place: string;             // « Fait à … »
  dateIso: string;           // YYYY-MM-DD
  signatureDataUrl: string | null;
};

const STATUS_LABELS: Record<AttestationData['sellerStatus'], string> = {
  particulier: 'particulier',
  morale_non_assujettie: 'personne morale non assujettie',
  assujetti_44: 'assujetti article 44, Code de la TVA',
  assujetti_56: 'assujetti article 56 § 2, Code de la TVA',
};

const frDate = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export async function buildMarginAttestationPdf(d: AttestationData): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 20;
  let y = 22;

  // En-tête magasin
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor('#C8102E');
  doc.text('DUCATI BRUXELLES', M, y);
  doc.setTextColor('#000000');
  y += 14;

  // Titre
  doc.setFontSize(13);
  doc.text('TVA : RÉGIME PARTICULIER DE LA MARGE', W / 2, y, { align: 'center' });
  y += 7;
  doc.text("POUR LES MOYENS DE TRANSPORT D'OCCASION", W / 2, y, { align: 'center' });
  y += 16;
  doc.setFontSize(14);
  doc.text('ATTESTATION', W / 2, y, { align: 'center' });
  y += 16;

  // Identité
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Je soussigné, nom : ${d.lastName.toUpperCase() || '................................'}`
    + `    prénom : ${d.firstName || '................................'},`, M, y);
  y += 12;

  // Statut — cases à cocher (la case du statut choisi est cochée)
  doc.text('agissant comme :', M, y);
  y += 7;
  for (const key of Object.keys(STATUS_LABELS) as AttestationData['sellerStatus'][]) {
    const checked = d.sellerStatus === key;
    doc.rect(M + 8, y - 3.6, 4.2, 4.2);
    if (checked) {
      doc.setFont('helvetica', 'bold');
      doc.text('X', M + 9.1, y - 0.2);
    }
    doc.setFont('helvetica', checked ? 'bold' : 'normal');
    doc.text(STATUS_LABELS[key], M + 15, y);
    doc.setFont('helvetica', 'normal');
    y += 6.5;
  }
  y += 2;
  doc.text('lors de la vente de mon moyen de transport désigné ci-après :', M, y);
  y += 11;

  // Véhicule
  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.text(label, M + 8, y);
    doc.setFont('helvetica', 'bold');
    doc.text(value || '—', M + 78, y);
    doc.setDrawColor('#999999');
    doc.line(M + 76, y + 1.2, W - M - 8, y + 1.2);
    doc.setDrawColor('#000000');
    y += 9;
  };
  row('MARQUE :', d.brand);
  row('MODÈLE :', d.model);
  row('CYLINDRÉE :', d.displacement ? `${d.displacement} cm³` : '');
  row('PUISSANCE MOTEUR :', d.power);
  row('NUMÉRO DU CHÂSSIS :', d.vin.toUpperCase());
  row('DATE DE 1RE MISE EN CIRCULATION :', d.firstRegistration);
  y += 4;

  // Déclaration légale
  const legal = "déclare n'avoir pu exercer aucun droit à déduction (ou restitution) de la TVA "
    + "ayant grevé l'achat, l'acquisition intracommunautaire ou l'importation dudit moyen de "
    + "transport, ni n'avoir eu droit à une exonération de la T.V.A.";
  const lines = doc.splitTextToSize(legal, W - 2 * M);
  doc.text(lines, M, y);
  y += lines.length * 5.4 + 12;

  // Lieu, date, signature
  doc.text(`Fait à ${d.place || '............................'}, le ${frDate(d.dateIso)}`, W - M, y, { align: 'right' });
  y += 10;
  doc.text('Signature', W - M - 52, y);
  if (d.signatureDataUrl) {
    try {
      doc.addImage(d.signatureDataUrl, 'PNG', W - M - 62, y + 2, 52, 17);
    } catch { /* signature illisible — champ laissé vide */ }
  }

  return doc.output('blob');
}
