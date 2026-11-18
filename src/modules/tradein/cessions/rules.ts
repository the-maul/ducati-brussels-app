/**
 * M7 — Cessions internes / O.R.O (rattrapage G8, 18/11/2026) : REGLES PURES.
 * Miroir des fonctions SQL de la migration 20261118240000 (`_cession_unit_cost`,
 * `_vehicle_cost_recompute`, `internal_cession_cost_context`) : la base fait foi a la
 * validation, ces regles servent a l'affichage (fenetre « prix de revient », listes, impression).
 * Decision de Simon (18/11/2026) : pieces au PAMP par defaut, dernier prix d'achat au choix.
 */

export type CostBasis = 'pamp' | 'pa';
export type CessionStatus = 'ouvert' | 'valide' | 'archive' | 'annule';
export type CessionLineKind = 'piece' | 'mo' | 'frais' | 'texte';
/** Edition G8 : « en PAMP / prix de vente / prix d'achat ». */
export type PrintPriceMode = 'pamp' | 'pv' | 'pa';

export const COST_BASES: CostBasis[] = ['pamp', 'pa'];
export const CESSION_STATUSES: CessionStatus[] = ['ouvert', 'valide', 'archive', 'annule'];
export const LINE_KINDS: CessionLineKind[] = ['piece', 'mo', 'frais', 'texte'];

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};
const pos = (n: number | null | undefined) => (n != null && Number(n) > 0 ? Number(n) : null);

/** Cout unitaire selon la valorisation : PAMP (repli dernier PA) ou dernier PA (repli PAMP). */
export function unitCostFor(basis: CostBasis, pamp: number | null | undefined, pa: number | null | undefined): number {
  const v = basis === 'pa' ? (pos(pa) ?? pos(pamp) ?? 0) : (pos(pamp) ?? pos(pa) ?? 0);
  return round(v, 3);
}

/** Reglage « oui / non » de `cession_settings` (meme lecture que `_cession_truthy`). */
export function isTruthySetting(v: string | null | undefined): boolean {
  return ['oui', 'o', 'true', 'vrai', '1', 'yes', 'y', 'ja', 'si', 'on'].includes(String(v ?? '').trim().toLowerCase());
}

/** Valorisation par defaut de la societe (reglage `cost_basis`), PAMP si absent ou inconnu. */
export function defaultCostBasis(v: string | null | undefined): CostBasis {
  return String(v ?? '').trim().toLowerCase() === 'pa' ? 'pa' : 'pamp';
}

export type CostWindowInput = {
  /** Prix d'achat / de reprise de la moto (HT ; TTC pour une O, comme le coût de stock). */
  purchasePrice: number;
  /** Anciennes lignes d'ORO de la reprise (avant les cessions en document). */
  legacyOro: number;
  /** Autres cessions comptabilisees deja validees sur la moto (total + options). */
  otherCessions: number;
  /** Total de la cession en cours (lignes valorisees). */
  currentCost: number;
  /** Type de cession comptabilise : s'impute au cout de revient. */
  accounted: boolean;
  /** Options montees (montant saisi a la validation). */
  options: number;
  /** Prix de vente client TTC de la moto (null si inconnu). */
  saleTtc: number | null;
  /** Taux de TVA de l'article de la moto (0 pour une occasion en TVA marge). */
  vatRate: number | null;
};

export type CostWindow = {
  previousCost: number;
  currentImputed: number;
  otherCessions: number;
  options: number;
  newCost: number;
  saleHt: number | null;
  saleTtc: number | null;
  marginPr: number | null;
  marginPrPct: number | null;
  marginPa: number | null;
  marginPaPct: number | null;
};

/**
 * Fenetre « prix de revient » de G8 :
 *   ancien prix de revient (achat + anciennes lignes d'ORO) + cession actuelle (si comptabilisee)
 *   + autres cessions + options = nouveau prix de revient ;
 *   marge PR = PV HT − nouveau prix de revient (€ et % du PV HT) ; marge PA = PV HT − prix d'achat.
 * Exemple G8 (parcours 10) : 5 000 + 28,95 → 5 028,95, marge −28,95 (−0,58 %) au PV de 5 000.
 */
