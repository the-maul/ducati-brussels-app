/**
 * Règles métier des commandes de pièces — fonctions pures, testables.
 *
 * Les valeurs (minimums, supplément, nombre par jour, repli, minimum par onglet) ne sont
 * PAS en dur : elles viennent de Paramètres → Tables → « Règles des types de commande »
 * (reference_values / order_threshold), lues par la fonction SQL `part_order_rules`.
 * Le contrôle qui fait foi est côté serveur (`part_order_check_rules`, appelé par
 * `part_order_transition` à la validation et à l'envoi) ; ces fonctions reproduisent
 * la même logique pour l'affichage et les tests.
 */
import type { OrderKind } from './api';

/** Règle d'un type de commande (une ligne de Paramètres → Tables). */
/**
 * Valeur de SECOURS uniquement, si le réglage « Règles des types de commande » manque pour la
 * société (Paramètres → Tables). La valeur de référence est toujours celle des paramètres.
 */
export const DEFAULT_THRESHOLDS = { excel: { minHtPerTab: 2000 } } as const;

export type OrderRule = {
  code: OrderKind;
  label: string;
  sortOrder: number;
  isActive: boolean;
  /** false = type présent dans la base mais pas encore réglé dans Paramètres */
  configured: boolean;
  /** minimum HTVA de la commande (null = pas de minimum) */
  minHt: number | null;
  /** supplément facturé au client, en % */
  surchargePct: number;
  /** nombre maximum de commandes validées par jour et par société (null = illimité) */
  maxPerDay: number | null;
  /** type vers lequel la commande repasse si son minimum n'est pas atteint */
  fallback: OrderKind | null;
  /** minimum HTVA par onglet du classeur Excel (null = pas de minimum) */
  minHtPerTab: number | null;
};

export type ExcelTab = 'demo' | 'courtoisie' | 'showroom';
export const EXCEL_TABS: ExcelTab[] = ['demo', 'courtoisie', 'showroom'];

export function ruleFor(rules: OrderRule[], kind: OrderKind): OrderRule | undefined {
  return rules.find((r) => r.code === kind);
}

/** Supplément appliqué au client selon le type (réglé dans Paramètres). */
export function surchargeForKind(kind: OrderKind, rules: OrderRule[]): number {
  const r = ruleFor(rules, kind);
  return r && r.isActive ? r.surchargePct : 0;
}

/**
 * Type effectif d'une commande et respect du minimum.
 * - type avec repli (accident) sous son minimum → repasse dans le type de repli (standard),
 *   dont le minimum s'applique alors ;
 * - type sans minimum (urgente) → toujours atteint.
 */
export function resolveKind(
  kind: OrderKind,
  totalHt: number,
  rules: OrderRule[],
): { effectiveKind: OrderKind; thresholdMet: boolean } {
  let r = ruleFor(rules, kind);
  let eff = kind;
  if (r && r.fallback && r.fallback !== kind && r.minHt != null && totalHt < r.minHt) {
    const fb = ruleFor(rules, r.fallback);
    if (fb) { eff = r.fallback; r = fb; }
  }
  const met = !r || r.minHt == null || r.minHt <= 0 || totalHt >= r.minHt;
  return { effectiveKind: eff, thresholdMet: met };
}

/** Prix client d'une ligne, supplément du type inclus. */
export function clientLinePrice(unitHt: number, qty: number, kind: OrderKind, rules: OrderRule[]): number {
  const base = unitHt * qty;
  return round2(base * (1 + surchargeForKind(kind, rules) / 100));
}

export type RuleIssueCode =
  | 'no_lines' | 'no_rule' | 'kind_disabled' | 'fallback' | 'below_min' | 'below_min_tab' | 'daily_limit';
export type RuleIssue = { code: RuleIssueCode; kind?: OrderKind; tab?: ExcelTab; min?: number; total?: number; max?: number; to?: OrderKind };

export type OrderCheckInput = {
  kind: OrderKind;
  /** total HTVA de la commande */
  totalHt: number;
  /** nombre de pièces (lignes de commande + lignes Excel) */
  lineCount: number;
  /** total remisé par onglet Excel (onglets avec au moins une pièce) */
  excelTabs?: Partial<Record<ExcelTab, number>>;
  /** commandes du même type déjà validées aujourd'hui par la société */
  validatedToday?: number;
  /** la commande est encore en brouillon (le « n par jour » ne se contrôle qu'à la validation) */
  isDraft?: boolean;
};

export type OrderCheckResult = {
  ok: boolean;
  effectiveKind: OrderKind;
  surchargePct: number;
  errors: RuleIssue[];
  notices: RuleIssue[];
};

