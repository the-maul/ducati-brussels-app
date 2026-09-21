/**
 * Mission 03 — « Réserver le stock dès qu'une commande du site est passée, même non payée ».
 * Règles pures de supabase/functions/_shared/shopify-reservation.ts (miroir de la fonction SQL
 * _shopify_order_reservations_sync) : décision selon le statut Shopify, mouvements de réservation /
 * libération, triple stock (B4) sur les trois parcours : réservation → paiement (pas de double sortie),
 * réservation → annulation, expiration. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  reservationDecision, reservationExpired, planReservationMoves, stockOf, DEFAULT_RESERVATION_DAYS,
  type HeldReservation, type ReservationMove,
} from '../supabase/functions/_shared/shopify-reservation.ts';
import { importDecision } from '../supabase/functions/_shared/shopify-order.ts';

const order = (financialStatus: string | null, over: { cancelledAt?: string | null; test?: boolean } = {}) =>
  ({ financialStatus, cancelledAt: over.cancelledAt ?? null, test: over.test ?? false });

type Ledger = { qty: number; isReservation: boolean }[];
/** Applique des mouvements de réservation au grand livre (comme record_stock_move, is_reservation = true). */
const applyMoves = (ledger: Ledger, moves: ReservationMove[]) => { for (const m of moves) ledger.push({ qty: m.qty, isReservation: true }); };
/** Tient à jour les réservations d'une commande après des mouvements (comme shopify_order_reservations). */
function hold(held: HeldReservation[], moves: ReservationMove[]): HeldReservation[] {
  const by = new Map(held.map((h) => [h.lineId, { ...h }]));
  for (const m of moves) {
    const h = by.get(m.lineId) ?? { lineId: m.lineId, articleId: m.articleId, quantity: 0 };
    h.quantity += m.qty;
    by.set(m.lineId, h);
  }
  return [...by.values()].filter((h) => h.quantity > 0);
}

// ---------------------------------------------------------------- Décision

test('commande en attente de paiement (virement), autorisée ou payée en partie : on réserve', () => {
  expect(reservationDecision(order('PENDING'))).toBe('reserve');
  expect(reservationDecision(order('AUTHORIZED'))).toBe('reserve');
  expect(reservationDecision(order('PARTIALLY_PAID'))).toBe('reserve');
  expect(reservationDecision(order('pending'))).toBe('reserve');
});

test('commande payée : rien ici, c\'est l\'import de la facture qui libère la réservation', () => {
  for (const s of ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']) {
    expect(reservationDecision(order(s))).toBe('none');
    expect(importDecision(order(s))).toBe('import');
  }
});

test('commande annulée, paiement annulé ou expiré : on libère', () => {
  expect(reservationDecision(order('PENDING', { cancelledAt: '2026-09-21T12:00:00Z' }))).toBe('release');
  expect(reservationDecision(order('VOIDED'))).toBe('release');
  expect(reservationDecision(order('EXPIRED'))).toBe('release');
});

test('commande de test ou statut inconnu : rien', () => {
  expect(reservationDecision(order('PENDING', { test: true }))).toBe('none');
  expect(reservationDecision(order(null))).toBe('none');
  expect(reservationDecision(order('SOMETHING_NEW'))).toBe('none');
});

// ---------------------------------------------------------------- Mouvements

test('réserver : une ligne reliée réserve sa quantité, une ligne non reliée rien', () => {
  const moves = planReservationMoves('reserve', [], [
    { lineId: 'L1', articleId: 'A', quantity: 2 },
    { lineId: 'L2', articleId: null, quantity: 1 },
  ]);
  expect(moves).toEqual([{ lineId: 'L1', articleId: 'A', type: 'reservation', qty: 2 }]);
});

test('idempotent : rejouer le même webhook ne crée aucun mouvement', () => {
  const held: HeldReservation[] = [{ lineId: 'L1', articleId: 'A', quantity: 2 }];
  expect(planReservationMoves('reserve', held, [{ lineId: 'L1', articleId: 'A', quantity: 2 }])).toEqual([]);
});

