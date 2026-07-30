/**
 * Règles métier des commandes de pièces (Miro 2026-07-30) — fonctions pures, testables.
 * Seuils par défaut ; les valeurs réelles sont paramétrables (reference_values / order_threshold).
 */
import type { OrderKind } from './api';

export const DEFAULT_THRESHOLDS = {
  standard: { minHt: 250, surchargePct: 0 },
  urgente: { minHt: 0, surchargePct: 10, maxPerDay: 1 },
  accident: { minHt: 1500, fallback: 'standard' as OrderKind },
  excel: { minHtPerTab: 2000, tabs: ['demo', 'courtoisie', 'showroom'] as const },
};

export type ExcelTab = 'demo' | 'courtoisie' | 'showroom';

/** Surcharge appliquée au client selon le type (urgente = +10 %). */
export function surchargeForKind(kind: OrderKind): number {
  return kind === 'urgente' ? DEFAULT_THRESHOLDS.urgente.surchargePct : 0;
}

/**
 * Valide un montant HTVA pour un type donné.
 * - standard : doit atteindre 250 € (sinon en attente de regroupement).
 * - accident : doit atteindre 1500 €, sinon repasse en standard.
 * - urgente  : pas de minima.
 * Retourne le type effectif + si le seuil est atteint.
 */
export function resolveKind(kind: OrderKind, totalHt: number): { effectiveKind: OrderKind; thresholdMet: boolean } {
  if (kind === 'accident') {
    const met = totalHt >= DEFAULT_THRESHOLDS.accident.minHt;
    return met ? { effectiveKind: 'accident', thresholdMet: true } : { effectiveKind: 'standard', thresholdMet: totalHt >= DEFAULT_THRESHOLDS.standard.minHt };
  }
  if (kind === 'standard') {
    return { effectiveKind: 'standard', thresholdMet: totalHt >= DEFAULT_THRESHOLDS.standard.minHt };
  }
  // urgente / excel : pas de minima bloquant à ce niveau
  return { effectiveKind: kind, thresholdMet: true };
}

/** Prix client d'une ligne, surcharge de type incluse. */
export function clientLinePrice(unitHt: number, qty: number, kind: OrderKind): number {
  const base = unitHt * qty;
  const pct = surchargeForKind(kind);
  return round2(base * (1 + pct / 100));
}

// ---- Commande Excel : calculs par onglet (reproduit les formules du classeur Ducati) ----

export type ExcelLine = { tab: ExcelTab; priceDealer: number; qty: number; extraDiscount: number };

/** Valeur d'une ligne = prix dealer × qté (col M). */
export function excelLineValue(l: Pick<ExcelLine, 'priceDealer' | 'qty'>): number {
  return round2(l.priceDealer * l.qty);
}

/** Prix concessionnaire final d'une ligne = M − (M × extra) (col O). */
export function excelLineFinal(l: ExcelLine): number {
  const m = l.priceDealer * l.qty;
  return round2(m - m * l.extraDiscount);
}

/** Total remisé (net) d'un onglet = Σ des prix finaux. */
export function excelTabTotal(lines: ExcelLine[], tab: ExcelTab): number {
  return round2(lines.filter((l) => l.tab === tab).reduce((s, l) => s + excelLineFinal(l), 0));
}

/** Un onglet atteint-il le minima (2000 € HTVA) pour l'extra-discount ? */
export function excelTabReached(lines: ExcelLine[], tab: ExcelTab): boolean {
  return excelTabTotal(lines, tab) >= DEFAULT_THRESHOLDS.excel.minHtPerTab;
}

/** Reste à commander sur un onglet pour atteindre le seuil (0 si atteint). */
export function excelTabRemaining(lines: ExcelLine[], tab: ExcelTab): number {
  const rem = DEFAULT_THRESHOLDS.excel.minHtPerTab - excelTabTotal(lines, tab);
  return rem > 0 ? round2(rem) : 0;
}

/** État par onglet (pour la notif navbar + affichage). */
export function excelTabsStatus(lines: ExcelLine[]): Record<ExcelTab, { total: number; reached: boolean; remaining: number }> {
  const tabs: ExcelTab[] = ['demo', 'courtoisie', 'showroom'];
  const out = {} as Record<ExcelTab, { total: number; reached: boolean; remaining: number }>;
  for (const t of tabs) {
    out[t] = { total: excelTabTotal(lines, t), reached: excelTabReached(lines, t), remaining: excelTabRemaining(lines, t) };
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