/** Même logique que la fonction SQL `part_order_check_rules`. */
export function checkOrderRules(input: OrderCheckInput, rules: OrderRule[]): OrderCheckResult {
  const errors: RuleIssue[] = [];
  const notices: RuleIssue[] = [];
  let eff = input.kind;
  const total = input.totalHt;

  if (input.lineCount === 0) errors.push({ code: 'no_lines' });

  let r = ruleFor(rules, eff);
  if (!r || !r.configured) {
    notices.push({ code: 'no_rule', kind: eff });
    return { ok: errors.length === 0, effectiveKind: eff, surchargePct: 0, errors, notices };
  }
  if (!r.isActive) {
    errors.push({ code: 'kind_disabled', kind: eff });
    return { ok: false, effectiveKind: eff, surchargePct: 0, errors, notices };
  }

  if (r.fallback && r.fallback !== eff && r.minHt != null && total < r.minHt) {
    const fb = ruleFor(rules, r.fallback);
    if (fb) {
      notices.push({ code: 'fallback', kind: eff, to: r.fallback, min: r.minHt, total });
      eff = r.fallback;
      r = fb;
    }
  }

  if (r.isActive) {
    if (r.minHt != null && r.minHt > 0 && total < r.minHt) {
      errors.push({ code: 'below_min', kind: eff, min: r.minHt, total });
    }
    if (r.minHtPerTab != null && r.minHtPerTab > 0 && input.excelTabs) {
      for (const tab of EXCEL_TABS) {
        const v = input.excelTabs[tab];
        if (v != null && v < r.minHtPerTab) errors.push({ code: 'below_min_tab', kind: eff, tab, min: r.minHtPerTab, total: v });
      }
    }
    if (r.maxPerDay != null && r.maxPerDay > 0 && input.isDraft !== false && (input.validatedToday ?? 0) >= r.maxPerDay) {
      errors.push({ code: 'daily_limit', kind: eff, max: r.maxPerDay });
    }
  }

  return { ok: errors.length === 0, effectiveKind: eff, surchargePct: r.isActive ? r.surchargePct : 0, errors, notices };
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

/** Un onglet atteint-il le minimum par onglet (réglé dans Paramètres) ? */
export function excelTabReached(lines: ExcelLine[], tab: ExcelTab, minHtPerTab: number): boolean {
  return excelTabTotal(lines, tab) >= minHtPerTab;
}

/** Reste à commander sur un onglet pour atteindre le minimum (0 si atteint). */
export function excelTabRemaining(lines: ExcelLine[], tab: ExcelTab, minHtPerTab: number): number {
  const rem = minHtPerTab - excelTabTotal(lines, tab);
  return rem > 0 ? round2(rem) : 0;
}

/** État par onglet (pour la notif navbar + affichage). */
export function excelTabsStatus(
  lines: ExcelLine[],
  minHtPerTab: number,
): Record<ExcelTab, { total: number; reached: boolean; remaining: number }> {
  const out = {} as Record<ExcelTab, { total: number; reached: boolean; remaining: number }>;
  for (const t of EXCEL_TABS) {
    out[t] = {
      total: excelTabTotal(lines, t),
      reached: excelTabReached(lines, t, minHtPerTab),
      remaining: excelTabRemaining(lines, t, minHtPerTab),
    };
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Récapitulatif par onglet utilisé par l'écran et l'alerte de la barre du haut
 * (carte mission 02) : total = Σ prix dealer × qté (col M), seuil paramétré
 * (reference_values order_threshold / excel, 2 000 € HTVA par défaut). Le total
 * remisé (col O) est donné pour information.
 */
export type ExcelTabSummary = { total: number; totalFinal: number; reached: boolean; remaining: number; lines: number };

export function excelTabsSummary(lines: ExcelLine[], minPerTab: number = DEFAULT_THRESHOLDS.excel.minHtPerTab): Record<ExcelTab, ExcelTabSummary> {
  const out = {} as Record<ExcelTab, ExcelTabSummary>;
  for (const t of ['demo', 'courtoisie', 'showroom'] as ExcelTab[]) {
    const tl = lines.filter((l) => l.tab === t);
    const total = round2(tl.reduce((s, l) => s + l.priceDealer * l.qty, 0));
    const totalFinal = round2(tl.reduce((s, l) => s + excelLineFinal(l), 0));
    const reached = total >= minPerTab;
    out[t] = { total, totalFinal, reached, remaining: reached ? 0 : round2(minPerTab - total), lines: tl.length };
  }
  return out;
}
