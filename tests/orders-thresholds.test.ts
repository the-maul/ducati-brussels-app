/**
 * Tests des règles de commande de pièces (Miro 2026-07-30) — CLAUDE.md règle 7.
 * Seuils 250/1500/2000, surcharge urgente +10 %, calculs Excel par onglet.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  surchargeForKind, resolveKind, clientLinePrice,
  excelLineValue, excelLineFinal, excelTabTotal, excelTabReached, excelTabRemaining, excelTabsStatus,
  type ExcelLine,
} from '../src/modules/orders/thresholds';

test('surcharge : urgente = +10 %, les autres 0 %', () => {
  expect(surchargeForKind('urgente')).toBe(10);
  expect(surchargeForKind('standard')).toBe(0);
  expect(surchargeForKind('excel')).toBe(0);
  expect(surchargeForKind('accident')).toBe(0);
});

test('standard : seuil 250 € HTVA', () => {
  expect(resolveKind('standard', 249.99)).toEqual({ effectiveKind: 'standard', thresholdMet: false });
  expect(resolveKind('standard', 250)).toEqual({ effectiveKind: 'standard', thresholdMet: true });
});

test('accident : ≥1500 € reste accident, sinon repasse standard', () => {
  expect(resolveKind('accident', 1500)).toEqual({ effectiveKind: 'accident', thresholdMet: true });
  const under = resolveKind('accident', 800);
  expect(under.effectiveKind).toBe('standard');
  expect(under.thresholdMet).toBe(true); // 800 ≥ 250
  const tiny = resolveKind('accident', 100);
  expect(tiny.effectiveKind).toBe('standard');
  expect(tiny.thresholdMet).toBe(false); // 100 < 250
});

test('urgente : pas de minima bloquant', () => {
  expect(resolveKind('urgente', 0)).toEqual({ effectiveKind: 'urgente', thresholdMet: true });
});

test('prix client ligne : urgente applique +10 %', () => {
  expect(clientLinePrice(100, 2, 'urgente')).toBe(220); // 200 + 10 %
  expect(clientLinePrice(100, 2, 'standard')).toBe(200);
});

// ---- Commande Excel (formules du classeur Ducati) ----

test('Excel : valeur ligne = prix dealer × qté (col M)', () => {
  expect(excelLineValue({ priceDealer: 810.4, qty: 2 })).toBe(1620.8);
});

test('Excel : prix final = M − (M × extra) (col O)', () => {
  // 485.95 × 1 = 485.95, extra 18 % → 398.479 → arrondi 398.48
  expect(excelLineFinal({ tab: 'demo', priceDealer: 485.95, qty: 1, extraDiscount: 0.18 })).toBe(398.48);
});

const lines: ExcelLine[] = [
  { tab: 'demo', priceDealer: 810.4, qty: 2, extraDiscount: 0.18 },   // final 1329.06
  { tab: 'demo', priceDealer: 485.95, qty: 1, extraDiscount: 0.18 },  // final 398.48
  { tab: 'courtoisie', priceDealer: 100, qty: 5, extraDiscount: 0 },  // final 500
  { tab: 'showroom', priceDealer: 44.7, qty: 1, extraDiscount: 0.18 }, // final 36.65
];

test('Excel : total onglet = Σ prix finaux', () => {
  expect(excelTabTotal(lines, 'demo')).toBe(1727.54);
  expect(excelTabTotal(lines, 'courtoisie')).toBe(500);
});

test('Excel : seuil 2000 €/onglet (atteint / reste)', () => {
  expect(excelTabReached(lines, 'demo')).toBe(false);
  expect(excelTabRemaining(lines, 'demo')).toBe(272.46); // 2000 - 1727.54
  const big: ExcelLine[] = [{ tab: 'demo', priceDealer: 1000, qty: 3, extraDiscount: 0 }]; // 3000
  expect(excelTabReached(big, 'demo')).toBe(true);
  expect(excelTabRemaining(big, 'demo')).toBe(0);
});

test('Excel : statut par onglet (3 onglets)', () => {
  const s = excelTabsStatus(lines);
  expect(Object.keys(s).sort()).toEqual(['courtoisie', 'demo', 'showroom']);
  expect(s.demo.reached).toBe(false);
  expect(s.courtoisie.total).toBe(500);
});
