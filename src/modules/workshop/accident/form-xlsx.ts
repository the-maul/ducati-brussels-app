/**
 * M8 — Formulaire Excel « Aide Reparation Moto Accidentee » (mission 09, carte 5).
 *
 * Le fichier envoye a Ducati doit etre EXACTEMENT au format de leur modele (bordures, logo,
 * trois blocs de colonnes). Plutot que de le redessiner avec SheetJS (qui perd les styles), on
 * ouvre le modele vierge (public/modeles/…xlsx = docs/modeles/…xlsx), on remplit les cellules
 * de sa feuille 1 (XML) et on referme le zip : tout le reste (styles, image, mise en page) est
 * conserve tel quel. Le zip est lu / ecrit avec fflate (deja dans le projet via jsPDF).
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { accidentFormCells, fillAccidentFormSheetXml, type AccidentFormInput } from './rules';

export const ACCIDENT_FORM_TEMPLATE_URL = '/modeles/formulaire-commande-moto-accidentee.xlsx';
const SHEET1 = 'xl/worksheets/sheet1.xml';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Remplit le modele (octets du .xlsx vierge) et renvoie les octets du .xlsx rempli. */
export function fillAccidentFormTemplate(template: Uint8Array, input: AccidentFormInput): Uint8Array {
  const files = unzipSync(template);
  const sheet = files[SHEET1];
  if (!sheet) throw new Error('accident_form_template_invalid');
  const xml = fillAccidentFormSheetXml(strFromU8(sheet), accidentFormCells(input));
  files[SHEET1] = strToU8(xml);
  // Le fichier [Content_Types].xml doit rester en tete : on garde l'ordre d'origine de l'archive.
  return zipSync(files, { level: 6 });
}

/** Modele vierge servi par l'application (public/modeles). */
export async function loadAccidentFormTemplate(): Promise<Uint8Array> {
  const r = await fetch(ACCIDENT_FORM_TEMPLATE_URL);
  if (!r.ok) throw new Error('accident_form_template_missing');
  return new Uint8Array(await r.arrayBuffer());
}

/** Genere le formulaire dans le navigateur (modele + lignes pieces du devis). */
export async function buildAccidentFormXlsx(input: AccidentFormInput): Promise<Uint8Array> {
  return fillAccidentFormTemplate(await loadAccidentFormTemplate(), input);
}

export function xlsxBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: XLSX_MIME });
}

/** Telechargement direct (dossier Telechargements). */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
