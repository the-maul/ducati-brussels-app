/**
 * Tests M6 (POS) — cloture de caisse, audit du 03/11/2026 (PDV007, PDV008) :
 *  - especes theoriques du tiroir = fond + reglements ESP + entrees − sorties en especes ;
 *  - un mouvement saisi en carte ou en virement ne touche pas au tiroir ;
 *  - ecart de cloture = compte − theorique, arrondi au cent.
 */
import { test, expect, describe } from 'bun:test';
import { cashMovements, expectedCash, cashVariance } from '../src/modules/sales/cash-rules';

const z = { payments_by_method: [{ method: 'ESP', total: 130.5 }, { method: 'MAE', total: 400 }, { method: 'ARR', total: -0.02 }] };

describe('cashMovements — seuls les mouvements en especes', () => {
  test('entrees et sorties ESP additionnees, les autres modes ignores', () => {
    const r = cashMovements([
      { kind: 'in', method: 'ESP', amount: 20 }, { kind: 'out', method: 'ESP', amount: '12.5' },
      { kind: 'out', method: 'VIR', amount: 500 }, { kind: 'in', method: 'MAE', amount: 9 },
    ]);
    expect(r).toEqual({ cashIn: 20, cashOut: 12.5 });
  });
});

describe('expectedCash — especes theoriques du tiroir', () => {
  test('fond 250 + ESP 130,50 + entree 20 − sortie 12,50 = 388,00 (la carte ne compte pas)', () => {
    expect(expectedCash(250, z, [{ kind: 'in', method: 'ESP', amount: 20 }, { kind: 'out', method: 'ESP', amount: 12.5 }, { kind: 'out', method: 'VIR', amount: 500 }])).toBe(388);
  });
  test('sans journal ni mouvement : le fond seul', () => {
    expect(expectedCash(250, null, [])).toBe(250);
    expect(expectedCash(250, { payments_by_method: [] }, [])).toBe(250);
  });
  test('un depot en banque (sortie ESP) vide le tiroir', () => {
    expect(expectedCash(250, z, [{ kind: 'out', method: 'ESP', amount: 380.5 }])).toBe(0);
  });
});

describe('cashVariance — ecart de cloture', () => {
  test('compte 390 pour 388 theorique → +2 ; 380 → −8 ; egal → 0', () => {
    expect(cashVariance(390, 388)).toBe(2);
    expect(cashVariance(380, 388)).toBe(-8);
    expect(cashVariance(388, 388)).toBe(0);
  });
  test('arrondi au cent (pas de 0,1 + 0,2)', () => {
    expect(cashVariance(0.3, 0.1)).toBe(0.2);
  });
});
