/**
 * Outils image (navigateur) — redimensionnement, rotation, compression JPEG.
 * Utilisés par : l'upload de photos (reprise), l'éditeur de photo et la
 * génération PDF (photos allégées → pièce jointe e-mail de quelques Mo).
 *
 * Toutes les fonctions travaillent sur <canvas> : pas de dépendance externe.
 */

/** Qualité/‌taille par usage. */
export const IMAGE_PRESETS = {
  /** Photos de reprise stockées en GED (bon compromis qualité/poids). */
  upload: { maxPx: 2000, quality: 0.85 },
  /** Documents scannés (facture, COC) — texte à rester lisible. */
  document: { maxPx: 2400, quality: 0.88 },
  /** Insertion dans le PDF : 186 mm de large ≈ 1400 px à ~190 dpi. */
  pdf: { maxPx: 1400, quality: 0.72 },
  /** Aperçu (vignette hero du PDF). */
  thumb: { maxPx: 900, quality: 0.78 },
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;
export type ImageSizing = { maxPx: number; quality: number };

/**
 * Réglage adaptatif pour le PDF : plus il y a de photos, plus on compresse, afin
 * que la fiche reste une pièce jointe e-mail raisonnable (~2–3 Mo) quel que soit
 * le nombre de clichés. Une fiche de 5 photos garde la qualité maximale.
 */
export function pdfSizingFor(photoCount: number): ImageSizing {
  if (photoCount <= 8) return { maxPx: 1400, quality: 0.74 };
  if (photoCount <= 16) return { maxPx: 1200, quality: 0.70 };
  if (photoCount <= 28) return { maxPx: 1050, quality: 0.66 };
  return { maxPx: 900, quality: 0.62 };
}

/** Décode un Blob/File en bitmap (ou null si format illisible). */
export async function decodeImage(src: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(src);
  } catch {
    return null;
  }
}

/** Dimensions bornées à `maxPx` sur le plus grand côté (jamais agrandies). */
export function fitSize(w: number, h: number, maxPx: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxPx) return { w, h };
  const k = maxPx / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/**
 * Dessine un bitmap dans un canvas, avec rotation (0/90/180/270) et
 * redimensionnement. Retourne le canvas (prêt à exporter).
 */
export function drawToCanvas(
  // Les trois types exposent width/height numériques et sont acceptés par
  // ctx.drawImage (ne PAS élargir à CanvasImageSource : SVGImageElement expose
  // des SVGAnimatedLength et casserait les calculs d'échelle).
  bmp: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  opts: { maxPx?: number; rotation?: 0 | 90 | 180 | 270 } = {},
): HTMLCanvasElement {
  const rot = ((opts.rotation ?? 0) % 360 + 360) % 360;
  const srcW = 'width' in bmp ? bmp.width : 0;
  const srcH = 'height' in bmp ? bmp.height : 0;
  // Après rotation de 90/270, largeur et hauteur sont inversées
  const swapped = rot === 90 || rot === 270;
  const rotW = swapped ? srcH : srcW;
  const rotH = swapped ? srcW : srcH;
  const target = fitSize(rotW, rotH, opts.maxPx ?? Number.MAX_SAFE_INTEGER);

  const canvas = document.createElement('canvas');
  canvas.width = target.w;
  canvas.height = target.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = 'high';

  // Échelle appliquée à l'image source (avant rotation)
  const scale = swapped ? target.w / srcH : target.w / srcW;
  ctx.save();
  ctx.translate(target.w / 2, target.h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(bmp, (-srcW * scale) / 2, (-srcH * scale) / 2, srcW * scale, srcH * scale);
  ctx.restore();
  return canvas;
}

/** Canvas → dataURL JPEG (fond blanc : les PNG transparents restent lisibles). */
export function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/jpeg', quality);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat.toDataURL('image/jpeg', quality);
}

/** Canvas → File JPEG (nom conservé, extension forcée .jpg). */
export async function canvasToJpegFile(canvas: HTMLCanvasElement, name: string, quality: number): Promise<File> {
  const blob: Blob | null = await new Promise((resolve) => {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
    }
    flat.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
  const base = name.replace(/\.[^.]+$/, '') || 'photo';
  if (!blob) return new File([], `${base}.jpg`, { type: 'image/jpeg' });
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

/**
 * Compresse un fichier image pour l'upload (redimensionne + JPEG).
 * Robuste : si le décodage échoue (format exotique), le fichier d'origine est
 * renvoyé tel quel — l'upload ne doit jamais être bloqué par la compression.
 * Les fichiers non-image (PDF…) passent aussi sans modification.
 */
export async function compressImageFile(file: File, preset: ImagePreset = 'upload'): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  const { maxPx, quality } = IMAGE_PRESETS[preset];
  const bmp = await decodeImage(file);
  if (!bmp) return file;
  try {
    const canvas = drawToCanvas(bmp, { maxPx });
    const out = await canvasToJpegFile(canvas, file.name, quality);
    // Sécurité : si la « compression » alourdit (petite image déjà optimisée),
    // on garde l'original.
    return out.size > 0 && out.size < file.size ? out : file;
  } finally {
    bmp.close?.();
  }
}

/**
 * Charge une URL (photo GED signée) et renvoie un JPEG allégé pour le PDF.
 * Retourne null si l'image est illisible (pièce ignorée dans le PDF).
 */
export async function fetchImageForPdf(
  url: string,
  sizing: ImagePreset | ImageSizing = 'pdf',
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    // On passe par un Blob local : le canvas n'est jamais « tainted » par une
    // URL signée d'un autre domaine, toDataURL reste donc autorisé.
    const blob = await resp.blob();
    const bmp = await decodeImage(blob);
    if (!bmp) return null;
    try {
      const { maxPx, quality } = typeof sizing === 'string' ? IMAGE_PRESETS[sizing] : sizing;
      const canvas = drawToCanvas(bmp, { maxPx });
      return { dataUrl: canvasToJpegDataUrl(canvas, quality), w: canvas.width, h: canvas.height };
    } finally {
      bmp.close?.();
    }
  } catch {
    return null;
  }
}
