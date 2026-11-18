/**
 * M6 — « Documents clients » (G8 Facturation › Documents clients) : onglets, règles pures des
 * listes de règlements (acomptes, régularisations, compensations) et du filtre de disponibilité.
 * Lot rattrapage G8 du 18/11/2026.
 */
import type { AvailabilityStatus } from './availability';

/** Onglets dans l'ordre de G8 (mouvements et encaissements de caisse : lot « encaissements »). */
export const CLIENT_DOC_TABS = [
  'invoices', 'reservations', 'reservationsAvailability', 'repairs', 'repairsAvailability',
  'deliveries', 'proformas', 'deposits', 'regularisations', 'compensations', 'cessions',
] as const;
export type ClientDocTab = (typeof CLIENT_DOC_TABS)[number];

/** Types de documents de vente des onglets « liste de documents ». */
export const TAB_DOC_TYPES: Partial<Record<ClientDocTab, readonly string[]>> = {
  invoices: ['FAC', 'TIK', 'FAA', 'AVO'],
  reservations: ['RES', 'BC'],
  deliveries: ['BL'],
  proformas: ['DEV'],
};

export type PaymentKind = 'deposit' | 'regularisation' | 'compensation';

/**
 * Régularisation (G8) : règlement perçu sur une facture APRÈS le jour de la facture (le client
 * revient payer son solde). Un acompte reporté depuis une réservation n'en est pas une.
 */
export function isRegularisation(p: { paid_at: string; issue_date: string; note: string | null }): boolean {
  if (/^acompte/i.test(p.note ?? '')) return false;
  return p.paid_at.slice(0, 10) > p.issue_date.slice(0, 10);
}

/** Filtre G8 « toutes / reçues totalement / reçues partiellement / articles manquants ». */
export type AvailabilityFilter = 'all' | 'full' | 'partial' | 'missing';

export function matchesAvailability(filter: AvailabilityFilter, status: AvailabilityStatus | null | undefined): boolean {
  if (filter === 'all') return true;
  if (!status || status === 'na') return false;
  if (filter === 'full') return status === 'disponible';
  if (filter === 'partial') return status === 'partiel';
  return status === 'indisponible' || status === 'partiel';
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Total d'une colonne (montants des règlements, cessions…). */
export const sumOf = <T>(rows: T[], pick: (r: T) => number | null | undefined): number =>
  r2(rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0));
