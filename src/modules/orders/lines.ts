/**
 * Lignes d'une commande de pièces — fonctions pures, testables (carte « Ajouter et modifier
 * les pièces d'une commande », mission 02).
 *
 * Le serveur fait foi : le total de ligne est recalculé par le trigger `part_order_lines_guard`
 * et les règles par `part_order_check_rules`. Ces fonctions reproduisent les mêmes formules
 * pour l'affichage en direct (totaux et rappel du seuil pendant la saisie).
 */
import type { OrderKind } from './api';
import { ruleFor, type OrderRule } from './thresholds';

export type LineAmounts = {
  qtyClient: number;
  qtyShop: number;
  unitPriceHt: number;
  vatRate: number;
};

/** Arrondi au centime, demi vers l'extérieur (comme round() de PostgreSQL sur numeric). */
function round2(n: number): number {
  const s = n < 0 ? -1 : 1;
  return (s * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

/** Total HTVA d'une ligne = (qté client + qté magasin) × PU HTVA, arrondi au centime (= serveur). */
export function lineHt(l: Pick<LineAmounts, 'qtyClient' | 'qtyShop' | 'unitPriceHt'>): number {
  const qty = (Number(l.qtyClient) || 0) + (Number(l.qtyShop) || 0);
  return round2(qty * (Number(l.unitPriceHt) || 0));
}

export type OrderTotals = {
  lineCount: number;
  qtyClient: number;
  qtyShop: number;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
};

/** Totaux d'une commande (avant supplément du type, fixé à la validation). */
export function orderTotals(lines: LineAmounts[]): OrderTotals {
  let qtyClient = 0;
  let qtyShop = 0;
  let totalHt = 0;
  let totalTtc = 0;
  for (const l of lines) {
    const ht = lineHt(l);
    qtyClient += Number(l.qtyClient) || 0;
    qtyShop += Number(l.qtyShop) || 0;
    totalHt += ht;
    totalTtc += ht * (1 + (Number(l.vatRate) || 0) / 100);
  }
  totalHt = round2(totalHt);
  totalTtc = round2(totalTtc);
  return { lineCount: lines.length, qtyClient, qtyShop, totalHt, totalVat: round2(totalTtc - totalHt), totalTtc };
}

/**
 * Remplace (ou ajoute) la ligne en cours de saisie dans la liste, pour calculer
 * les totaux et le seuil en direct avant l'enregistrement.
 */
export function withDraftLine<T extends LineAmounts & { id?: string }>(
  lines: T[],
  draft: (LineAmounts & { id?: string | null }) | null,
): LineAmounts[] {
  if (!draft) return lines;
  if (draft.id) return lines.map((l) => (l.id === draft.id ? draft : l));
  return [...lines, draft];
}

export type LineInputError = 'qty_negative' | 'qty_zero' | 'price_negative' | 'designation_empty';

/** Mêmes contrôles que le serveur (trigger part_order_lines_guard). */
export function validateLine(l: LineAmounts & { designation?: string | null }): LineInputError | null {
  const qc = Number(l.qtyClient);
  const qs = Number(l.qtyShop);
  if (l.designation != null && l.designation.trim() === '') return 'designation_empty';
  if (!Number.isFinite(qc) || !Number.isFinite(qs) || qc < 0 || qs < 0) return 'qty_negative';
  if (qc + qs <= 0) return 'qty_zero';
  const pu = Number(l.unitPriceHt);
  if (!Number.isFinite(pu) || pu < 0) return 'price_negative';
  return null;
}

/** Stock disponible (B4) = réel − réservé + en commande. */
export function availableQty(real: number, reserved: number, onOrder: number): number {
  return (Number(real) || 0) - (Number(reserved) || 0) + (Number(onOrder) || 0);
}

export type ThresholdTone = 'success' | 'warning' | 'danger' | 'info';

export type ThresholdProgress = {
  /** type choisi */
  kind: OrderKind;
  /** type qui s'appliquera à la validation (repli accident → standard) */
  effectiveKind: OrderKind;
  /** la commande repasse dans son type de repli */
  fellBack: boolean;
  /** minimum du type choisi (null = aucun) */
  kindMin: number | null;
  /** ce qu'il manque pour rester dans le type choisi (0 si atteint ou sans minimum) */
  kindRemaining: number;
  /** minimum qui s'applique (type effectif) */
  min: number | null;
  /** ce qu'il manque pour le minimum qui s'applique */
  remaining: number;
  /** minimum qui s'applique atteint (ou pas de minimum) */
  met: boolean;
  /** avancement vers le minimum du type choisi, 0 à 100 */
  percent: number;
  /** supplément client du type effectif, en % */
  surchargePct: number;
  /** le type est réglé dans Paramètres */
  configured: boolean;
  /** le type est désactivé dans Paramètres */
  disabled: boolean;
  tone: ThresholdTone;
};

const positiveMin = (v: number | null | undefined): number | null => (v != null && v > 0 ? v : null);

/**
 * Rappel du seuil du type en direct : minimum, ce qu'il manque, bascule vers le type de repli.
 * Même logique que checkOrderRules / part_order_check_rules (hors « n par jour » et onglets Excel,
 * contrôlés par le serveur à la validation).
 */
export function thresholdProgress(kind: OrderKind, totalHt: number, rules: OrderRule[]): ThresholdProgress {
  const total = round2(Number(totalHt) || 0);
  const r = ruleFor(rules, kind);
  const base = {
    kind, effectiveKind: kind, fellBack: false, kindMin: null, kindRemaining: 0, min: null,
    remaining: 0, met: true, percent: 100, surchargePct: 0,
  };
  if (!r || !r.configured) return { ...base, configured: false, disabled: false, tone: 'info' };
  if (!r.isActive) return { ...base, configured: true, disabled: true, met: false, percent: 0, tone: 'danger' };

  const kindMin = positiveMin(r.minHt);
  const kindRemaining = kindMin != null && total < kindMin ? round2(kindMin - total) : 0;
  const percent = kindMin == null ? 100 : Math.max(0, Math.min(100, Math.floor((total / kindMin) * 100)));

  let eff = r;
  let fellBack = false;
  if (r.fallback && r.fallback !== kind && r.minHt != null && total < r.minHt) {
    const fb = ruleFor(rules, r.fallback);
    if (fb) { eff = fb; fellBack = true; }
  }
  const min = eff.isActive ? positiveMin(eff.minHt) : null;
  const remaining = min != null && total < min ? round2(min - total) : 0;
  const met = eff.isActive && remaining === 0;
  const tone: ThresholdTone = !met ? 'danger' : fellBack ? 'warning' : 'success';

  return {
    kind, effectiveKind: eff.code, fellBack, kindMin, kindRemaining, min, remaining, met, percent,
    surchargePct: eff.isActive ? eff.surchargePct : 0, configured: true, disabled: false, tone,
  };
}
