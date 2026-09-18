/**
 * Tests M6 — types de ligne (mission 05, carte 5) : main-d'œuvre en heures décimales,
 * lignes texte et vides sans montant, dans les totaux et les mouvements de stock.
 */
import { test, expect } from 'bun:test';
import { computeTotals, lineHasAmount, lineMovesStock, rowToLineInput, type LineInput, type DocumentLine } from '../src/modules/sales/write-api';

const line = (p: Partial<LineInput> = {}): LineInput => ({
  designation: 'x', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, ...p,
});

test('proforma moto + options + main-d\'œuvre 5,5 h + ligne vide + commentaire', () => {
  const r = computeTotals([
    line({ designation: 'Scrambler Icon Dark', unit_price_ht: 8256.2 }),
    line({ designation: 'Poignées chauffantes', quantity: 2, unit_price_ht: 50 }),
    line({ designation: 'MO ATELIER VIP1', line_type: 'main_oeuvre', quantity: 5.5, unit_price_ht: 80 }),
    line({ designation: '', line_type: 'vide', quantity: 0, unit_price_ht: 0 }),
    line({ designation: 'PREMIER ENTRETIEN\nOFFERT', line_type: 'texte', quantity: 0, unit_price_ht: 0 }),
  ]);
  // 8256,20 + 100 + 440 = 8796,20 HT
  expect(r.total_ht).toBe(8796.2);
  expect(r.total_vat).toBe(1847.2);
  expect(r.total_ttc).toBe(10643.4);
});

test('main-d\'œuvre : quantité décimale en heures', () => {
  const r = computeTotals([line({ line_type: 'main_oeuvre', quantity: 1.25, unit_price_ht: 80 })]);
  expect(r.total_ht).toBe(100);
  expect(r.total_ttc).toBe(121);
});

test('une ligne texte ou vide ne compte jamais, même si un montant traîne dessus', () => {
  const r = computeTotals([
    line({ line_type: 'texte', quantity: 3, unit_price_ht: 999 }),
    line({ line_type: 'vide', quantity: 1, unit_price_ht: 50 }),
  ]);
  expect(r.total_ht).toBe(0);
  expect(r.total_vat).toBe(0);
  expect(r.total_ttc).toBe(0);
});

test('la remise globale ne porte que sur les lignes à montant', () => {
  const r = computeTotals([
    line({ unit_price_ht: 100 }),
    line({ line_type: 'main_oeuvre', quantity: 2, unit_price_ht: 50 }),
    line({ line_type: 'texte', quantity: 0, unit_price_ht: 0 }),
  ], { globalDiscountPct: 10 });
  expect(r.lines_ht).toBe(200);
  expect(r.global_discount).toBe(20);
  expect(r.total_ht).toBe(180);
});

test('seules les lignes article bougent le stock (pas la main-d\'œuvre, ni texte, ni vide)', () => {
  expect(lineMovesStock({ article_id: 'a', quantity: 1 })).toBe(true);
  expect(lineMovesStock({ article_id: 'a', quantity: 1, line_type: 'article' })).toBe(true);
  expect(lineMovesStock({ article_id: 't', quantity: 5.5, line_type: 'main_oeuvre' })).toBe(false);
  expect(lineMovesStock({ article_id: null, quantity: 1, line_type: 'article' })).toBe(false);
  expect(lineMovesStock({ article_id: 'a', quantity: 0 })).toBe(false);
  expect(lineHasAmount({ line_type: 'texte' })).toBe(false);
  expect(lineHasAmount({ line_type: 'vide' })).toBe(false);
  expect(lineHasAmount({})).toBe(true);
});

const row = (p: Partial<DocumentLine>): DocumentLine => ({
  id: 'l', document_id: 'd', article_id: null, designation: 'x', quantity: 1, unit_price_ht: 10, vat_rate: 21,
  discount_pct: 0, line_ht: 10, line_ttc: 12.1, sort_order: 0, created_at: '', reference: null, line_type: 'article', ...p,
} as DocumentLine);

test('conversion et avoir recopient le type de ligne ; avoir en négatif sauf texte / vide', () => {
  expect(rowToLineInput(row({ line_type: 'main_oeuvre', quantity: 5.5 }))).toMatchObject({ line_type: 'main_oeuvre', quantity: 5.5 });
  expect(rowToLineInput(row({ line_type: 'main_oeuvre', quantity: 5.5 }), -1).quantity).toBe(-5.5);
  expect(rowToLineInput(row({ line_type: 'texte', designation: 'A\nB', quantity: 0, unit_price_ht: 0 }), -1)).toMatchObject({ line_type: 'texte', designation: 'A\nB', quantity: 0 });
  expect(rowToLineInput(row({ line_type: 'inconnu' })).line_type).toBe('article');
});
