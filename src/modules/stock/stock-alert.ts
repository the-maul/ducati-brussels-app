/**
 * Alerte d'affichage d'une ligne de l'écran Stock (revue UX/UI du 20/11/2026) : badge
 * « Stock négatif » ou « Rupture ». Lecture seule des quantités déjà calculées (triple stock
 * inchangé : réel, réservé, disponible viennent de `stock_screen_page` / `listStock`).
 *  - négatif : le stock réel ou le disponible est sous zéro (sortie plus grande que le stock) ;
 *  - rupture : plus rien de disponible alors que l'article est suivi (stock mini réglé) ou
 *    attendu (des réservations l'attendent).
 * Un article à 0 sans minimum ni réservation n'est pas « en rupture » : il n'est simplement pas stocké.
 */
export type StockAlert = 'negative' | 'out' | null;

export function stockAlert(r: { real_qty: number; available_qty: number; reserved_qty: number; stock_min: number }): StockAlert {
  if (r.real_qty < 0 || r.available_qty < 0) return 'negative';
  if (r.available_qty <= 0 && (r.stock_min > 0 || r.reserved_qty > 0)) return 'out';
  return null;
}
