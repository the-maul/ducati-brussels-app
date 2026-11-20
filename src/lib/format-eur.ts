/**
 * Montant en euros au format belge : séparateur de milliers, virgule décimale, deux décimales
 * (« 1 027,00 € », « − 12,50 € » en valeur absolue côté appelant). Revue UX/UI du 20/11/2026 :
 * les formateurs locaux `toFixed(2).replace('.', ',')` n'avaient pas de séparateur de milliers.
 *
 * Déterministe (pas de `toLocaleString`, dont l'espace varie selon le moteur) : espace fine
 * insécable (U+202F) entre les milliers, espace insécable (U+00A0) avant le symbole, comme le
 * rendu `fr-BE` des navigateurs. Arrondi au cent, « -0,00 » ramené à « 0,00 ».
 */
const THIN_NBSP = ' ';
const NBSP = ' ';

/** « 1 027,00 » (sans symbole). */
export function formatAmount(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  const cents = Math.round((Number.isFinite(v) ? v : 0) * 100);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
  const dec = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${int},${dec}`;
}

/** « 1 027,00 € ». */
export function formatEur(n: number | string | null | undefined): string {
  return `${formatAmount(n)}${NBSP}€`;
}
