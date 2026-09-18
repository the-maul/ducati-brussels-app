/**
 * Préparation d'un fichier avant dépôt depuis le téléphone :
 *   - type MIME déduit de l'extension quand le navigateur ne le donne pas (Android) ;
 *   - photos réduites à 2000 px et recompressées en JPEG (une photo de téléphone
 *     de 5 à 10 Mo passe à quelques centaines de Ko : envoi rapide en 4G).
 * Si le navigateur ne sait pas décoder l'image (HEIC hors Safari), on envoie l'original.
 */
const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;

const EXT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
};

export function guessContentType(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TYPES[ext] ?? 'application/octet-stream';
}

async function toJpeg(file: File): Promise<File | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return null;
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

/** Renvoie le fichier à envoyer (éventuellement recompressé) avec un type MIME fiable. */
export async function prepareFileForUpload(file: File): Promise<File> {
  const type = guessContentType(file);
  if (type.startsWith('image/')) {
    const jpeg = await toJpeg(file);
    if (jpeg && jpeg.size < file.size) return jpeg;
  }
  return file.type === type ? file : new File([file], file.name, { type });
}
