/**
 * M2 — Arrondi du prix de vente apres application du pourcentage.
 * Regle client du 19/10/2026 : « 6 % puis arrondi », et toujours vers le haut.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { roundUpPrice, applyPpcRules, applyPriceFloor, type PpcRule, type ImportRow } from '../src/modules/articles/import/rules';

describe('arrondi vers le haut', () => {
  test("a l'euro superieur", () => {
    expect(roundUpPrice(115.18, 'ceil_1')).toBe(116);
    expect(roundUpPrice(116, 'ceil_1')).toBe(116);     // deja rond : on ne monte pas
    expect(roundUpPrice(0.15, 'ceil_1')).toBe(1);
  });

  test('aux 10 et 50 centimes', () => {
    expect(roundUpPrice(12.31, 'ceil_0_1')).toBe(12.4);
    expect(roundUpPrice(12.3, 'ceil_0_1')).toBe(12.3);
    expect(roundUpPrice(12.31, 'ceil_0_5')).toBe(12.5);
    expect(roundUpPrice(12.5, 'ceil_0_5')).toBe(12.5);
  });

  test('aux 5 et 10 euros', () => {
    expect(roundUpPrice(116, 'ceil_5')).toBe(120);
    expect(roundUpPrice(120, 'ceil_5')).toBe(120);
    expect(roundUpPrice(101, 'ceil_10')).toBe(110);
  });

  test('prix psychologique en x,99', () => {
    expect(roundUpPrice(12, 'end_99')).toBe(12.99);
    expect(roundUpPrice(12.99, 'end_99')).toBe(12.99);
    expect(roundUpPrice(13.01, 'end_99')).toBe(13.99);
  });

  test('sans arrondi, ou sur un prix nul, rien ne bouge', () => {
    expect(roundUpPrice(115.18, 'none')).toBe(115.18);
    expect(roundUpPrice(115.18, null)).toBe(115.18);
    expect(roundUpPrice(0, 'ceil_1')).toBe(0);
  });

  test('pas de surprise de virgule flottante', () => {
    expect(roundUpPrice(1.15, 'ceil_0_5')).toBe(1.5);
    expect(roundUpPrice(0.3, 'ceil_0_1')).toBe(0.3);
  });
});

describe('la regle du client', () => {
  const PIECES: PpcRule = { supplier_name: 'DUCATI WEST EUROPE', category_path: null, brand: null, pct: 6, round_mode: 'ceil_1' };
  const ACCESSOIRES: PpcRule = { supplier_name: 'DUCATI WEST EUROPE', category_path: 'R12', brand: null, pct: 0, round_mode: 'ceil_1' };

  test('pieces detachees : 6 % puis arrondi a l euro superieur', () => {
    const rows: ImportRow[] = [{ reference: 'A', ppc_ttc: 100, supplier_name: 'DUCATI WEST EUROPE', rowIndex: 2 }];
    expect(applyPpcRules(rows, [PIECES])).toBe(1);
    expect(rows[0].sale_price_ttc).toBe(106);   // 100 -> 106,00 -> 106
  });

  test('un prix qui tombe mal monte bien d un euro', () => {
    const rows: ImportRow[] = [{ reference: 'A', ppc_ttc: 73.86, supplier_name: 'DUCATI WEST EUROPE', rowIndex: 2 }];
    applyPpcRules(rows, [PIECES]);
    expect(rows[0].sale_price_ttc).toBe(79);    // 73,86 +6 % = 78,29 -> 79
  });

  test('accessoires : pas de pourcentage, seulement l arrondi', () => {
    const rows: ImportRow[] = [{ reference: 'A', ppc_ttc: 115.18, supplier_name: 'DUCATI WEST EUROPE', category_path: 'R12', rowIndex: 2 }];
    applyPpcRules(rows, [PIECES, ACCESSOIRES]);
    expect(rows[0].sale_price_ttc).toBe(116);   // la regle la plus specifique gagne
  });

  test('sans regle, le prix de vente reste le prix conseille', () => {
    const rows: ImportRow[] = [{ reference: 'A', ppc_ttc: 115.18, rowIndex: 2 }];
    applyPpcRules(rows, []);
    expect(rows[0].sale_price_ttc).toBe(115.18);
  });
});

// Regle du client du 28/10/2026 : une piece sous 2 EUR se vend 2 EUR de plus,
// pas releve a 2 EUR — l'ecart entre deux petites pieces est conserve.
describe('plancher des petits prix', () => {
  // « en dessous de 2 EUR on monte a 2 + les centimes » (client, 28/10/2026).
  test('mode « on garde les centimes »', () => {
    expect(applyPriceFloor(0.25, 2, 2, 'cents')).toBe(2.25);
    expect(applyPriceFloor(1.74, 2, 2, 'cents')).toBe(2.74);   // et non 3,74
    expect(applyPriceFloor(0.99, 2, 2, 'cents')).toBe(2.99);
    expect(applyPriceFloor(1, 2, 2, 'cents')).toBe(2);         // pas de centime : on tombe sur 2,00
    expect(applyPriceFloor(2, 2, 2, 'cents')).toBe(2);         // au seuil, rien ne bouge
    expect(applyPriceFloor(12.5, 2, 2, 'cents')).toBe(12.5);
  });

  test('mode « on remonte » : comportement historique inchange', () => {
    expect(applyPriceFloor(0.25, 2, 2, 'min')).toBe(2);
    expect(applyPriceFloor(0.25, 2, 2)).toBe(2);            // defaut
  });

  test('sans seuil ou sans minimum, le prix est rendu tel quel', () => {
    expect(applyPriceFloor(0.25, 0, 2, 'cents')).toBe(0.25);
    expect(applyPriceFloor(0.25, 2, 0, 'cents')).toBe(0.25);
    expect(applyPriceFloor(0, 2, 2, 'cents')).toBe(0);
  });
});
