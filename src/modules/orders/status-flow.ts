/**
 * Cycle de vie d'une commande de pièces — fonctions pures, testables.
 * brouillon → en attente de paiement → payée → à envoyer → envoyée (+ annulée).
 * Le serveur (fonction SQL part_order_transition) fait foi : ce fichier sert à l'affichage
 * (boutons proposés, compteurs de la liste) et aux tests.
 */
import type { OrderDispatchStatus, OrderKind } from './api';

/** Ordre d'affichage des états. */
export const DISPATCH_STATUSES: OrderDispatchStatus[] = [
  'brouillon', 'en_attente_paiement', 'payee', 'a_envoyer', 'envoyee', 'annulee',
];

/** Passages autorisés, identiques à part_order_transition. */
export const NEXT_STATUSES: Record<OrderDispatchStatus, OrderDispatchStatus[]> = {
  brouillon: ['en_attente_paiement', 'annulee'],
  en_attente_paiement: ['payee', 'annulee'],
  payee: ['a_envoyer', 'annulee'],
  a_envoyer: ['envoyee', 'annulee'],
  envoyee: [],
  annulee: [],
};

export function canTransition(from: OrderDispatchStatus, to: OrderDispatchStatus): boolean {
  return NEXT_STATUSES[from]?.includes(to) ?? false;
}

export type OrderKindStatus = { order_kind: OrderKind; dispatch_status: OrderDispatchStatus };

/**
 * Compteurs croisés de la liste : nombre par type (en tenant compte du filtre d'état)
 * et nombre par état (en tenant compte du filtre de type).
 */
export function countOrders(
  rows: OrderKindStatus[],
  filters: { kind?: OrderKind; status?: OrderDispatchStatus } = {},
): { byKind: Record<string, number>; byStatus: Record<string, number>; totalKind: number; totalStatus: number } {
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalKind = 0;
  let totalStatus = 0;
  for (const r of rows) {
    if (!filters.status || r.dispatch_status === filters.status) {
      byKind[r.order_kind] = (byKind[r.order_kind] ?? 0) + 1;
      totalKind += 1;
    }
    if (!filters.kind || r.order_kind === filters.kind) {
      byStatus[r.dispatch_status] = (byStatus[r.dispatch_status] ?? 0) + 1;
      totalStatus += 1;
    }
  }
  return { byKind, byStatus, totalKind, totalStatus };
}
