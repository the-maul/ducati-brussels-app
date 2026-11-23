/**
 * M7 — Fil d'étapes du dépôt-vente (chantier C8, parcours REP-03, REP-04, REP-05, 23/11/2026) : règles pures.
 *
 * Entrée de la moto → Frais / remise en état → En vente → Vendue → Reversement au déposant → Clôturé,
 * ou branche Retour au propriétaire. L'étape courante se déduit des données réelles du dépôt (statut,
 * facture acheteur, versement, cessions) : aucun nouveau statut en base, aucun montant recalculé ici.
 * Décisions VP4 inchangées : cession ouverte d'office, frais payés par le déposant, hors coût de revient.
 * Testées dans tests/depot-vente-fil.test.ts.
 */
import type { ConsignmentStatus } from './consignment-rules';

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const CENT = 0.005;

export type DepotStepKey = 'entree' | 'frais' | 'vente' | 'vendue' | 'reversement' | 'cloture' | 'retour';
export const DEPOT_MAIN_PATH: readonly DepotStepKey[] = ['entree', 'frais', 'vente', 'vendue', 'reversement', 'cloture'];
export const DEPOT_RETURN_PATH: readonly DepotStepKey[] = ['entree', 'frais', 'retour', 'cloture'];

export type DepotFacts = {
  status: ConsignmentStatus;
  /** Net à reverser au déposant, figé à la vente. */
  soldReversal: number | null;
  payoutAt: string | null;
  /** Reste dû par l'acheteur ; null = pas de facture acheteur (parcours G8 par mouvement de caisse). */
  buyerDue: number | null;
  /** Reste dû sur la facture de frais de retour ; null = pas de facture de retour. */
  returnDue: number | null;
  /** Cessions ouvertes avec des lignes : leurs frais ne sont pas encore comptés. */
  cessionsToValidate: number;
  /** Cessions archivées sans validation, avec des lignes : leurs frais ne sont pas dans le décompte. */
  cessionsMissed: number;
};

/** Étape courante : la prochaine chose à faire sur ce dépôt. */
export function depotCurrentStep(f: DepotFacts): DepotStepKey {
  if (f.status === 'restitue') return (f.returnDue ?? 0) > CENT ? 'retour' : 'cloture';
  if (f.status === 'vendu') {
    // L'acheteur d'abord : un dossier dont la vente n'est pas encaissée n'est jamais « clôturé ».
    if ((f.buyerDue ?? 0) > CENT) return 'vendue';
    if (f.payoutAt || (f.soldReversal ?? 0) <= 0) return 'cloture';
    return 'reversement';
  }
  return f.cessionsToValidate > 0 ? 'frais' : 'vente';
}

export type DepotStepState = 'done' | 'todo' | 'warning';
export type DepotStep = { key: DepotStepKey; state: DepotStepState; current: boolean };

function stepState(key: DepotStepKey, f: DepotFacts, current: DepotStepKey): DepotStepState {
  const sold = f.status === 'vendu';
  const gone = f.status === 'restitue';
  switch (key) {
    case 'entree': return 'done';
    case 'frais':
      return f.cessionsToValidate > 0 || f.cessionsMissed > 0 ? 'warning' : 'done';
    case 'vente': return sold ? 'done' : 'todo';
    case 'vendue': return sold ? ((f.buyerDue ?? 0) > CENT ? 'warning' : 'done') : 'todo';
    case 'reversement':
      if (!sold) return 'todo';
      return f.payoutAt || (f.soldReversal ?? 0) <= 0 ? 'done' : 'todo';
    case 'retour': return gone ? ((f.returnDue ?? 0) > CENT ? 'warning' : 'done') : 'todo';
    case 'cloture': return current === 'cloture' ? 'done' : 'todo';
  }
}

/** Le fil à afficher : parcours de vente, ou parcours de retour une fois la moto rendue. */
export function depotSteps(f: DepotFacts): DepotStep[] {
  const current = depotCurrentStep(f);
  const path = f.status === 'restitue' ? DEPOT_RETURN_PATH : DEPOT_MAIN_PATH;
  return path.map((key) => ({ key, state: stepState(key, f, current), current: key === current }));
}

