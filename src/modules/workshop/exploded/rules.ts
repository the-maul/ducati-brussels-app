/**
 * M8 — Vues éclatées depuis l'OR (lot E du parcours mécanicien, 19/11/2026). Règles PURES
 * (testées dans tests/atelier-vues-eclatees.test.ts).
 *
 *  - retrouver une pièce de l'OR / de la picking list dans les vues éclatées du modèle-année de
 *    la moto : par la référence compacte du catalogue (ducati_catalog_norm_ref), sinon par la
 *    référence qui la remplace (« remplacée par ») ; vues rangées dans l'ordre du catalogue ;
 *  - liste des repères d'une vue quand l'image Ducati ne s'affiche pas ;
 *  - ce que l'on peut faire d'une ligne de vue : ajouter à l'OR (article du DMS), réserver
 *    (pièce stockée A, OR enregistré et ni facturé ni annulé) ;
 *  - la ligne d'OR créée passe par LA fonction de prix des lignes d'OR (priceOrLine).
 */
import { normalizeCatalogReference } from '@/modules/catalog/reference';
import { comparePositions, positionsOf } from '@/modules/catalog/positions';
import { priceOrLine, type OrLinePricer } from '@/modules/workshop/or-line-pricing';

export { normalizeCatalogReference, comparePositions, positionsOf };

/** Ligne de vue trouvée en base (ducati_catalog_drawing_lines, colonnes lues). */
export type LineHit = { drawing_id: string; position: string | null; line_no: number; reference_norm: string | null; replaced_part: string | null };
/** Vue du modèle-année, dans l'ordre du catalogue (ducati_catalog_model_year_drawings). */
export type DrawingOrder = { drawing_id: string; group_sort: number | null; sort: number | null };
export type Location = { drawingId: string; position: string | null; lineNo: number; viaReplacement: boolean };

/**
 * Où est la pièce dans les vues de la moto ? Une entrée par vue (premier repère de la vue),
 * correspondances directes d'abord, puis par la référence remplacée ; ordre du catalogue ensuite.
 */
export function locateInDrawings(reference: string | null | undefined, hits: readonly LineHit[], order: readonly DrawingOrder[]): Location[] {
  const ref = normalizeCatalogReference(reference);
  if (!ref) return [];
  const rank = new Map<string, number>();
  order.forEach((d, i) => { if (!rank.has(d.drawing_id)) rank.set(d.drawing_id, i); });
  const best = new Map<string, Location>();
  for (const h of hits) {
    if (!rank.has(h.drawing_id)) continue;
    const direct = h.reference_norm === ref;
    const viaRepl = !direct && normalizeCatalogReference(h.replaced_part) === ref;
    if (!direct && !viaRepl) continue;
    const cur = best.get(h.drawing_id);
    const cand: Location = { drawingId: h.drawing_id, position: h.position, lineNo: h.line_no, viaReplacement: viaRepl };
    if (!cur || (cur.viaReplacement && !viaRepl) || (cur.viaReplacement === viaRepl && h.line_no < cur.lineNo)) best.set(h.drawing_id, cand);
  }
  return [...best.values()].sort((a, b) => Number(a.viaReplacement) - Number(b.viaReplacement)
    || (rank.get(a.drawingId)! - rank.get(b.drawingId)!));
}

/** Lignes d'un repère. */
export function linesAtPosition<L extends { position: string | null }>(lines: readonly L[], pos: string | null): L[] {
  if (!pos) return [];
  return lines.filter((l) => String(l.position ?? '').trim() === pos);
}

/** Ce que l'écran sait d'une ligne de vue. */
export type ViewLine = {
  article_id: string | null; article_mgmt_type: string | null; article_is_library?: boolean | null;
  real_qty: number | null; reserved_qty: number | null; on_order_qty: number | null;
};

export type ActionContext = {
  /** OR enregistré (null : nouvel OR, ou picking list sans OR). */
  orId: string | null;
  /** OR facturé / annulé, ou écran en lecture (picking list). */
  readOnly: boolean;
  /** L'écran sait ajouter une ligne (éditeur de l'OR). */
  canAdd: boolean;
};

/** « Ajouter à l'OR » : un article du DMS existe pour la référence et l'OR se modifie. */
export function canAddLine(l: ViewLine, ctx: ActionContext): boolean {
  return ctx.canAdd && !ctx.readOnly && !!l.article_id;
}

