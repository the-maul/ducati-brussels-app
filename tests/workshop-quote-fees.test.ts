/**
 * Tests des frais de devis atelier (mission 02, §1.4) — CLAUDE.md règle 7.
 * Accident = 125 € HTVA fixe ; diagnostic = tarif horaire × heures, plafond 4 h.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  DEFAULT_QUOTE_FEES, resolveQuoteFeeParams, clampDiagnosticHours, buildQuoteFeeLine,
  quoteFeeAmountHt, quoteFeeDesignation, applyQuoteFee, type QuoteFeeKind,
} from '../src/modules/workshop/quote-fees';

const P = { ...DEFAULT_QUOTE_FEES, hourlyRateHt: 80 };

test('accident : 125 € HTVA fixe, quantité 1', () => {
  const l = buildQuoteFeeLine('accident', P);
  expect(l.quantity).toBe(1);
  expect(l.unit_price_ht).toBe(125);
  expect(l.designation).toBe('Frais de devis accident');
  expect(quoteFeeAmountHt('accident', P)).toBe(125);
  // les heures n'influencent pas l'accident
  expect(quoteFeeAmountHt('accident', P, 10)).toBe(125);
});

test('diagnostic : plafonné à 4 h, modifiable vers le bas seulement', () => {
  expect(clampDiagnosticHours(6, 4)).toBe(4);
  expect(clampDiagnosticHours(4, 4)).toBe(4);
  expect(clampDiagnosticHours(2.5, 4)).toBe(2.5);
  expect(clampDiagnosticHours(-1, 4)).toBe(0);
  expect(clampDiagnosticHours(Number.NaN, 4)).toBe(0);
  expect(quoteFeeAmountHt('diagnostic', P)).toBe(320);       // défaut = plafond : 4 h × 80
  expect(quoteFeeAmountHt('diagnostic', P, 10)).toBe(320);   // 10 h demandées → 4 h
  expect(quoteFeeAmountHt('diagnostic', P, 1.5)).toBe(120);
  expect(buildQuoteFeeLine('diagnostic', P, 1.5).designation).toBe('Diagnostic (1,5 h)');
  expect(quoteFeeDesignation('diagnostic', 4)).toBe('Diagnostic (4 h)');
});

test('paramètres : valeurs de la société, repli sur les défauts et sur l’article MO', () => {
  const rows = [
    { code: 'accident', is_active: true, extra: { amount_ht: 150 } },
    { code: 'diagnostic', is_active: true, extra: { hourly_rate_ht: 0, max_hours: 3 } },
  ];
  const p = resolveQuoteFeeParams(rows, 75);
  expect(p.accidentAmountHt).toBe(150);
  expect(p.diagnosticMaxHours).toBe(3);
  expect(p.hourlyRateHt).toBe(75);               // 0 → prix de l'article MO
  expect(resolveQuoteFeeParams([{ code: 'diagnostic', extra: { hourly_rate_ht: 90 } }], 75).hourlyRateHt).toBe(90);
  const d = resolveQuoteFeeParams([], null);
  expect(d.accidentAmountHt).toBe(125);
  expect(d.diagnosticMaxHours).toBe(4);
  expect(d.hourlyRateHt).toBe(0);
  // une ligne désactivée est ignorée
  expect(resolveQuoteFeeParams([{ code: 'accident', is_active: false, extra: { amount_ht: 999 } }]).accidentAmountHt).toBe(125);
});

test('pas de doublon : cliquer deux fois remplace la ligne de frais', () => {
  type L = ReturnType<typeof buildQuoteFeeLine> & { _fee?: QuoteFeeKind | null };
  const piece: L = { article_id: 'a1', designation: 'Levier de frein', quantity: 1, unit_price_ht: 40, vat_rate: 21, discount_pct: 0 };
  const blank: L = { article_id: null, designation: '', quantity: 1, unit_price_ht: 0, vat_rate: 21, discount_pct: 0 };
  let lines: L[] = [piece, blank];
  lines = applyQuoteFee(lines, { ...buildQuoteFeeLine('diagnostic', P), _fee: 'diagnostic' });
  lines = applyQuoteFee(lines, { ...buildQuoteFeeLine('diagnostic', P, 2), _fee: 'diagnostic' });
  expect(lines.filter((l) => l._fee).length).toBe(1);
  expect(lines.length).toBe(2);
  lines = applyQuoteFee(lines, { ...buildQuoteFeeLine('accident', P), _fee: 'accident' });
  expect(lines.filter((l) => l._fee).map((l) => l._fee)).toEqual(['accident']);
  expect(lines[0].designation).toBe('Levier de frein');
});
