/**
 * M6 (POS) — Regles pures de la caisse (audit du 03/11/2026, PDV007 / PDV008) :
 * especes theoriques du tiroir et ecart de cloture. Le journal Z (`cash_z_report`) additionne
 * tous les mouvements de fond de caisse quel que soit le mode ; le tiroir, lui, ne contient que
 * les especes : on ne retient donc que les mouvements en mode `ESP`.
 * Testees dans tests/caisse-cloture.test.ts.
 */
import { CASH_METHOD } from './cash-rounding';

export type ZLike = { payments_by_method: { method: string; total: number }[] } | null | undefined;
export type MovementLike = { kind: string; method: string; amount: number | string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Entrees et sorties d especes (mouvements de fond de caisse en mode ESP). */
export function cashMovements(movements: MovementLike[]): { cashIn: number; cashOut: number } {
  let cashIn = 0, cashOut = 0;
  for (const m of movements) {
    if (m.method !== CASH_METHOD) continue;
    if (m.kind === 'in') cashIn += Number(m.amount); else if (m.kind === 'out') cashOut += Number(m.amount);
  }
  return { cashIn: r2(cashIn), cashOut: r2(cashOut) };
}

/** Especes attendues dans le tiroir = fond d ouverture + reglements ESP percus + entrees − sorties ESP. */
export function expectedCash(openingFloat: number, z: ZLike, movements: MovementLike[]): number {
  const esp = z?.payments_by_method.find((p) => p.method === CASH_METHOD)?.total ?? 0;
  const { cashIn, cashOut } = cashMovements(movements);
  return r2(Number(openingFloat) + Number(esp) + cashIn - cashOut);
}

/** Ecart de cloture = compte − theorique (positif : trop d argent, negatif : il manque). */
export const cashVariance = (counted: number, expected: number): number => r2(counted - expected);

/* ------------------------------------------------------------------------------------------------
 * Caisse conforme au droit belge (PDV010, 03/11/2026) : plafond des especes, contre-passation,
 * motif d ecart. Memes regles qu en base (migration 20261103170000). Testees dans
 * tests/caisse-legale.test.ts.
 * ---------------------------------------------------------------------------------------------- */

/** Plafond legal des especes par vente (loi du 18/09/2017, art. 67). */
export const CASH_LIMIT_EUR = 3000;

export type CashLimitLine = { method: string; amount: number; status?: string | null };

/**
 * Especes percues sur le document (deja enregistrees + nouvelles lignes) ; au-dela de 3 000 EUR,
 * l encaissement est refuse. Les contre-passations (negatives) comptent en moins.
 */
export function cashTotal(existing: CashLimitLine[], drafts: CashLimitLine[]): number {
  const sum = [...existing, ...drafts]
    .filter((l) => l.method === CASH_METHOD && (l.status ?? 'recu') === 'recu')
    .reduce((s, l) => s + Number(l.amount), 0);
  return r2(sum);
}
export const cashLimitExceeded = (existing: CashLimitLine[], drafts: CashLimitLine[]): boolean => cashTotal(existing, drafts) > CASH_LIMIT_EUR;

export type ReversalLine = { method: string; amount: number; status: 'recu'; note: string; reversalOf: string };

/** Ligne de contre-passation d un reglement percu : meme mode, montant inverse, motif obligatoire. */
export function reversalLine(payment: { id: string; method: string; amount: number | string; status?: string | null }, reason: string): ReversalLine {
  if ((payment.status ?? 'recu') !== 'recu') throw new Error('notReceived');
  const motif = reason.trim();
  if (!motif) throw new Error('needReason');
  return { method: payment.method, amount: r2(-Number(payment.amount)), status: 'recu', note: motif, reversalOf: payment.id };
}

/** Reglements deja contre-passes (id du reglement d origine → id de la contre-passation). */
export function reversedIds(payments: { id: string; reversal_of?: string | null }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of payments) if (p.reversal_of) m.set(p.reversal_of, p.id);
  return m;
}

/** Un ecart de caisse (compte ≠ theorique) exige un motif avant la cloture. */
export const varianceReasonMissing = (variance: number, reason: string): boolean => Math.abs(variance) > 0.004 && reason.trim() === '';
