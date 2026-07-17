/**
 * Indicatifs téléphoniques — découpage FIABLE préfixe/numéro (corrige « +3247 »).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { splitPhone, joinPhone, DIAL_CODES, FAVORITE_DIAL_CODES } from '../src/lib/dial-codes';

test('le bug du screenshot : +32 ne devient plus +3247', () => {
  expect(splitPhone('+32471722249')).toEqual({ prefix: '+32', local: '471722249' });
  expect(splitPhone('+3247 1722249')).toEqual({ prefix: '+32', local: '47 1722249' });
  expect(splitPhone('+32 470 12 34 56')).toEqual({ prefix: '+32', local: '470 12 34 56' });
});

test('plus longue correspondance sur indicatif connu', () => {
  expect(splitPhone('+352123456')).toEqual({ prefix: '+352', local: '123456' });
  expect(splitPhone('+33612345678')).toEqual({ prefix: '+33', local: '612345678' });
  expect(splitPhone('+49 151 123')).toEqual({ prefix: '+49', local: '151 123' });
  expect(splitPhone('+39 340 1234567')).toEqual({ prefix: '+39', local: '340 1234567' });
  expect(splitPhone('+31 6 12345678')).toEqual({ prefix: '+31', local: '6 12345678' });
  expect(splitPhone('+34 600 123 456')).toEqual({ prefix: '+34', local: '600 123 456' });
  expect(splitPhone('+351 912 345 678')).toEqual({ prefix: '+351', local: '912 345 678' });
  expect(splitPhone('+1 2025551234')).toEqual({ prefix: '+1', local: '2025551234' });
});

test('sans préfixe / vide → +32 par défaut', () => {
  expect(splitPhone('0470123456')).toEqual({ prefix: '+32', local: '0470123456' });
  expect(splitPhone('')).toEqual({ prefix: '+32', local: '' });
  expect(splitPhone('   ')).toEqual({ prefix: '+32', local: '' });
  expect(splitPhone(null)).toEqual({ prefix: '+32', local: '' });
  expect(splitPhone('+352')).toEqual({ prefix: '+352', local: '' });
});

test('joinPhone + aller-retour', () => {
  expect(joinPhone('+32', '471722249')).toBe('+32 471722249');
  expect(joinPhone('+32', '')).toBe('+32');
  expect(joinPhone('+33', '  6 12 34  ')).toBe('+33 6 12 34');
  const s = splitPhone('+32471722249');
  expect(joinPhone(s.prefix, s.local)).toBe('+32 471722249');
});

test('intégrité de la liste : favoris présents, codes uniques, format', () => {
  const codes = DIAL_CODES.map((d) => d.code);
  for (const fav of FAVORITE_DIAL_CODES) expect(codes).toContain(fav);
  expect(new Set(codes).size).toBe(codes.length); // pas de doublon
  for (const c of codes) expect(c).toMatch(/^\+\d{1,4}$/);
});
