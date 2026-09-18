/**
 * Mission 04, carte 6 — contrôle du VIN (case E de la carte grise).
 * 17 caractères, sans I/O/Q : de simples avertissements (cadres anciens acceptés).
 * La base applique la même normalisation (public.vin_normalize). Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { checkVin, normalizeVin } from '../src/lib/vin';

test('normalisation : majuscules, sans espaces ni séparateurs', () => {
  expect(normalizeVin(' zdm 1a02b-gmb.009261 ')).toBe('ZDM1A02BGMB009261');
  expect(normalizeVin(null)).toBe('');
  expect(normalizeVin('   ')).toBe('');
});

test('un VIN Ducati valide ne donne aucun avertissement', () => {
  const r = checkVin('ZDM1A02BGMB009261');
  expect(r.normalized).toBe('ZDM1A02BGMB009261');
  expect(r.warnings).toEqual([]);
});

test('longueur différente de 17 : avertissement, pas de blocage', () => {
  const r = checkVin('ZDM750SS123456');
  expect(r.normalized).toBe('ZDM750SS123456');
  expect(r.warnings).toEqual(['length']);
});

test('lettres I, O, Q interdites : avertissement avec la liste des lettres', () => {
  const r = checkVin('ZDMOA02BGMB0Q9I61');
  expect(r.warnings).toEqual(['forbidden_letters']);
  expect(r.forbidden).toEqual(['O', 'Q', 'I']);
});

test('les deux avertissements peuvent se cumuler', () => {
  expect(checkVin('ioq').warnings).toEqual(['length', 'forbidden_letters']);
});

test('VIN vide : rien à signaler', () => {
  expect(checkVin('').warnings).toEqual([]);
  expect(checkVin(undefined).normalized).toBe('');
});
