/**
 * Tests des helpers de l'assistant de reprise moto (M7) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  convertPower, powerConversionLabel, normalizeVat, years, kmSuggestions, ccSuggestions,
} from '../src/modules/tradein/reprise-wizard-data';

test('convertPower : CH → kW (113 ch ≈ 83 kW)', () => {
  const c = convertPower(113, 'ch');
  expect(c.ch).toBe(113);
  expect(c.kw).toBe(83);
});

test('convertPower : kW → CH (83 kW ≈ 113 ch)', () => {
  const c = convertPower(83, 'kw');
  expect(c.kw).toBe(83);
  expect(c.ch).toBe(113);
});

test('powerConversionLabel : parenthèse selon l’unité', () => {
  expect(powerConversionLabel(113, 'ch')).toBe('≈ 83 kW');
  expect(powerConversionLabel(83, 'kw')).toBe('≈ 113 ch');
  expect(powerConversionLabel(0, 'ch')).toBe('');
});

test('normalizeVat : majuscules, sans espaces ni caractères spéciaux', () => {
  expect(normalizeVat('be 0123.456-789')).toBe('BE0123456789');
  expect(normalizeVat('be0123456789')).toBe('BE0123456789');
  expect(normalizeVat('')).toBe('');
});

test('years : de l’année courante à 1970', () => {
  const y = years();
  expect(y[0]).toBe(new Date().getFullYear());
  expect(y[y.length - 1]).toBe(1970);
  expect(y.includes(2022)).toBe(true);
});

test('kmSuggestions : 0, 1000, …, 100000', () => {
  const k = kmSuggestions();
  expect(k[0]).toBe(0);
  expect(k[1]).toBe(1000);
  expect(k[k.length - 1]).toBe(100000);
});

test('ccSuggestions : 0 → 2000 par pas de 50', () => {
  const cc = ccSuggestions();
  expect(cc[0]).toBe(0);
  expect(cc.includes(950)).toBe(true);
  expect(cc[cc.length - 1]).toBe(2000);
});