export function computeCostWindow(i: CostWindowInput): CostWindow {
  const previousCost = round(Number(i.purchasePrice || 0) + Number(i.legacyOro || 0));
  const options = round(Math.max(0, Number(i.options || 0)));
  const currentImputed = i.accounted ? round(Number(i.currentCost || 0) + options) : 0;
  const otherCessions = round(Number(i.otherCessions || 0));
  const newCost = round(previousCost + otherCessions + currentImputed);
  const vat = i.vatRate == null ? 21 : Number(i.vatRate);
  const saleTtc = i.saleTtc != null && Number(i.saleTtc) > 0 ? round(Number(i.saleTtc)) : null;
  const saleHt = saleTtc == null ? null : round(saleTtc / (1 + vat / 100));
  const pct = (m: number | null) => (m == null || !saleHt ? null : round((m / saleHt) * 100));
  const marginPr = saleHt == null ? null : round(saleHt - newCost);
  const marginPa = saleHt == null ? null : round(saleHt - Number(i.purchasePrice || 0));
  return {
    previousCost, currentImputed, otherCessions, options: i.accounted ? options : 0, newCost,
    saleHt, saleTtc, marginPr, marginPrPct: pct(marginPr), marginPa, marginPaPct: pct(marginPa),
  };
}

export type PricedLine = {
  kind: CessionLineKind;
  quantity: number;
  unit_cost: number;
  unit_pamp: number | null;
  unit_pa: number | null;
  unit_sale_ht: number | null;
  cost_locked: boolean;
};

/** Prix unitaire imprime selon l'edition choisie (une ligne a cout saisi garde son cout). */
export function printUnitPrice(l: PricedLine, mode: PrintPriceMode): number {
  if (l.kind === 'texte') return 0;
  if (mode === 'pv') return Number(l.unit_sale_ht ?? 0);
  if (l.cost_locked) return Number(l.unit_cost ?? 0);
  if (mode === 'pa') return Number(l.unit_pa ?? l.unit_cost ?? 0);
  return Number(l.unit_pamp ?? l.unit_cost ?? 0);
}

export function printLineTotal(l: PricedLine, mode: PrintPriceMode): number {
  return round(Number(l.quantity || 0) * printUnitPrice(l, mode));
}

export function printTotal(lines: PricedLine[], mode: PrintPriceMode): number {
  return round(lines.reduce((s, l) => s + printLineTotal(l, mode), 0));
}

/** Rayon = premier segment du code famille (« 03-01-01 » → « 03 ») ; vide = sans rayon. */
export function rayonOf(categoryPath: string | null | undefined): string {
  const s = String(categoryPath ?? '').trim();
  if (!s) return '';
  return s.split(/[-/.\s]/)[0] ?? '';
}

export type ReportLine = {
  category_path: string | null;
  quantity: number;
  amount_pamp: number;
  amount_sale_ht: number;
};

export type RayonTotal = { rayon: string; quantity: number; amountPamp: number; amountSaleHt: number; lines: number };

/** Liste G8 « Cessions » par rayon : quantite, montant HT au PAMP, montant HT a la vente. */
export function groupByRayon(lines: ReportLine[]): RayonTotal[] {
  const map = new Map<string, RayonTotal>();
  for (const l of lines) {
    const r = rayonOf(l.category_path);
    const cur = map.get(r) ?? { rayon: r, quantity: 0, amountPamp: 0, amountSaleHt: 0, lines: 0 };
    cur.quantity = round(cur.quantity + Number(l.quantity || 0), 3);
    cur.amountPamp = round(cur.amountPamp + Number(l.amount_pamp || 0));
    cur.amountSaleHt = round(cur.amountSaleHt + Number(l.amount_sale_ht || 0));
    cur.lines += 1;
    map.set(r, cur);
  }
  return [...map.values()].sort((a, b) => (a.rayon === '' ? 1 : b.rayon === '' ? -1 : a.rayon.localeCompare(b.rayon)));
}

/** Heures passees proposees depuis la pointeuse (minutes → heures, 2 decimales). */
export function minutesToHours(minutes: number | null | undefined): number {
  return round(Number(minutes || 0) / 60);
}

/** Actions possibles selon le statut (boutons du document). */
export function cessionActions(status: CessionStatus): { edit: boolean; validate: boolean; cancel: boolean; archive: boolean; unarchive: boolean } {
  return {
    edit: status === 'ouvert',
    validate: status === 'ouvert',
    cancel: status === 'ouvert',
    archive: status === 'ouvert' || status === 'valide',
    unarchive: status === 'archive',
  };
}
