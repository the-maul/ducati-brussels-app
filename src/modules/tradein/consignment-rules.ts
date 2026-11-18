/**
 * M7 — Dépôt-vente (type D) : règles pures (rattrapage G8 du 18/11/2026, VEN007 / VEN008).
 * Même calcul que la fonction SQL `consignment_amounts` (migration 20261118270000), testé dans
 * `tests/depot-vente.test.ts`. Aucun import applicatif : exécutable tel quel par les tests.
 *
 * Montants TTC (G8 : « commission sur la vente, dont TVA ») :
 *  - commission : `ecart` = max(prix de vente − prix demandé, 0) ; `pourcentage` = PV × % ;
 *    `forfait` = montant fixe ;
 *  - facture au déposant = commission + frais + réparations (TVA comprise, taux du réglage, 21 %) ;
 *    HT = TTC × 100 / (100 + taux) arrondi au cent, TVA = TTC − HT ;
 *  - net au déposant (décompte) = prix de vente − facture au déposant.
 * Invariant : la moto D n'entre JAMAIS en valorisation de stock (`stockEntryUnitCost` = null).
 */

export type CommissionMode = 'ecart' | 'pourcentage' | 'forfait';
export const COMMISSION_MODES: readonly CommissionMode[] = ['ecart', 'pourcentage', 'forfait'];
export type DepositorKind = 'particulier' | 'professionnel';
export const DEPOSITOR_KINDS: readonly DepositorKind[] = ['particulier', 'professionnel'];
export type ConsignmentStatus = 'en_depot' | 'vendu' | 'restitue';
export const CONSIGNMENT_STATUSES: readonly ConsignmentStatus[] = ['en_depot', 'vendu', 'restitue'];

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const pos = (n: number | null | undefined) => Math.max(Number(n ?? 0) || 0, 0);

/** HT d'un montant TTC au taux donné (arrondi au cent), même règle que la SQL. */
export function htFromTtc(ttc: number, rate: number): number {
  return r2((ttc * 100) / (100 + (rate || 0)));
}

/** Commission TTC selon le mode de la fiche. */
export function commissionTtc(p: {
  salePrice: number; askedPrice: number; mode: CommissionMode; pct?: number | null; fixed?: number | null;
}): number {
  const raw = p.mode === 'pourcentage' ? (Number(p.salePrice) || 0) * (Number(p.pct ?? 0) || 0) / 100
    : p.mode === 'forfait' ? Number(p.fixed ?? 0) || 0
      : (Number(p.salePrice) || 0) - (Number(p.askedPrice) || 0);
  return r2(Math.max(raw, 0));
}

export type ConsignmentSettlement = {
  salePrice: number;
  commissionTtc: number; commissionHt: number; commissionVat: number;
  feesTtc: number; feesHt: number;
  repairsTtc: number; repairsHt: number;
  /** Facture au déposant (commission + frais + réparations). */
  invoiceTtc: number; invoiceHt: number; invoiceVat: number;
  /** Net reversé au déposant. */
  net: number;
};

export function computeSettlement(p: {
  salePrice: number; askedPrice: number; mode: CommissionMode; pct?: number | null; fixed?: number | null;
  fees?: number | null; repairs?: number | null; vatRate: number;
}): ConsignmentSettlement {
  const sale = r2(Number(p.salePrice) || 0);
  const c = commissionTtc(p);
  const f = r2(pos(p.fees));
  const r = r2(pos(p.repairs));
  const ch = htFromTtc(c, p.vatRate);
  const fh = htFromTtc(f, p.vatRate);
  const rh = htFromTtc(r, p.vatRate);
  const invoiceTtc = r2(c + f + r);
  const invoiceHt = r2(ch + fh + rh);
  return {
    salePrice: sale,
    commissionTtc: c, commissionHt: ch, commissionVat: r2(c - ch),
    feesTtc: f, feesHt: fh, repairsTtc: r, repairsHt: rh,
    invoiceTtc, invoiceHt, invoiceVat: r2(invoiceTtc - invoiceHt),
    net: r2(sale - invoiceTtc),
  };
}

