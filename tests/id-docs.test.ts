/**
 * Tests de la lecture automatique Permis & ID (M1) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { parseAnyDate, bestLicenseCategory, buildIdPatch, type IdTargets } from '../src/modules/contacts/id-docs-data';

const empty: IdTargets = {
  first_name: '', last_name: '', birth_date: '', national_id: '', national_register: '',
  license_number: '', license_date: '', license_place: '', license_category: '',
};

test('parseAnyDate : formats belges et ISO', () => {
  expect(parseAnyDate('17.11.1978')).toBe('1978-11-17');
  expect(parseAnyDate('17/11/1978')).toBe('1978-11-17');
  expect(parseAnyDate('7-3-2005')).toBe('2005-03-07');
  expect(parseAnyDate('1978-11-17')).toBe('1978-11-17');
  expect(parseAnyDate('')).toBe('');
  expect(parseAnyDate(null)).toBe('');
  expect(parseAnyDate('novembre 1978')).toBe('');
});

test('bestLicenseCategory : priorité moto A > A2 > A1 > AM > B', () => {
  expect(bestLicenseCategory(['B', 'A2'])).toBe('A2');
  expect(bestLicenseCategory(['AM', 'A', 'B'])).toBe('A');
  expect(bestLicenseCategory(['B'])).toBe('B');
  expect(bestLicenseCategory(['am'])).toBe('AM');
  expect(bestLicenseCategory(['C'])).toBe('autre');
  expect(bestLicenseCategory([])).toBe('');
  expect(bestLicenseCategory(null)).toBe('');
});

test('buildIdPatch : remplit uniquement les champs vides', () => {
  const current = { ...empty, last_name: 'NUNES', license_number: 'B123' };
  const patch = buildIdPatch(current, {
    first_name: 'Sébastien', last_name: 'AUTRE',
    birth_date: '17.11.1978', license_number: 'B999',
    license_categories: ['B', 'A'], national_register: '78.11.17-123.45',
  });
  expect(patch.first_name).toBe('Sébastien');
  expect(patch.last_name).toBeUndefined();      // déjà saisi — jamais écrasé
  expect(patch.license_number).toBeUndefined(); // déjà saisi
  expect(patch.birth_date).toBe('1978-11-17');
  expect(patch.license_category).toBe('A');
  expect(patch.national_register).toBe('78.11.17-123.45');
});

test('buildIdPatch : valeurs nulles / vides ignorées', () => {
  const patch = buildIdPatch(empty, { first_name: null, last_name: '  ', birth_date: 'illisible' });
  expect(patch).toEqual({});
});
