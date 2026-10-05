/**
 * Préparation d'un fichier avant dépôt depuis l'espace client :
 *   - type MIME déduit de l'extension quand le navigateur ne le donne pas (Android) ;
 *   - photos réduites à 1 200 px et recompressées en JPEG (préréglage `portal` de
 *     `@/lib/image-tools`, le même esprit que la photo du parcours technicien) :
 *     une photo de téléphone de 5 à 10 Mo passe à quelques centaines de Ko.
 * Si le navigateur ne sait pas décoder l'image (HEIC hors Safari), on envoie l'original.
 *
 * Retour Simon du 05/10 : un PDF de 15 Mo passait. La limite est maintenant de
 * 10 Mo, annoncée à l'écran AVANT le choix du fichier, vérifiée ici avant tout
 * appel réseau, et re-vérifiée en base (portal_prepare_upload / _complete_upload).
 * Une image trop lourde est d'abord réduite : seul un fichier encore trop gros
 * après réduction (ou un PDF) est refusé, avec un message clair.
 */
import { compressImageFile } from '@/lib/image-tools';
import { t } from '@/lib/i18n';

/** Limite de dépôt, identique à celle de la base (portal_prepare_upload). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Libellé « 10 Mo » pour les écrans. */
export const MAX_UPLOAD_LABEL = '10 Mo';

const EXT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
};

/** Types acceptés par la base ; tout le reste est refusé avant l'envoi. */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export function guessContentType(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TYPES[ext] ?? 'application/octet-stream';
}

/** Poids lisible par un client : « 14,3 Mo ». */
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

/** Erreur « parlante » : son message est déjà le texte affiché au client. */
export class UploadRejected extends Error {}

/**
 * Renvoie le fichier à envoyer (image réduite à 1 200 px si possible) avec un type
 * MIME fiable. Lève une `UploadRejected` si le format n'est pas accepté ou si le
 * fichier reste trop lourd après réduction — jamais une erreur technique.
 */
export async function prepareFileForUpload(file: File): Promise<File> {
  const type = guessContentType(file);
  if (!ALLOWED_TYPES.includes(type)) throw new UploadRejected(t('portal.errors.fileType'));

  let out = file;
  if (type.startsWith('image/')) {
    const small = await compressImageFile(file.type === type ? file : new File([file], file.name, { type }), 'portal');
    if (small.size > 0 && small.size < file.size) out = small;
  }
  if (out.type !== guessContentType(out)) out = new File([out], out.name, { type: guessContentType(out) });

  if (out.size <= 0) throw new UploadRejected(t('portal.errors.fileEmpty'));
  if (out.size > MAX_UPLOAD_BYTES) {
    const key = type === 'application/pdf' ? 'portal.errors.pdfTooLarge' : 'portal.errors.imageTooLarge';
    throw new UploadRejected(t(key).replace('{size}', fileSizeLabel(out.size)).replace('{max}', MAX_UPLOAD_LABEL));
  }
  return out;
}
