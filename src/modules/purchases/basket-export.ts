/**
 * M4 — Fichier ExportDucati.xls (mission 09, carte 2) : exactement comme la capture G8.
 * Feuille unique ; ligne 1 = en-têtes Line Number / Product Code / Day / Month / Year / Quantity
 * (colonnes A-F) ; lignes 2 et 3 vides ; lignes à partir de la ligne 4 : n° de ligne 1..n,
 * référence, jour, mois, année (date de la commande, nombres), quantité ; colonne G = nom du
 * client (NOM PRENOM en majuscules) pour les lignes commandées pour un client, vide sinon.
 * Format .xls (Excel 97, BIFF8 — réponse de Simon du 03/11 : « le format du document chargé »),
 * bibliothèque SheetJS (`xlsx`, bookType 'biff8'). Le fichier est téléchargé ET déposé en GED
 * (bucket ged, entité supplier_basket) ; il se régénère à la demande.
 */
import { supabase } from '@/integrations/supabase/client';
import { exportFileName, type BasketKind, type BasketLine } from './basket';
import { setBasketFile } from './basket-api';
import { buildExportBytes } from './basket-xls';

export { buildExportBytes, buildExportWorkbook, EXPORT_SHEET_NAME } from './basket-xls';
export const EXPORT_CONTENT_TYPE = 'application/vnd.ms-excel';
/** Entité GED et dossier où le fichier est conservé. */
export const BASKET_GED_ENTITY = 'supplier_basket';
export const BASKET_GED_FOLDER = 'Commandes fournisseur';

/** Déclenche le téléchargement dans le navigateur. */
export function downloadExport(kind: BasketKind, lines: BasketLine[], orderedAt: Date): void {
  const bytes = buildExportBytes(lines, orderedAt);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: EXPORT_CONTENT_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(kind);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Génère le fichier, le dépose en GED (bucket ged, entité supplier_basket, dossier
 * « Commandes fournisseur ») et l'enregistre sur le panier (basket_set_file). Rappelable :
 * chaque régénération dépose un nouveau fichier, le panier pointe sur le dernier.
 */
export async function storeExport(p: { companyId: string; basketId: string; kind: BasketKind; label: string; lines: BasketLine[]; orderedAt: Date }): Promise<string> {
  const bytes = buildExportBytes(p.lines, p.orderedAt);
  const fileName = exportFileName(p.kind);
  const path = `${p.companyId}/${BASKET_GED_ENTITY}/${p.basketId}/${Date.now()}_${fileName}`;
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: EXPORT_CONTENT_TYPE });
  const { error: ue } = await supabase.storage.from('ged').upload(path, blob, { upsert: false, contentType: EXPORT_CONTENT_TYPE });
  if (ue) throw ue;
  const { data: { user } } = await supabase.auth.getUser();
  const { data: att, error: ie } = await supabase.from('attachments').insert({
    company_id: p.companyId, entity_type: BASKET_GED_ENTITY, entity_id: p.basketId, file_name: fileName,
    storage_path: path, content_type: EXPORT_CONTENT_TYPE, size_bytes: blob.size, folder: BASKET_GED_FOLDER,
    note: `Commande Ducati ${p.label}`, uploaded_by: user?.id ?? null,
  }).select('id').single();
  if (ie) throw ie;
  await setBasketFile(p.basketId, path, (att as { id: string }).id);
  return path;
}

/** Lien de téléchargement temporaire (1 h) du fichier conservé. */
export async function storedExportUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('ged').createSignedUrl(path, 3600, { download: true });
  if (error) throw error;
  return data?.signedUrl ?? null;
}
