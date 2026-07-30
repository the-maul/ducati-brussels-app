/**
 * M2 (B12) — Marque Ducati (wordmark) embarquée en SVG dataURL pour l'étiquette
 * standard « pièces / motos ». Vectoriel = net à l'impression quelle que soit la
 * résolution, et aucune dépendance réseau (déployable Lovable tel quel).
 * NB : logo texte de repli. Si la société configure un `companies.logo_url`
 * officiel, préférer celui-ci côté appelant.
 */
const DUCATI_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 44">' +
  '<rect x="0" y="0" width="120" height="44" rx="7" fill="#CC0000"/>' +
  '<text x="60" y="31" font-family="Arial Black, Arial, sans-serif" font-weight="900" ' +
  'font-style="italic" font-size="24" letter-spacing="0.5" fill="#FFFFFF" ' +
  'text-anchor="middle">DUCATI</text></svg>';

export const DUCATI_LOGO_DATA_URL =
  'data:image/svg+xml;utf8,' + encodeURIComponent(DUCATI_LOGO_SVG);
