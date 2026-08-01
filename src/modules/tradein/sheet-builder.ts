/**
 * M7 — Construction de la fiche de reprise depuis un dossier existant
 * (données véhicule + photos/documents GED). Deux sorties :
 *  - downloadSheetForOro : PDF téléchargé directement (Téléchargements)
 *  - printSheetForOro : fenêtre d'impression (papier)
 * Réutilisé par la liste des reprises, la fiche et l'assistant.
 */
import { getOroFull } from './api';
import { PHOTO_SLOTS, DOC_SLOTS, HERO_PHOTO_KEY, photoOrderIndex } from './reprise-wizard-data';
import { listAttachments, signedUrl } from '@/modules/documents/ged-api';
import { printRepriseSheet, type RepriseSheet, type RepriseSheetSection, type RepriseSheetPhoto } from './reprise-print';
import { downloadRepriseSheetPdf } from './reprise-pdf';
import { t } from '@/lib/i18n';

export const DOCS_FOLDER = 'Reprise-Documents';
export const PHOTOS_FOLDER = 'Reprise';

/** Extrait la mention « TVA déductible : Oui/Non » des notes structurées. */
export function parseVatDeductible(notes: string | null | undefined): boolean | null {
  const m = (notes ?? '').match(/TVA déductible\s*:\s*(Oui|Non)/i);
  if (!m) return null;
  return m[1].toLowerCase() === 'oui';
}

/**
 * Prix souhaité par le client + visibilité sur le PDF (marqueurs des notes).
 * « Prix souhaité : 5000 € » (valeur) + « Prix souhaité visible PDF : Oui/Non »
 * (marqueur interne). Visible par défaut si le marqueur est absent.
 */
export function parseWishedPrice(notes: string | null | undefined): { amount: string; visible: boolean } | null {
  const s = notes ?? '';
  const m = s.match(/Prix souhaité\s*:\s*([^\n]+)/i);
  if (!m) return null;
  const amount = m[1].replace(/€/g, '').trim();
  if (!amount) return null;
  const vm = s.match(/Prix souhaité visible PDF\s*:\s*(Oui|Non)/i);
  return { amount, visible: vm ? vm[1].toLowerCase() === 'oui' : true };
}

