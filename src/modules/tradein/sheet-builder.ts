/**
 * M7 — Construction de la fiche de reprise imprimable depuis un dossier existant
 * (données véhicule + photos/documents GED). Réutilisé par la liste des reprises,
 * la fiche de reprise et l'écran de succès de l'assistant.
 */
import { getOroFull } from './api';
import { listAttachments, signedUrl } from '@/modules/documents/ged-api';
import { printRepriseSheet, type RepriseSheetSection, type RepriseSheetPhoto } from './reprise-print';
import { t } from '@/lib/i18n';

export const DOCS_FOLDER = 'Reprise-Documents';
export const PHOTOS_FOLDER = 'Reprise';

/** Charge le dossier + GED et ouvre la fiche imprimable (PDF via impression). */
export async function printSheetForOro(oroId: string): Promise<void> {
  const { oro, vehicle, client } = await getOroFull(oroId);
  if (!vehicle) return;

  const cv = Number(vehicle.power_cv ?? 0), kw = Number(vehicle.power_kw ?? 0);
  const sections: RepriseSheetSection[] = [
    { title: 'Données de base', rows: [
      { label: 'Marque', value: vehicle.brand ?? '' },
      { label: 'Modèle', value: vehicle.model ?? '' },
      { label: 'Type de véhicule', value: 'Occasion — reprise' },
    ] },
    { title: 'Historique du véhicule', rows: [
      { label: 'Année', value: vehicle.model_year ? String(vehicle.model_year) : '' },
      { label: 'Kilométrage', value: vehicle.mileage != null ? `${Number(vehicle.mileage).toLocaleString('fr-BE')} km` : '' },
    ] },
    { title: 'Caractéristiques techniques', rows: [
      { label: 'Puissance', value: cv > 0 ? `${cv} ch (${kw} kW)` : '' },
      { label: 'Carburant', value: vehicle.energy ?? '' },
      { label: 'Cylindrée', value: vehicle.displacement ? `${vehicle.displacement} cm³` : '' },
      { label: 'Numéro de châssis', value: vehicle.vin ?? '' },
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

  printRepriseSheet({
    companyName: t('app.name'),
    number: oro.number ?? '—',
    date: new Date().toLocaleDateString('fr-BE'),
    clientRef: client?.code ?? null, // code interne uniquement — jamais le nom
    title: [vehicle.brand, vehicle.model, vehicle.model_year ? `(${vehicle.model_year})` : null].filter(Boolean).join(' ') || 'Occasion',
    sections,
    accessories: [],
    remarks: vehicle.notes ?? null,
    photos,
    documents,
  });
}
