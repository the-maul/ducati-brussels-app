/**
 * M6/M9 — Style d'impression du PDF des documents de vente (mission 05 carte 8, mission 02 carte 6).
 *
 * SEUL endroit où le PDF définit ses couleurs et ses polices. Un PDF est un document imprimé :
 * il ne lit pas les variables CSS de `src/styles/tokens.css` (jsPDF dessine hors du navigateur),
 * donc les valeurs sont recopiées ici depuis la charte (docs/charte-graphique.md §7 « documents
 * imprimés ») et depuis l'impression HTML existante (`print-document.ts`), pour que le PDF et
 * l'impression se ressemblent. Aucun composant React ne doit importer ces couleurs.
 *
 * Couleurs en RVB 0-255 (format attendu par jsPDF `setTextColor` / `setDrawColor` / `setFillColor`).
 * Polices : Helvetica, police standard PDF (pas de fichier à embarquer, encodage WinAnsi : les
 * textes passent par `patchPdfText`).
 */
export type Rgb = readonly [number, number, number];

export const PDF_COLORS = {
  /** Texte courant (≈ #111 de l'impression HTML). */
  ink: [17, 17, 17] as Rgb,
  /** Texte secondaire : coordonnées société, libellés du bandeau (≈ #555). */
  muted: [85, 85, 85] as Rgb,
  /** Texte des mentions (≈ #444). */
  soft: [68, 68, 68] as Rgb,
  /** Rouge Ducati : identité seulement (nom de la société quand il n'y a pas de logo). */
  brand: [204, 0, 0] as Rgb,
  /** Cadres (bloc client, bandeau, totaux, signature). */
  frame: [51, 51, 51] as Rgb,
  /** Filets entre les lignes. */
  rule: [221, 221, 221] as Rgb,
  /** Fond des lignes paires et des totaux forts. */
  zebra: [247, 247, 247] as Rgb,
} as const;

export const PDF_FONT = {
  family: 'helvetica',
  /** Tailles en points. */
  brand: 16,
  title: 14,
  body: 9,
  small: 7.5,
  tiny: 6.5,
} as const;

/** Mise en page A4 en millimètres. */
export const PDF_PAGE = {
  width: 210,
  height: 297,
  margin: 12,
  /** Hauteur réservée en bas de page au pied (numéro de page). */
  footer: 10,
  lineHeight: 4.2,
} as const;
