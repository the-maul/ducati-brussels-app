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

/* ------------------------------------------------------------------------------------------------
 * Gestion des listes (mission 02, carte « picking list ») — mêmes règles que les fonctions SQL
 * picking_cancel / picking_regenerate / picking_finish (migration 20260919380000).
 * ---------------------------------------------------------------------------------------------- */

/** Statut affiché dans la page des listes : couleur + icône + libellé. */
export type PickingListStatus = 'a_preparer' | 'en_cours' | 'prete' | 'montee' | 'terminee' | 'annulee';
export const PICKING_LIST_STATUSES: readonly PickingListStatus[] = ['a_preparer', 'en_cours', 'prete', 'montee', 'terminee', 'annulee'];

export type PickingCounts = {
  status: string; lines_total: number; lines_ordered: number; lines_prepared: number; lines_mounted: number;
};

/**
 * Statut affiché : annulée / terminée (enregistrés) ; sinon calculé sur les lignes encore au
 * document — toutes montées → montée ; toutes préparées ou montées → prête ; au moins une étape
 * posée → en cours ; rien → à préparer.
 */
export function pickingDisplayStatus(p: PickingCounts): PickingListStatus {
  if (p.status === 'annulee') return 'annulee';
  if (p.status === 'livre') return 'terminee';
  if (p.lines_total > 0 && p.lines_mounted === p.lines_total) return 'montee';
  if (p.lines_total > 0 && p.lines_prepared === p.lines_total) return 'prete';
  if (p.lines_prepared + p.lines_ordered > 0) return 'en_cours';
  return 'a_preparer';
}

/**
 * « Annuler / supprimer » : suppression réelle seulement si rien n'a été préparé ni monté
 * (et liste non terminée) ; sinon annulation avec motif obligatoire, tracée (B7).
 * Une étape « commandé » seule n'empêche pas la suppression (rien n'a été sorti du casier).
 */
export function pickingCancelMode(
  status: string,
  lines: { prep_step: string | null; qty_picked: number }[],
): 'delete' | 'cancel' {
  if (status === 'livre') return 'cancel';
  const started = lines.some((l) => l.prep_step === 'prepare' || l.prep_step === 'monte' || Number(l.qty_picked) > 0);
  return started ? 'cancel' : 'delete';
}

/** Actions possibles selon le statut enregistré de la liste. */
export function pickingActions(p: { status: string; document_id: string | null; lines_total: number; lines_prepared: number }) {
  const open = p.status === 'en_cours' || p.status === 'pret';
  return {
    cancel: p.status !== 'annulee',
    reopen: p.status === 'annulee' || p.status === 'livre',
    regenerate: open && !!p.document_id,
    finish: open && p.lines_total > 0 && p.lines_prepared === p.lines_total,
    editSteps: open,
    // mission 07 carte 2 : commander ce qui manque, depuis la liste elle-même
    order: open && p.lines_total > 0,
  };
}

export type RegenItem = {
  id: string; document_line_id: string | null; article_id: string | null; designation: string | null;
  qty_ordered: number; prep_step: PrepStep | null; removed: boolean;
};
export type RegenDocLine = {
  id: string; article_id: string | null; designation: string | null; quantity: number; line_type: string | null;
};
export type RegenPlan = {
  /** lignes de la liste gardées (étape inchangée), avec leur ligne de document et la quantité du document */
  kept: { itemId: string; lineId: string; qty: number; prep_step: PrepStep | null; qtyChanged: boolean; restored: boolean }[];
  /** lignes de la liste dont la ligne a disparu du document : signalées, jamais supprimées */
  removed: string[];
  /** nouvelles lignes du document à ajouter */
  added: string[];
};

/**
 * Régénérer depuis le document (miroir de picking_regenerate) : chaque ligne de la liste retrouve
 * sa ligne de document (lien, sinon même article + désignation) et GARDE son étape ; sans ligne →
 * signalée « retirée » ; les lignes article du document non reprises sont ajoutées. Lignes texte,
 * vides, main-d'œuvre et quantités nulles ignorées.
 */
export function planRegeneration(items: RegenItem[], docLines: RegenDocLine[]): RegenPlan {
  const eligible = docLines.filter((l) => (l.line_type ?? 'article') === 'article' && Number(l.quantity) > 0);
  const byId = new Map(eligible.map((l) => [l.id, l]));
  const used = new Set<string>();
  const plan: RegenPlan = { kept: [], removed: [], added: [] };
  const ordered = [...items].sort((a, b) => Number(a.document_line_id == null) - Number(b.document_line_id == null));
  for (const it of ordered) {
    let line = it.document_line_id ? byId.get(it.document_line_id) : undefined;
    if (line && used.has(line.id)) line = undefined;
    if (!line) {
      line = eligible.find((l) => !used.has(l.id)
        && (l.article_id ?? null) === (it.article_id ?? null)
        && (l.designation ?? null) === (it.designation ?? null)
        && !items.some((o) => o.id !== it.id && o.document_line_id === l.id));
    }
    if (!line) {
      if (!it.removed) plan.removed.push(it.id);
      continue;
    }
    used.add(line.id);
    plan.kept.push({
      itemId: it.id, lineId: line.id, qty: Number(line.quantity), prep_step: it.prep_step,
      qtyChanged: Number(line.quantity) !== Number(it.qty_ordered), restored: it.removed,
    });
  }
  plan.added = eligible.filter((l) => !used.has(l.id)).map((l) => l.id);
  return plan;
}

/* Filtres et tri de la page des listes (purs, testés). */
export type PickingFilterRow = PickingCounts & {
  client_name: string | null; doc_number: string | null; seller_name: string | null; created_at: string;
  vehicle_label: string | null;
};
export type PickingStatusFilter = PickingListStatus | 'actives' | 'toutes';
export type PickingFilters = { status: PickingStatusFilter; seller: string; from: string; to: string; search: string };
export const ALL_SELLERS = '__tous__';
export const DEFAULT_PICKING_FILTERS: PickingFilters = { status: 'actives', seller: ALL_SELLERS, from: '', to: '', search: '' };

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterPickings<T extends PickingFilterRow>(rows: T[], f: PickingFilters): T[] {
  const q = norm(f.search.trim());
  return rows.filter((r) => {
    const st = pickingDisplayStatus(r);
    if (f.status === 'actives' && (st === 'annulee' || st === 'terminee')) return false;
    if (f.status !== 'actives' && f.status !== 'toutes' && st !== f.status) return false;
    if (f.seller !== ALL_SELLERS && (r.seller_name ?? '') !== f.seller) return false;
    const day = r.created_at.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (q && !norm(`${r.client_name ?? ''} ${r.doc_number ?? ''} ${r.vehicle_label ?? ''}`).includes(q)) return false;
    return true;
  });
}

export type PickingSortKey = 'date' | 'document' | 'client' | 'seller' | 'progress' | 'status';
export function sortPickings<T extends PickingFilterRow>(rows: T[], key: PickingSortKey, dir: 'asc' | 'desc'): T[] {
  const val = (r: T): string | number => {
    switch (key) {
      case 'date': return r.created_at;
      case 'document': return r.doc_number ?? '';
      case 'client': return norm(r.client_name);
      case 'seller': return norm(r.seller_name);
      case 'progress': return r.lines_total ? r.lines_prepared / r.lines_total : 0;
      case 'status': return PICKING_LIST_STATUSES.indexOf(pickingDisplayStatus(r));
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = val(a); const y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  });
}