test('commande modifiée avant paiement : réservation ajustée, ligne retirée libérée', () => {
  const held: HeldReservation[] = [{ lineId: 'L1', articleId: 'A', quantity: 2 }, { lineId: 'L2', articleId: 'B', quantity: 1 }];
  const moves = planReservationMoves('reserve', held, [{ lineId: 'L1', articleId: 'A', quantity: 3 }]);
  expect(moves).toEqual([
    { lineId: 'L1', articleId: 'A', type: 'reservation', qty: 1 },
    { lineId: 'L2', articleId: 'B', type: 'liberation', qty: -1 },
  ]);
});

// ---------------------------------------------------------------- Parcours (triple stock B4)

test('réservation → paiement : le disponible baisse à la commande, pas une 2e fois au paiement', () => {
  const ledger: Ledger = [{ qty: 3, isReservation: false }]; // 3 pièces en stock
  let held: HeldReservation[] = [];

  // Commande #1300 en attente de virement : 1 pièce réservée.
  const m1 = planReservationMoves(reservationDecision(order('PENDING')), held, [{ lineId: 'L1', articleId: 'A', quantity: 1 }]);
  applyMoves(ledger, m1); held = hold(held, m1);
  expect(stockOf(ledger)).toEqual({ real: 3, reserved: 1, available: 2 });

  // Payée : la facture libère la réservation puis sort le stock réel (même transaction SQL).
  const release = planReservationMoves('release', held, []);
  applyMoves(ledger, release); held = hold(held, release);
  ledger.push({ qty: -1, isReservation: false }); // sortie de la facture FAC
  expect(stockOf(ledger)).toEqual({ real: 2, reserved: 0, available: 2 });
  expect(held).toEqual([]);

  // Paiement rejoué (webhook orders/paid reçu deux fois) : plus rien à libérer, pas de 2e sortie.
  expect(planReservationMoves('release', held, [])).toEqual([]);
});

test('réservation → annulation : tout le stock redevient disponible', () => {
  const ledger: Ledger = [{ qty: 1, isReservation: false }];
  let held: HeldReservation[] = [];
  const m1 = planReservationMoves('reserve', held, [{ lineId: 'L1', articleId: 'A', quantity: 1 }]);
  applyMoves(ledger, m1); held = hold(held, m1);
  expect(stockOf(ledger).available).toBe(0);

  const m2 = planReservationMoves(reservationDecision(order('VOIDED', { cancelledAt: '2026-09-22T08:00:00Z' })), held, []);
  expect(m2).toEqual([{ lineId: 'L1', articleId: 'A', type: 'liberation', qty: -1 }]);
  applyMoves(ledger, m2);
  expect(stockOf(ledger)).toEqual({ real: 1, reserved: 0, available: 1 });
});

test('expiration : non payée après 7 jours (réglage par défaut) → libérée', () => {
  expect(DEFAULT_RESERVATION_DAYS).toBe(7);
  const created = '2026-09-10T10:00:00Z';
  expect(reservationExpired(created, new Date('2026-09-17T09:59:00Z'))).toBe(false);
  expect(reservationExpired(created, new Date('2026-09-17T10:00:00Z'))).toBe(true);
  expect(reservationExpired(created, new Date('2026-09-12T10:00:00Z'), 2)).toBe(true);
  expect(reservationExpired(null, new Date())).toBe(false);

  const ledger: Ledger = [{ qty: 2, isReservation: false }];
  let held: HeldReservation[] = [];
  const m1 = planReservationMoves('reserve', held, [{ lineId: 'L1', articleId: 'A', quantity: 2 }]);
  applyMoves(ledger, m1); held = hold(held, m1);
  expect(stockOf(ledger).available).toBe(0);
  const m2 = planReservationMoves('release', held, []);
  applyMoves(ledger, m2);
  expect(stockOf(ledger)).toEqual({ real: 2, reserved: 0, available: 2 });
});
