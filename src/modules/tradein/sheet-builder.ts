/**
 * M7 — Construction de la fiche de reprise depuis un dossier existant
 * (données véhicule + photos/documents GED). Deux sorties :
 *  - downloadSheetForOro : PDF téléchargé directement (Téléchargements)
 *  - printSheetForOro : fenêtre d'impression (papier)
 * Réutilisé par la liste des reprises, la fiche et l'assistant.
 */
import { getOroFull } from './api';
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

/** Charge le dossier + la GED et construit la fiche (null si véhicule absent). */
export async function buildSheetForOro(oroId: string): Promise<RepriseSheet | null> {
  const { oro, vehicle, client } = await getOroFull(oroId);
  if (!vehicle) return null;

  const cv = Number(vehicle.power_cv ?? 0), kw = Number(vehicle.power_kw ?? 0);
  const vatDeductible = parseVatDeductible(vehicle.notes);
  const sections: RepriseSheetSection[] = [
    { title: 'Données de base', rows: [
      { label: 'Marque', value: vehicle.brand ?? '' },
      { label: 'Modèle', value: vehicle.model ?? '' },
      { label: 'Type de véhicule', value: 'Occasion — reprise' },
      { label: 'TVA', value: vatDeductible == null ? '' : vatDeductible ? 'Déductible' : 'Non déductible' },
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

  return {
    companyName: t('app.name'),
    number: oro.number ?? '—',
    date: new Date().toLocaleDateString('fr-BE'),
    clientRef: client?.code ?? null, // code interne uniquement — jamais le nom
    vatDeductible,
    title: [vehicle.brand, vehicle.model, vehicle.model_year ? `(${vehicle.model_year})` : null].filter(Boolean).join(' ') || 'Occasion',
    sections,
    accessories: [],
    remarks: vehicle.notes ?? null,
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
