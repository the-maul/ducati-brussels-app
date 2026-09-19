/**
 * M6 — Préparation sur tablette (mission 05, carte 6) : règles pures, sans accès à la base
 * (testées par tests/sales-preparation.test.ts). Accès base : picking-api.ts.
 * « Disponible, commandé, préparé, monté » (Domenico, vidéo G8 5:53) :
 *   - disponible / en commande / à commander : calculés sur le triple stock (B4), jamais saisis ;
 *   - commandé / préparé / monté : étapes posées à la main, avec qui et quand (events).
 */
import { saleStockStatus, type SaleStockStatus } from './availability';

export type PrepStep = 'commande' | 'prepare' | 'monte';
export const PREP_STEPS: readonly PrepStep[] = ['commande', 'prepare', 'monte'];

/** Types de documents qu'on peut préparer (bouton « Préparer » des listes). */
export const PREPARABLE_DOC_TYPES = ['DEV', 'BC', 'RES', 'BL', 'FAC'] as const;
export function canPrepareDocument(d: { doc_type: string; status: string }): boolean {
  return (PREPARABLE_DOC_TYPES as readonly string[]).includes(d.doc_type) && d.status !== 'annulee';
}

export type PickingDetailLine = {
  id: string; picking_id: string; article_id: string | null; document_line_id: string | null;
  reference: string | null; designation: string | null; qty_ordered: number; qty_picked: number; status: string;
  prep_step: PrepStep | null; prep_step_at: string | null; prep_step_by_name: string | null; sort_order: number;
  mgmt_type: string | null; bins: string[];
  real_qty: number | null; reserved_qty: number | null; on_order_qty: number | null;
};

/** État affiché d'une ligne : l'étape posée à la main, sinon la disponibilité calculée. */
export type PrepDisplayState = PrepStep | SaleStockStatus;
export function prepDisplayState(l: Pick<PickingDetailLine, 'prep_step' | 'mgmt_type' | 'real_qty' | 'reserved_qty' | 'on_order_qty' | 'qty_ordered' | 'article_id'>): PrepDisplayState {
  if (l.prep_step) return l.prep_step;
  if (!l.article_id) return 'na';
  return saleStockStatus({
    mgmt_type: l.mgmt_type, real_qty: l.real_qty ?? 0, reserved_qty: l.reserved_qty ?? 0, on_order_qty: l.on_order_qty ?? 0,
  }, l.qty_ordered);
}

/** Avancement : lignes préparées ou montées / total. */
export function prepProgress(lines: Pick<PickingDetailLine, 'prep_step'>[]): { done: number; total: number } {
  return { done: lines.filter((l) => l.prep_step === 'prepare' || l.prep_step === 'monte').length, total: lines.length };
}