/** La branche « Retour au propriétaire » reste proposée tant que la moto est en dépôt. */
export const canReturnToOwner = (status: ConsignmentStatus): boolean => status === 'en_depot';

export type DepotWarning = 'cessionOpenBeforeSale' | 'cessionNotDeducted' | 'buyerUnpaid';

/** Alertes à montrer sur la fiche : elles préviennent, elles n'empêchent aucune action. */
export function depotWarnings(f: DepotFacts): DepotWarning[] {
  const out: DepotWarning[] = [];
  if (f.status === 'en_depot' && f.cessionsToValidate > 0) out.push('cessionOpenBeforeSale');
  if (f.status === 'vendu' && !f.payoutAt) {
    if (f.cessionsToValidate + f.cessionsMissed > 0) out.push('cessionNotDeducted');
    if ((f.buyerDue ?? 0) > CENT) out.push('buyerUnpaid');
  }
  return out;
}

export type DepotCessionRow = {
  id: string; number: string | null; status: string; validated_at: string | null;
  lines: { kind: string; line_cost: number | null; line_sale_ht: number | null }[];
};
export type DepotCessionSummary = {
  toValidate: DepotCessionRow[];
  missed: DepotCessionRow[];
  emptyOpen: DepotCessionRow[];
  /** Estimation TTC des cessions non validées, sur la même base que les frais du dépôt (coût ou vente). */
  pendingTtc: number;
};

/** Classe les cessions du dépôt. Une ligne de texte n'est pas un frais ; une cession annulée ne compte plus. */
export function summarizeDepotCessions(rows: DepotCessionRow[], basis: 'cout' | 'vente', vatRate: number): DepotCessionSummary {
  const priced = (c: DepotCessionRow) => c.lines.filter((l) => l.kind !== 'texte');
  const toValidate = rows.filter((c) => c.status === 'ouvert' && priced(c).length > 0);
  const missed = rows.filter((c) => c.status === 'archive' && !c.validated_at && priced(c).length > 0);
  const emptyOpen = rows.filter((c) => c.status === 'ouvert' && priced(c).length === 0);
  const ht = [...toValidate, ...missed].flatMap(priced)
    .reduce((s, l) => s + Number((basis === 'vente' ? l.line_sale_ht : l.line_cost) ?? 0), 0);
  return { toValidate, missed, emptyOpen, pendingTtc: r2(ht * (100 + (vatRate || 0)) / 100) };
}

export type ReturnFees = {
  depositFee: number; validatedTtc: number; pendingTtc: number; uninvoicedRepairs: number;
  engaged: number; billed: number; notBilled: number;
};

/**
 * Frais engagés sur une moto rendue au propriétaire. Affichage seulement : la règle de facturation du
 * retour n'est pas décidée (question au client), le montant facturé reste saisi à la main.
 */
export function returnFeesSummary(p: {
  depositFee?: number | null; validatedTtc?: number | null; pendingTtc?: number | null;
  uninvoicedRepairs?: number | null; billed?: number | null;
}): ReturnFees {
  const depositFee = r2(Number(p.depositFee ?? 0));
  const validatedTtc = r2(Number(p.validatedTtc ?? 0));
  const pendingTtc = r2(Number(p.pendingTtc ?? 0));
  const uninvoicedRepairs = r2(Number(p.uninvoicedRepairs ?? 0));
  const billed = r2(Number(p.billed ?? 0));
  const engaged = r2(depositFee + validatedTtc + pendingTtc + uninvoicedRepairs);
  return { depositFee, validatedTtc, pendingTtc, uninvoicedRepairs, engaged, billed, notBilled: r2(Math.max(engaged - billed, 0)) };
}

/** Reste dû sur un document (jamais négatif). */
export const docDue = (d: { total_ttc: number; paid_amount: number } | null | undefined): number | null =>
  d ? r2(Math.max(Number(d.total_ttc) - Number(d.paid_amount), 0)) : null;
