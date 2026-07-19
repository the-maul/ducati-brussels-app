/**
 * Tests du référentiel de familles (M2) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  PRODUCT_FAMILIES, RAYONS_SORTED, sousRayonsFor, categoriesFor,
  buildFamilyCode, parseFamilyCode, familyLabels, sortByCode,
} from '../src/modules/articles/product-families';

test('hiérarchie complète chargée (12 rayons)', () => {
  expect(PRODUCT_FAMILIES.length).toBe(12);
  expect(RAYONS_SORTED[0].code).toBe('01');
  expect(RAYONS_SORTED[RAYONS_SORTED.length - 1].code).toBe('99'); // DIVERS en dernier
});

test('cascade Rayon > Sous-rayon > Catégorie', () => {
  const subs = sousRayonsFor('01');
  expect(subs.some((s) => s.code === '01' && s.label === 'MOTOS')).toBe(true);
  const cats = categoriesFor('01', '01');
  expect(cats.some((c) => c.code === '01' && c.label === 'MONSTER')).toBe(true);
  expect(cats.some((c) => c.code === '99' && c.label === 'DIVERS')).toBe(true);
});

test('buildFamilyCode : UID Rayon-Sous-rayon-Catégorie ou vide si incomplet', () => {
  expect(buildFamilyCode('01', '01', '01')).toBe('01-01-01');
  expect(buildFamilyCode('04', '12', '03')).toBe('04-12-03');
  expect(buildFamilyCode('01', '', '01')).toBe('');
  expect(buildFamilyCode('', '', '')).toBe('');
});

test('parseFamilyCode : UID valide, ancien code (R11) rejeté', () => {
  expect(parseFamilyCode('01-01-01')).toEqual({ rayon: '01', sousRayon: '01', cat: '01' });
  expect(parseFamilyCode('03-9A-01')).toEqual({ rayon: '03', sousRayon: '9A', cat: '01' });
  expect(parseFamilyCode('R11')).toBeNull();
  expect(parseFamilyCode('R17')).toBeNull();
  expect(parseFamilyCode('')).toBeNull();
  expect(parseFamilyCode(null)).toBeNull();
});

test('familyLabels : libellés lisibles depuis l’UID', () => {
  expect(familyLabels('01-01-01')).toEqual({ rayon: 'PRODUITS FINIS NEUFS', sousRayon: 'MOTOS', cat: 'MONSTER' });
  expect(familyLabels('04-12-03')).toEqual({ rayon: 'LUBRIFIANTS / NETTOYANTS', sousRayon: 'SHELL', cat: '10W60' });
  expect(familyLabels('R11')).toBeNull();       // ancien code inutile
  expect(familyLabels('99-99-88')).toBeNull();  // catégorie inexistante
});

test('sortByCode : numériques croissants, alphanumériques ensuite, 99 en dernier', () => {
  const sorted = sortByCode([{ code: '99', label: 'x' }, { code: '9A', label: 'x' }, { code: '02', label: 'x' }, { code: '01', label: 'x' }]);
  expect(sorted.map((n) => n.code)).toEqual(['01', '02', '9A', '99']);
});
