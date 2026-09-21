// Mission 03 — « Réserver le stock dès qu'une commande du site est passée, même non payée ».
//
// Règles PURES (sans réseau ni base), importées par la fonction serveur shopify-orders et testées par
// tests/shopify-reservations.test.ts. La fonction SQL _shopify_order_reservations_sync (migration
// 20260921150000) applique les mêmes règles dans la base, par le mécanisme de réservation EXISTANT :
// mouvements append-only `reservation` / `liberation` (is_reservation = true) par record_stock_move,
// comme un bon de réservation RES (M05, M06). Disponible = réel − réservé (B4).
//
//   - commande pas encore payée (PENDING, AUTHORIZED, PARTIALLY_PAID) → réserver les lignes reliées ;
//   - commande payée → la facture FAC sort le stock réel et la réservation est libérée dans la même
//     transaction (aucun double comptage : le disponible ne bouge pas au paiement) ;
//   - commande annulée, paiement annulé ou expiré sur Shopify → libérer ;
//   - commande toujours pas payée après N jours (réglage société, 7 par défaut) → libérer (expiration).

import { PAID_STATUSES, type ShopOrder } from './shopify-order.ts';

/** Statuts Shopify « en attente de paiement » : la commande réserve le stock. */
export const RESERVE_STATUSES = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'] as const;
/** Paiement abandonné côté Shopify : la réservation est libérée. */
export const RELEASE_STATUSES = ['VOIDED', 'EXPIRED'] as const;

/** Durée par défaut d'une réservation de commande non payée (jours). */
export const DEFAULT_RESERVATION_DAYS = 7;

export type ReservationAction = 'reserve' | 'release' | 'none';

/**
 * Que faire des réservations d'une commande ?
 * `none` pour une commande payée : c'est l'import de la facture qui libère (même transaction).
 */
export function reservationDecision(o: Pick<ShopOrder, 'financialStatus' | 'cancelledAt' | 'test'>): ReservationAction {
  if (o.test) return 'none';
  const st = (o.financialStatus ?? '').toUpperCase();
  if ((PAID_STATUSES as readonly string[]).includes(st)) return 'none';
  if (o.cancelledAt) return 'release';
  if ((RELEASE_STATUSES as readonly string[]).includes(st)) return 'release';
  if ((RESERVE_STATUSES as readonly string[]).includes(st)) return 'reserve';
  return 'none';
}

/** La réservation d'une commande passée le `createdAt` est-elle expirée à `now` ? */
export function reservationExpired(createdAt: string | null, now: Date, days = DEFAULT_RESERVATION_DAYS): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t >= Math.max(1, days) * 24 * 3600_000;
}

/** Ligne de commande à réserver (produit relié à un article du DMS). */
export type ReservationTarget = { lineId: string; articleId: string | null; quantity: number };
/** Réservation déjà tenue pour une ligne (quantité encore réservée). */
export type HeldReservation = { lineId: string; articleId: string; quantity: number };

export type ReservationMove = { lineId: string; articleId: string; type: 'reservation' | 'liberation'; qty: number };

/**
 * Mouvements à écrire pour passer des réservations tenues aux réservations voulues.
 * `reserve` : chaque ligne reliée est réservée à sa quantité (ajustée si la commande a été modifiée,
 * libérée si la ligne a disparu) ; une ligne non reliée ne réserve rien. `release` : tout est libéré.
 * `none` : rien. Idempotent : rejouer avec les mêmes réservations tenues ne produit aucun mouvement.
 * Convention stock_moves : réservation = +qté, libération = −qté (axe « réservé »).
 */
export function planReservationMoves(action: ReservationAction, held: HeldReservation[], targets: ReservationTarget[]): ReservationMove[] {
  const moves: ReservationMove[] = [];
  if (action === 'none') return moves;
  const heldBy = new Map(held.map((h) => [h.lineId, h]));
  if (action === 'release') {
    for (const h of held) if (h.quantity > 0) moves.push({ lineId: h.lineId, articleId: h.articleId, type: 'liberation', qty: -h.quantity });
    return moves;
  }
  const wanted = new Map<string, ReservationTarget>();
  for (const t of targets) if (t.lineId && t.articleId && t.quantity > 0) wanted.set(t.lineId, t);
  for (const t of wanted.values()) {
    const h = heldBy.get(t.lineId);
    const cur = h?.quantity ?? 0;
    const articleId = h?.articleId ?? t.articleId!;
    if (t.quantity > cur) moves.push({ lineId: t.lineId, articleId, type: 'reservation', qty: t.quantity - cur });
    else if (t.quantity < cur) moves.push({ lineId: t.lineId, articleId, type: 'liberation', qty: t.quantity - cur });
  }
  for (const h of held) {
    if (!wanted.has(h.lineId) && h.quantity > 0) moves.push({ lineId: h.lineId, articleId: h.articleId, type: 'liberation', qty: -h.quantity });
  }
  return moves;
}

/** Triple stock d'un article d'après ses mouvements (même calcul que article_stock, M05). */
export function stockOf(moves: { qty: number; isReservation: boolean }[]) {
  const real = moves.filter((m) => !m.isReservation).reduce((s, m) => s + m.qty, 0);
  const reserved = moves.filter((m) => m.isReservation).reduce((s, m) => s + m.qty, 0);
  return { real, reserved, available: real - reserved };
}
