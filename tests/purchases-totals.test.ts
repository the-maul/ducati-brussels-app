/**
 * Tests M4 — Totaux d'achat (régimes TVA, port, remise globale, 3 décimales).
 */
import { test, expect } from 'bun:test';
import { computePurchaseTotals, type PurchaseLineInput } from '../src/modules/purchases/write-api';

const line = (p: Partial<PurchaseLineInput> = {}): PurchaseLineInput => ({
  designation: 'x', quantity: 1, unit_price_ht: 100, discount_pct: 0, vat_rate: 21, ...p,
});

test('achat avec TVA', () => {
  const r = computePurchaseTotals([line()], { vatRegime: 'with_vat' });
  expect(r.total_ht).toBe(100);
  expect(r.total_vat).toBe(21);
  expect(r.total_ttc).toBe(121);
});

test('achat CEE sans TVA', () => {
  const r = computePurchaseTotals([line()], { vatRegime: 'cee' });
  expect(r.total_vat).toBe(0);
  expect(r.total_ttc).toBe(100);
});

test('remise globale réduit le HT', () => {
  const r = computePurchaseTotals([line()], { vatRegime: 'with_vat', globalDiscountPct: 10 });
  expect(r.total_ht).toBe(90);
  expect(r.total_vat).toBe(18.9);
});

test('port taxé ajoute HT + TVA', () => {
  const r = computePurchaseTotals([line()], { vatRegime: 'with_vat', shippingHt: 10, shippingTaxed: true });
  expect(r.total_ht).toBe(110);
  expect(r.total_vat).toBe(23.1);
});
