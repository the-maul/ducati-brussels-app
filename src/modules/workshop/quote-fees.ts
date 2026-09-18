/**
 * M8 — Frais de devis atelier (mission 02, process-commandes-pieces §1.4 / §4 point 8).
 * Quand un devis de pièces vient de l'atelier, on ajoute les frais du devis :
 *  - accident   = montant fixe (125 € HTVA par défaut) ;
 *  - diagnostic = tarif horaire de l'atelier × heures, plafonné (4 h par défaut), sans nouveau devis.
 * Valeurs paramétrables par société : reference_values, table_key = 'workshop_quote_fee'.
 * Fonctions pures, testées dans tests/workshop-quote-fees.test.ts.
 */
import type { LineInput } from '@/modules/sales/write-api';

export type QuoteFeeKind = 'accident' | 'diagnostic';

export type QuoteFeeParams = {
  accidentAmountHt: number;   // frais fixe d'un devis accident (HTVA)
  diagnosticMaxHours: number; // plafond d'heures de diagnostic facturables sans nouveau devis
  hourlyRateHt: number;       // tarif horaire atelier (HTVA) ; 0 = non renseigné
  vatRate: number;            // TVA appliquée à la ligne de frais
};

export const QUOTE_FEE_TABLE_KEY = 'workshop_quote_fee';

export const DEFAULT_QUOTE_FEES: QuoteFeeParams = {
  accidentAmountHt: 125,
  diagnosticMaxHours: 4,
  hourlyRateHt: 0,
  vatRate: 21,
};

type RefLike = { code: string; is_active?: boolean | null; extra: unknown };

const pos = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Lit les paramètres (lignes reference_values 'workshop_quote_fee') ; toute valeur absente
 * retombe sur le défaut. Le tarif horaire vient du paramètre `diagnostic.hourly_rate_ht` ;
 * s'il vaut 0 ou est vide, on reprend le prix de vente de l'article « MO » (main-d'œuvre, type T).
 */
export function resolveQuoteFeeParams(rows: RefLike[], moArticlePriceHt?: number | null): QuoteFeeParams {
  const extra = (code: string): Record<string, unknown> => {
    const r = rows.find((x) => x.code === code && x.is_active !== false);
    return r && r.extra && typeof r.extra === 'object' ? (r.extra as Record<string, unknown>) : {};
  };
  const acc = extra('accident');
  const diag = extra('diagnostic');
  const paramRate = pos(diag.hourly_rate_ht);
  const moRate = pos(moArticlePriceHt);
  return {
    accidentAmountHt: pos(acc.amount_ht) ?? DEFAULT_QUOTE_FEES.accidentAmountHt,
    diagnosticMaxHours: pos(diag.max_hours) ?? DEFAULT_QUOTE_FEES.diagnosticMaxHours,
    hourlyRateHt: paramRate && paramRate > 0 ? paramRate : (moRate ?? DEFAULT_QUOTE_FEES.hourlyRateHt),
    vatRate: pos(diag.vat_rate) ?? pos(acc.vat_rate) ?? DEFAULT_QUOTE_FEES.vatRate,
  };
}

/** Heures de diagnostic retenues : entre 0 et le plafond (on ne peut que descendre). */
export function clampDiagnosticHours(hours: number, maxHours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(Math.min(hours, maxHours) * 100) / 100;
}

/** Libellé affiché sur le devis et le PDF. */
export function quoteFeeDesignation(kind: QuoteFeeKind, hours = 0): string {
  if (kind === 'accident') return 'Frais de devis accident';
  const h = String(Math.round(hours * 100) / 100).replace('.', ',');
  return `Diagnostic (${h} h)`;
}

/** Ligne de frais (ligne dédiée, sans article : aucun mouvement de stock à la facturation). */
export function buildQuoteFeeLine(kind: QuoteFeeKind, p: QuoteFeeParams, hours?: number): LineInput {
  if (kind === 'accident') {
    return { article_id: null, designation: quoteFeeDesignation('accident'), quantity: 1, unit_price_ht: p.accidentAmountHt, vat_rate: p.vatRate, discount_pct: 0 };
  }
  const h = clampDiagnosticHours(hours ?? p.diagnosticMaxHours, p.diagnosticMaxHours);
  return { article_id: null, designation: quoteFeeDesignation('diagnostic', h), quantity: h, unit_price_ht: p.hourlyRateHt, vat_rate: p.vatRate, discount_pct: 0 };
}

/** Montant HTVA des frais (accident fixe ; diagnostic = tarif × heures plafonnées). */
export function quoteFeeAmountHt(kind: QuoteFeeKind, p: QuoteFeeParams, hours?: number): number {
  const l = buildQuoteFeeLine(kind, p, hours);
  return Math.round(l.quantity * l.unit_price_ht * 100) / 100;
}

/**
 * Pose la ligne de frais sur une liste de lignes : toute ligne de frais existante (marquée `_fee`)
 * est remplacée, jamais dupliquée. Les lignes vides (sans désignation) sont retirées au passage.
 */
export function applyQuoteFee<T extends LineInput & { _fee?: QuoteFeeKind | null }>(
  lines: T[], fee: T,
): T[] {
  const kept = lines.filter((l) => !l._fee && l.designation.trim() !== '');
  return [...kept, fee];
}
