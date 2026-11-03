/**
 * Tests M6 (POS) — arrondi legal des especes a 5 cents (Belgique, 1er decembre 2019), audit caisse
 * du 03/11/2026 (PDV000, PDV009) :
 *  - regle d arrondi (1-2 → 0, 3-4 → 5, 6-7 → 5, 8-9 → 10), symetrique pour un remboursement ;
 *  - seules les especes percues sont arrondies (pas la carte, pas un reglement a echeance) ;
 *  - l ecart est porte par une ligne « ARR » : la somme des reglements reste egale au du ;
 *  - rendu de monnaie calcule sur les especes arrondies.
 */
import { test, expect, describe } from 'bun:test';
import {
  roundToFiveCents, cashRounding, applyCashRounding, changeDue, CASH_ROUNDING_METHOD, CASH_ROUNDING_NOTE,
} from '../src/modules/sales/cash-rounding';

describe('roundToFiveCents', () => {
  test('les cents 1 et 2 descendent a 0, 3 et 4 montent a 5', () => {
    expect(roundToFiveCents(10.01)).toBe(10);
    expect(roundToFiveCents(10.02)).toBe(10);
    expect(roundToFiveCents(10.03)).toBe(10.05);
    expect(roundToFiveCents(10.04)).toBe(10.05);
  });
  test('les cents 6 et 7 descendent a 5, 8 et 9 montent a 10', () => {
    expect(roundToFiveCents(10.06)).toBe(10.05);
    expect(roundToFiveCents(10.07)).toBe(10.05);
    expect(roundToFiveCents(10.08)).toBe(10.1);
    expect(roundToFiveCents(10.09)).toBe(10.1);
  });
  test('un multiple de 5 cents ne bouge pas, 0 reste 0', () => {
    expect(roundToFiveCents(10)).toBe(10);
    expect(roundToFiveCents(10.05)).toBe(10.05);
    expect(roundToFiveCents(0)).toBe(0);
  });
  test('un remboursement en especes s arrondit de la meme facon (symetrie)', () => {
    expect(roundToFiveCents(-10.02)).toBe(-10);
    expect(roundToFiveCents(-10.03)).toBe(-10.05);
    expect(roundToFiveCents(-10.08)).toBe(-10.1);
  });
  test('pas de derive flottante : 0,1 + 0,2 = 0,30', () => {
    expect(roundToFiveCents(0.1 + 0.2)).toBe(0.3);
  });
});

describe('cashRounding — seules les especes percues comptent', () => {
  test('ticket de 10,02 EUR paye en especes : especes arrondies 10,00, ecart −0,02', () => {
    const r = cashRounding([{ method: 'ESP', amount: 10.02 }]);
    expect(r).toEqual({ cash: 10.02, roundedCash: 10, delta: -0.02 });
  });
  test('carte : aucun arrondi', () => {
    expect(cashRounding([{ method: 'MAE', amount: 10.02 }]).delta).toBe(0);
  });
  test('especes a echeance (attendu) : aucun arrondi', () => {
    expect(cashRounding([{ method: 'ESP', amount: 10.02, status: 'attendu' }]).delta).toBe(0);
  });
  test('mixte : 50 EUR carte + 7,23 EUR especes → especes 7,25, ecart +0,02', () => {
    const r = cashRounding([{ method: 'MAE', amount: 50 }, { method: 'ESP', amount: 7.23 }]);
    expect(r.cash).toBe(7.23);
    expect(r.roundedCash).toBe(7.25);
    expect(r.delta).toBe(0.02);
  });
  test('deux lignes especes : l arrondi porte sur leur total', () => {
    const r = cashRounding([{ method: 'ESP', amount: 5.01 }, { method: 'ESP', amount: 5.01 }]);
    expect(r.cash).toBe(10.02);
    expect(r.roundedCash).toBe(10);
  });
});

describe('applyCashRounding — la somme des reglements reste egale au du', () => {
  test('10,02 en especes → ESP 10,00 + ARR +0,02 (note en francais)', () => {
    const out = applyCashRounding([{ method: 'ESP', amount: 10.02, status: 'recu' as const }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ method: 'ESP', amount: 10 });
    expect(out[1]).toMatchObject({ method: CASH_ROUNDING_METHOD, amount: 0.02, status: 'recu', note: CASH_ROUNDING_NOTE });
    expect(out.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(10.02, 2);
  });
  test('7,23 en especes → ESP 7,25 + ARR −0,02', () => {
    const out = applyCashRounding([{ method: 'ESP', amount: 7.23, status: 'recu' as const }]);
    expect(out[0]).toMatchObject({ method: 'ESP', amount: 7.25 });
    expect(out[1]).toMatchObject({ method: 'ARR', amount: -0.02 });
  });
  test('sans especes ou deja sur 5 cents : lignes rendues telles quelles', () => {
    const card = [{ method: 'VID', amount: 10.02, status: 'recu' as const }];
    expect(applyCashRounding(card)).toBe(card);
    const exact = [{ method: 'ESP', amount: 10.05, status: 'recu' as const }];
    expect(applyCashRounding(exact)).toBe(exact);
  });
  test('c est la derniere ligne especes qui est ajustee, les autres lignes gardent leur montant', () => {
    const out = applyCashRounding([
      { method: 'ESP', amount: 5, status: 'recu' as const }, { method: 'MAE', amount: 20, status: 'recu' as const },
      { method: 'ESP', amount: 5.03, status: 'recu' as const },
    ]);
    expect(out.map((l) => [l.method, l.amount])).toEqual([['ESP', 5], ['MAE', 20], ['ESP', 5.05], ['ARR', -0.02]]);
  });
  test('remboursement en especes (avoir) : −10,02 → ESP −10,00 + ARR −0,02', () => {
    const out = applyCashRounding([{ method: 'ESP', amount: -10.02, status: 'recu' as const }]);
    expect(out[0]).toMatchObject({ method: 'ESP', amount: -10 });
    expect(out[1]).toMatchObject({ method: 'ARR', amount: -0.02 });
    expect(out.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(-10.02, 2);
  });
});

describe('changeDue — rendu de monnaie sur les especes arrondies', () => {
  test('20 EUR remis pour 10,02 EUR dus (arrondis 10,00) → 10,00 a rendre', () => {
    expect(changeDue(20, 10)).toBe(10);
  });
  test('rien a rendre si le client ne donne pas plus', () => {
    expect(changeDue(10, 10)).toBe(0);
    expect(changeDue(0, 10)).toBe(0);
  });
});
