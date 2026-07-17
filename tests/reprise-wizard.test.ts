/**
 * Tests des helpers de l'assistant de reprise moto (M7) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  convertPower, powerConversionLabel, normalizeVat, years, kmSuggestions, ccSuggestions,
} from '../src/modules/tradein/reprise-wizard-data';
import { findSpecs, modelsForBrand, MOTO_SPECS } from '../src/modules/tradein/moto-specs';
import { needsFollowUp, OFFERS_TARGET } from '../src/modules/tradein/partners-api';

test('findSpecs : correspondance exacte (Ducati Panigale V2 = 955 cm³, 155 ch)', () => {
  const s = findSpecs('Ducati', 'Panigale V2');
  expect(s?.cc).toBe(955);
  expect(s?.ch).toBe(155);
  expect(s?.fuel).toBe('Essence');
});

test('findSpecs : préfixe le plus long (V4 S avant V4), casse ignorée', () => {
  expect(findSpecs('ducati', 'panigale v4 s')?.ch).toBe(215);
  expect(findSpecs('Ducati', 'Streetfighter V2 2023')?.cc).toBe(955);
  expect(findSpecs('Ducati', 'inconnu')).toBeNull();
  expect(findSpecs('', '')).toBeNull();
});

test('modelsForBrand : suggestions par marque', () => {
  expect(modelsForBrand('Ducati').length).toBeGreaterThan(30);
  expect(modelsForBrand('Yamaha')).toContain('MT-07');
});

test('MOTO_SPECS : specs cohérentes (cc 0-2000, ch 0-300)', () => {
  for (const s of MOTO_SPECS) {
    expect(s.cc).toBeGreaterThanOrEqual(0);
    expect(s.cc).toBeLessThanOrEqual(2000);
    expect(s.ch).toBeGreaterThan(0);
    expect(s.ch).toBeLessThanOrEqual(300);
  }
});

test('needsFollowUp : < 4 offres et ouvert depuis 3+ jours → relance', () => {
  const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const recent = new Date().toISOString();
  expect(needsFollowUp(old, 2, 'ouvert')).toBe(true);
  expect(needsFollowUp(old, OFFERS_TARGET, 'ouvert')).toBe(false);
  expect(needsFollowUp(recent, 0, 'ouvert')).toBe(false);
  expect(needsFollowUp(old, 0, 'cloture')).toBe(false);
});

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
