/**
 * Tests de la validation de reprise (M7, B2/B5) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  CHECKLIST_KEYS, emptyChecklist, needsAttestation, defaultVatRate,
  ttcToHt, htToTtc, belowMinimum, stockUnitCost, defaultClassification,
} from '../src/modules/tradein/validate-data';

test('checklist : 9 éléments, tous décochés par défaut', () => {
  expect(CHECKLIST_KEYS.length).toBe(9);
  const c = emptyChecklist();
  expect(Object.values(c).every((v) => v === false)).toBe(true);
});

test('attestation requise pour tout vendeur sans droit à déduction', () => {
  expect(needsAttestation('particulier')).toBe(true);
  expect(needsAttestation('morale_non_assujettie')).toBe(true);
  expect(needsAttestation('assujetti_44')).toBe(true);
  expect(needsAttestation('assujetti_56')).toBe(true);
  expect(needsAttestation('assujetti')).toBe(false);
});

test('taux de TVA par défaut : 0 % marge, 21 % assujetti', () => {
  expect(defaultVatRate('particulier')).toBe(0);
  expect(defaultVatRate('assujetti_44')).toBe(0);
  expect(defaultVatRate('assujetti')).toBe(21);
});

test('conversions TVAC ⇄ HTVA', () => {
  expect(ttcToHt(12100, 21)).toBe(10000);
  expect(htToTtc(10000, 21)).toBe(12100);
  expect(ttcToHt(9500, 0)).toBe(9500);   // TVA marge : TVAC = HTVA
  expect(htToTtc(9500, 0)).toBe(9500);
  expect(ttcToHt(999.99, 21)).toBe(826.44);
});

test('alerte prix minimum', () => {
  expect(belowMinimum(9000, 10000)).toBe(true);
  expect(belowMinimum(10000, 10000)).toBe(false);
  expect(belowMinimum(11000, 10000)).toBe(false);
  expect(belowMinimum(9000, 0)).toBe(false);  // pas de minimum fixé
  expect(belowMinimum(0, 10000)).toBe(false); // pas encore de prix de vente
});

test('coût de stock (B5) : TVAC en marge, HTVA en assujetti', () => {
  expect(stockUnitCost({ vat_rate: 0, buy_price_ttc: 9500, buy_price_ht: 9500 })).toBe(9500);
  expect(stockUnitCost({ vat_rate: 21, buy_price_ttc: 12100, buy_price_ht: 10000 })).toBe(10000);
});

test('classement par défaut selon particulier / professionnel', () => {
  const part = defaultClassification(false);
  expect(part.rayon).toBe('08 - OCCASIONS');
  expect(part.sub_rayon).toBe('01 - OCCASIONS PARTICULIERS');
  const pro = defaultClassification(true);
  expect(pro.sub_rayon).toBe('02 - OCCASIONS PROFESSIONNELS');
  expect(pro.supplier).toBe('DUCATI BRUXELLES');
});
