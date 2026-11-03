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