/** Retire les lignes-marqueurs de prix souhaité du texte de remarques. */
export function stripRepriseMarkers(notes: string | null | undefined): string {
  return (notes ?? '').split('\n')
    .filter((l) => !/^Prix souhaité(\s+visible PDF)?\s*:/i.test(l.trim()))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Formate un montant libre avec séparateur de milliers (espace normale). */
function fmtWished(amount: string): string {
  const n = Number(amount.replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return `${amount} €`;
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
}

/** Charge le dossier + la GED et construit la fiche (null si véhicule absent). */
export async function buildSheetForOro(oroId: string): Promise<RepriseSheet | null> {
  const { oro, vehicle, client } = await getOroFull(oroId);
  if (!vehicle) return null;

  const cv = Number(vehicle.power_cv ?? 0), kw = Number(vehicle.power_kw ?? 0);
  const vatDeductible = parseVatDeductible(vehicle.notes);
  const wished = parseWishedPrice(vehicle.notes);
  const sections: RepriseSheetSection[] = [
    { title: 'Données de base', rows: [
      { label: 'Marque', value: vehicle.brand ?? '' },
      { label: 'Modèle', value: vehicle.model ?? '' },
      { label: 'Type de véhicule', value: 'Occasion — reprise' },
      { label: 'TVA', value: vatDeductible == null ? '' : vatDeductible ? 'Déductible' : 'Non déductible' },
      // Prix souhaité par le client : uniquement si la case « Visible sur PDF »
      // est cochée (le marqueur de visibilité est retiré des remarques).
      { label: 'Prix souhaité', value: wished && wished.visible ? fmtWished(wished.amount) : '' },
    ] },
    { title: 'Historique du véhicule', rows: [
      { label: 'Année', value: vehicle.model_year ? String(vehicle.model_year) : '' },
      // Séparateur de milliers = espace NORMAL : l'insécable étroit de
      // toLocaleString('fr-BE') est hors WinAnsi et sort en « / » dans jsPDF.
      { label: 'Kilométrage', value: vehicle.mileage != null ? `${String(Math.round(Number(vehicle.mileage))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km` : '' },
    ] },
    { title: 'Caractéristiques techniques', rows: [
      { label: 'Puissance', value: cv > 0 ? `${cv} ch (${kw} kW)` : '' },
      { label: 'Carburant', value: vehicle.energy ?? '' },
      { label: 'Cylindrée', value: vehicle.displacement ? `${vehicle.displacement} cm³` : '' },
      // N° de châssis et n° moteur : volontairement ABSENTS du PDF partagé —
      // ces informations restent internes (fiche véhicule / ORO dans l'ERP).
    ] },
  ];

  // Photos / documents depuis la GED du véhicule (répartis par dossier)
  const atts = await listAttachments('vehicle', vehicle.id);
  const photos: RepriseSheetPhoto[] = [];
  const documents: RepriseSheetPhoto[] = [];
  for (const a of atts) {
    try {
      const url = await signedUrl(a.storage_path);
      if (!url) continue;
      const item = { label: a.note ?? a.file_name, url };
      if (a.folder === DOCS_FOLDER) documents.push(item);
      else if (a.folder === PHOTOS_FOLDER) photos.push(item);
    } catch { /* pièce illisible — ignorée */ }
  }
  // ORDRE DU FORMULAIRE : côté droit, côté gauche, faces, châssis/moteur,
  // pneus/plaquettes, puis photos libres (documents rendus à la fin du PDF).
  photos.sort((a, b) => photoOrderIndex(a.label) - photoOrderIndex(b.label));
  // Documents : ordre des emplacements du formulaire (factures, immat, COC),
  // sinon ils sortiraient dans l'ordre inverse de leur date d'ajout.
  const docOrder = (label: string) => {
    const i = DOC_SLOTS.findIndex((s) => s.label.toLowerCase() === label.trim().toLowerCase());
    return i >= 0 ? i : 999;
  };
  documents.sort((a, b) => docOrder(a.label) - docOrder(b.label));

  // Aperçu en tête de fiche : la photo « Côté droit » (sinon la 1re disponible)
  const heroLabel = PHOTO_SLOTS.find((s) => s.key === HERO_PHOTO_KEY)?.label ?? '';
  const heroPhoto = photos.find((p) => p.label.trim().toLowerCase() === heroLabel.toLowerCase()) ?? photos[0] ?? null;

  return {
    companyName: t('app.name'),
    number: oro.number ?? '—',
    date: new Date().toLocaleDateString('fr-BE'),
    clientRef: client?.code ?? null, // code interne uniquement — jamais le nom
    vatDeductible,
    title: [vehicle.brand, vehicle.model, vehicle.model_year ? `(${vehicle.model_year})` : null].filter(Boolean).join(' ') || 'Occasion',
    sections,
    accessories: [],
    // Remarques : notes brutes SANS les marqueurs de prix souhaité (le prix
    // apparaît en ligne dédiée ci-dessus, uniquement s'il est visible).
    remarks: stripRepriseMarkers(vehicle.notes) || null,
    heroPhoto,
    photos,
    documents,
  };
}

/** Télécharge le PDF de la fiche directement dans le navigateur. */
export async function downloadSheetForOro(oroId: string): Promise<void> {
  const sheet = await buildSheetForOro(oroId);
  if (sheet) await downloadRepriseSheetPdf(sheet);
}

/** Ouvre la fiche dans une fenêtre d'impression (papier). */
export async function printSheetForOro(oroId: string): Promise<void> {
  const sheet = await buildSheetForOro(oroId);
  if (sheet) printRepriseSheet(sheet);
}
