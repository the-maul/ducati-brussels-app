/**
 * Tests B5 — PAMP (Prix d'Achat Moyen Pondéré). Règle 7.
 * Vérifie la formule de moyenne pondérée appliquée à chaque entrée valorisée
 * (miroir de la fonction DB `record_stock_move`).
 */
import { test, expect } from 'bun:test';
import { computePamp } from '../src/modules/stock/api';

test('PAMP — première entrée part du prix d\'achat', () => {
  expect(computePamp(0, 0, 100, 5)).toBe(100);
});

test('PAMP — moyenne pondérée de deux entrées', () => {
  // 5 @ 100 puis 5 @ 120 → (500 + 600) / 10 = 110
  expect(computePamp(100, 5, 120, 5)).toBe(110);
});

test('PAMP — pondération asymétrique', () => {
  // 10 @ 100 puis 2 @ 130 → (1000 + 260) / 12 = 105
  expect(computePamp(100, 10, 130, 2)).toBe(105);
});

test('PAMP — stock épuisé (≤0) repart du nouveau PA', () => {
  expect(computePamp(100, 0, 90, 3)).toBe(90);
  expect(computePamp(100, -2, 90, 3)).toBe(90);
});

test('PAMP — arrondi à 3 décimales', () => {
  // 1 @ 10 puis 2 @ 11.005 → (10 + 22.01)/3 = 10.67
  expect(computePamp(10, 1, 11.005, 2)).toBe(10.67);
});
