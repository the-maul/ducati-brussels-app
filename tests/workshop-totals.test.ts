/**
 * Tests M8 — Totaux d'OR : une ligne en garantie est valorisée à 0 (B10).
 */
import { test, expect } from 'bun:test';
import { computeRoTotals, type RoLineInput } from '../src/modules/workshop/write-api';

const line = (p: Partial<RoLineInput> = {}): RoLineInput => ({
  kind: 'piece', designation: 'x', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, is_warranty: false, ...p,
});

test('OR standard', () => {
  const r = computeRoTotals([line(), line({ kind: 'mo', unit_price_ht: 50 })]);
  expect(r.total_ht).toBe(150);
  expect(r.total_vat).toBe(31.5);
});

test('ligne en garantie = 0 (B10)', () => {
  const r = computeRoTotals([line({ is_warranty: true }), line({ unit_price_ht: 80 })]);
  expect(r.total_ht).toBe(80); // la pièce garantie ne compte pas
});