/** « Réserver » : pièce stockée (A) du DMS, OR enregistré ni facturé ni annulé (même règle que la base). */
export function canReserveLine(l: ViewLine, ctx: ActionContext): boolean {
  return !ctx.readOnly && !!ctx.orId && !!l.article_id && String(l.article_mgmt_type ?? '') === 'A';
}

/** Stock libre (réel − réservé), jamais négatif à l'affichage. */
export function freeQty(l: Pick<ViewLine, 'real_qty' | 'reserved_qty'>): number {
  return Math.max(0, (Number(l.real_qty) || 0) - (Number(l.reserved_qty) || 0));
}

/** Quantité saisie au pavé +/- : entière, au moins 1, au plus 999. */
export function stepQty(q: number, delta: number): number {
  const n = Math.round((Number(q) || 0) + delta);
  return Math.min(999, Math.max(1, n));
}

/** OR qui ne se modifie plus. */
export function orReadOnly(status: string | null | undefined): boolean {
  return status === 'facture' || status === 'annule';
}

// ------------------------------------------------------------------ ligne d'OR créée
/** Article du DMS tel que lu pour chiffrer la ligne (articles). */
export type PricedArticle = {
  id: string; reference: string; designation: string;
  sale_price_ht: number | null; sale_price_ttc: number | null; vat_rate: number | null;
};
export type CatalogOrLine = {
  kind: 'piece'; article_id: string; designation: string; quantity: number;
  unit_price_ht: number; vat_rate: number; discount_pct: number; is_warranty: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** PV HT de base (HT connu, sinon TTC / (1 + TVA)), comme `articleBaseSaleHt`. */
export function baseSaleHt(a: Pick<PricedArticle, 'sale_price_ht' | 'sale_price_ttc' | 'vat_rate'>): number {
  const ht = Number(a.sale_price_ht ?? 0);
  if (Number.isFinite(ht) && ht > 0) return ht;
  const ttc = Number(a.sale_price_ttc ?? 0);
  if (!Number.isFinite(ttc) || ttc <= 0) return 0;
  const v = Number(a.vat_rate ?? 21);
  return r2(ttc / (1 + (Number.isFinite(v) ? v : 21) / 100));
}

/**
 * La ligne d'OR d'une pièce choisie sur la vue éclatée : prix catalogue de l'article (arrondi de la
 * société par `effectiveHt`), puis LA fonction de prix des lignes d'OR (tarif du client, ou de
 * l'assureur sur un OR accident). Sans tarif applicable : le prix catalogue reste.
 */
export async function catalogPickToOrLine(
  a: PricedArticle, quantity: number, pricer: OrLinePricer,
  effectiveHt: (ht: number, vat: number) => number = (ht) => ht,
): Promise<CatalogOrLine> {
  const vat = a.vat_rate == null || !Number.isFinite(Number(a.vat_rate)) ? 21 : Number(a.vat_rate);
  const qty = Number(quantity) > 0 ? Number(quantity) : 1;
  const base = r2(effectiveHt(baseSaleHt(a), vat));
  const line: CatalogOrLine = {
    kind: 'piece', article_id: a.id, designation: a.designation || a.reference, quantity: qty,
    unit_price_ht: base, vat_rate: vat, discount_pct: 0, is_warranty: false,
  };
  try {
    const p = await priceOrLine(pricer, line, base);
    return p ? { ...line, unit_price_ht: p.unit_price_ht, discount_pct: p.discount_pct } : line;
  } catch {
    return line;
  }
}

// ------------------------------------------------------------------ réponse de « Réserver »
export type ReserveResult = {
  already: boolean; qtyNeeded: number; qtyReserved: number; qtyToOrder: number;
  basketKind: string | null; orderBlocked: boolean;
};
export type ReserveOutcome =
  | { kind: 'already' }
  | { kind: 'reserved'; reserved: number }
  | { kind: 'basket'; reserved: number; missing: number; basket: 'urgente' | 'standard' }
  | { kind: 'blocked'; reserved: number; missing: number };

/** Message à montrer après « Réserver ». */
export function reserveOutcome(r: ReserveResult): ReserveOutcome {
  if (r.already) return { kind: 'already' };
  const missing = Math.max(0, r.qtyNeeded - r.qtyReserved);
  if (missing <= 0) return { kind: 'reserved', reserved: r.qtyReserved };
  if (r.orderBlocked) return { kind: 'blocked', reserved: r.qtyReserved, missing };
  return { kind: 'basket', reserved: r.qtyReserved, missing, basket: r.basketKind === 'standard' ? 'standard' : 'urgente' };
}
