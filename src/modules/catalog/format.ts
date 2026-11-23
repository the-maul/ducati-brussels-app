/** Catalogue Ducati — petits formats d'affichage (fr-BE). */
export function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
}

export function fmtInt(n: number | null | undefined): string {
  return n == null ? '—' : new Intl.NumberFormat('fr-BE').format(n);
}

export function fmtMoney(n: number | null | undefined): string {
  return n == null ? '—' : new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(n);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Position d'un repère (coordonnées Ducati en pixels de l'image d'origine) en pourcentage de
 * l'image affichée. Renvoie null si l'image n'a pas encore de taille connue.
 */
const FOCUS_MAX_SCALE = 2.2;

/**
 * Chantier C1 (23/11/2026) : zoom centré sur un repère. `box` en % de l'image ; le résultat s'applique
 * en `translate(x%, y%) scale(scale)` depuis le coin haut gauche. La pièce occupe environ un quart de
 * la vue, le zoom reste entre 1 et 2,2, et l'image ne laisse jamais de bord vide.
 */
export function focusTransform(box: { left: number; top: number; width: number; height: number }): { scale: number; x: number; y: number } {
  const span = Math.max(box.width, box.height, 0.5) * 4;
  // Le repère est un petit numéro relié à la pièce par un trait : on garde assez de planche pour voir la pièce.
  const scale = Math.min(FOCUS_MAX_SCALE, Math.max(1, 100 / span));
  const at = (center: number) => Math.min(0, Math.max(100 - 100 * scale, 50 - center * scale));
  return { scale, x: at(box.left + box.width / 2), y: at(box.top + box.height / 2) };
}

export function hotspotBox(h: { x1: number; y1: number; x2: number; y2: number }, natural: { w: number; h: number } | null) {
  if (!natural || !natural.w || !natural.h) return null;
  const x1 = Math.min(h.x1, h.x2), x2 = Math.max(h.x1, h.x2), y1 = Math.min(h.y1, h.y2), y2 = Math.max(h.y1, h.y2);
  return {
    left: (x1 / natural.w) * 100, top: (y1 / natural.h) * 100,
    width: Math.max(0.5, ((x2 - x1) / natural.w) * 100), height: Math.max(0.5, ((y2 - y1) / natural.h) * 100),
  };
}