/** Ligne de la facture acheteur : la moto D au taux du réglage (particulier / professionnel). */
export function buyerInvoiceLine(salePrice: number, vatRate: number): { unitPriceHt: number; vat: number; ttc: number } {
  const ttc = r2(salePrice);
  const ht = htFromTtc(ttc, vatRate);
  return { unitPriceHt: ht, vat: r2(ttc - ht), ttc };
}

/** Prix de vente sous le minimum de réserve (accord du déposant à confirmer). */
export function belowReserve(salePrice: number, minPrice: number): boolean {
  return minPrice > 0 && salePrice > 0 && salePrice < minPrice;
}

export type SaleCheck = 'needBuyer' | 'needPrice' | 'buyerIsDepositor' | 'negativeNet' | 'belowReserve' | null;
/** Contrôles avant la vente (mêmes refus que la SQL, message lisible avant l'appel). */
export function saleCheck(p: {
  buyerId: string | null; depositorId: string | null; salePrice: number; minPrice: number;
  net: number; forceBelowMin: boolean;
}): SaleCheck {
  if (!p.buyerId) return 'needBuyer';
  if (!(p.salePrice > 0)) return 'needPrice';
  if (p.depositorId && p.buyerId === p.depositorId) return 'buyerIsDepositor';
  if (belowReserve(p.salePrice, p.minPrice) && !p.forceBelowMin) return 'belowReserve';
  if (p.net < 0) return 'negativeNet';
  return null;
}

/** Coût unitaire de l'entrée en stock d'une moto en dépôt : toujours aucun (invariant D). */
export function stockEntryUnitCost(_mgmtType: 'D'): null {
  return null;
}

/** Valeur de stock « à nous » : les articles D n'y entrent jamais (miroir de `stock_value_owned`). */
export function ownedStockValue(rows: { mgmtType: string; realQty: number; pamp: number }[]): number {
  return r2(rows.filter((r) => r.mgmtType !== 'D').reduce((s, r) => s + (r.realQty || 0) * (r.pamp || 0), 0));
}

// ---------------------------------------------------------------------------------------------
// Liste des dépôts : vues et filtres (G8 « Liste des dépôts vente » : n°, référence, immat.)
// ---------------------------------------------------------------------------------------------
export type ConsignmentView = 'en_cours' | 'vendus' | 'rendus' | 'tous';
export const CONSIGNMENT_VIEWS: readonly ConsignmentView[] = ['en_cours', 'vendus', 'rendus', 'tous'];
const VIEW_STATUS: Record<ConsignmentView, ConsignmentStatus | null> = {
  en_cours: 'en_depot', vendus: 'vendu', rendus: 'restitue', tous: null,
};

export type ConsignmentSearchRow = {
  status: string; number: string | null; reference?: string | null; plate?: string | null; vin?: string | null;
  depositorName?: string | null; buyerName?: string | null; model?: string | null;
};

const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s.-]/g, '');

export function filterConsignments<T extends ConsignmentSearchRow>(rows: T[], view: ConsignmentView, query: string): T[] {
  const st = VIEW_STATUS[view];
  const q = norm(query);
  return rows.filter((r) => (!st || r.status === st)
    && (!q || [r.number, r.reference, r.plate, r.vin, r.depositorName, r.buyerName, r.model].some((v) => norm(v).includes(q))));
}

/** Tonalité du badge de statut (couleur + icône + libellé, charte §8). */
export function statusTone(status: string): 'info' | 'success' | 'neutral' {
  return status === 'vendu' ? 'success' : status === 'en_depot' ? 'info' : 'neutral';
}

/** Mention de la facture acheteur : `{numero}` remplacé par le n° DEP. */
export function fillMention(template: string | null | undefined, number: string): string {
  return (template ?? '').split('{numero}').join(number).trim();
}

/** Lecture tolérante d'un réglage (« oui », « 1 », « true »…), même règle que `_consignment_truthy`. */
export function settingTruthy(v: string | null | undefined): boolean {
  return ['oui', 'o', 'true', 'vrai', '1', 'yes', 'y', 'ja', 'si', 'on'].includes((v ?? '').trim().toLowerCase());
}
export function settingNumber(v: string | null | undefined, fallback: number): number {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : fallback;
}
