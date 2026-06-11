/**
 * Tests M6 — Pied de facture (règle 7 : remise globale, TVA, détaxe, port, net forcé).
 * Miroir de la logique G8 (Facturation p.54, p.66-67) implémentée dans computeTotals.
 */
import { test, expect } from 'bun:test';
import { computeTotals, type LineInput } from '../src/modules/sales/write-api';

const line = (p: Partial<LineInput> = {}): LineInput => ({
  designation: 'x', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, ...p,
});

test('totaux simples — TVA 21%', () => {
  const r = computeTotals([line()]);
  expect(r.total_ht).toBe(100);
  expect(r.total_vat).toBe(21);
  expect(r.total_ttc).toBe(121);
});

test('remise globale en % réduit HT et TVA au prorata', () => {
  const r = computeTotals([line()], { globalDiscountPct: 10 });
  expect(r.global_discount).toBe(10);
  expect(r.total_ht).toBe(90);
  expect(r.total_vat).toBe(18.9); // 21 * 0.9
  expect(r.total_ttc).toBe(108.9);
});

test('remise globale en montant (plafonnée au HT des lignes)', () => {
  const r = computeTotals([line()], { globalDiscountAmount: 30 });
  expect(r.total_ht).toBe(70);
  expect(r.total_vat).toBe(14.7);
});

test('détaxe (export) inhibe la TVA', () => {
  const r = computeTotals([line()], { taxExempt: true });
  expect(r.total_ht).toBe(100);
  expect(r.total_vat).toBe(0);
  expect(r.total_ttc).toBe(100);
});

test('port taxé ajoute HT + TVA du port (hors remise)', () => {
  const r = computeTotals([line()], { shippingHt: 10, shippingTaxed: true, shippingVatRate: 21 });
  expect(r.total_ht).toBe(110);
  expect(r.shipping_vat).toBe(2.1);
  expect(r.total_vat).toBe(23.1);
  expect(r.total_ttc).toBe(133.1);
});

test('port non taxé : aucun TVA sur le port', () => {
  const r = computeTotals([line()], { shippingHt: 10, shippingTaxed: false });
  expect(r.total_ht).toBe(110);
  expect(r.total_vat).toBe(21);
  expect(r.total_ttc).toBe(131);
});

test('remise globale n\'affecte pas le port', () => {
  const r = computeTotals([line()], { globalDiscountPct: 10, shippingHt: 10, shippingTaxed: false });
  expect(r.total_ht).toBe(100); // 90 (lignes) + 10 (port)
  expect(r.total_vat).toBe(18.9);
});

test('net TTC forcé écrase le TTC et recalcule la TVA', () => {
  const r = computeTotals([line()], { forcedTtc: 120 });
  expect(r.total_ttc).toBe(120);
  expect(r.total_ht).toBe(100);
  expect(r.total_vat).toBe(20);
});
