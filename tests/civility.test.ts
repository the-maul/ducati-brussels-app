/**
 * Mission 04, carte 2 — civilité de la personne vs forme juridique. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { personCivility, legalFormOptions } from '../src/modules/contacts/civility';

test('civilités de personne reconnues, écritures G8 comprises', () => {
  expect(personCivility('Monsieur')).toBe('Monsieur');
  expect(personCivility('MR')).toBe('Monsieur');
  expect(personCivility('m.')).toBe('Monsieur');
  expect(personCivility('Madame')).toBe('Madame');
  expect(personCivility('MME')).toBe('Madame');
  expect(personCivility('mx')).toBe('Mx');
});

test('une forme juridique n’est pas une civilité', () => {
  expect(personCivility('SPRL')).toBeNull();
  expect(personCivility('SA')).toBeNull();
  expect(personCivility('Autre')).toBeNull();
  expect(personCivility('')).toBeNull();
  expect(personCivility(null)).toBeNull();
});

test('formes juridiques = lignes actives marquées Professionnel', () => {
  const rows = [
    { code: 'MR', label: 'Monsieur', is_active: true, extra: { professional: false, default: true } },
    { code: 'SRL', label: 'SRL', is_active: true, extra: { professional: true } },
    { code: 'SPRL', label: '', is_active: true, extra: { professional: true } },
    { code: 'BVBA', label: 'BVBA', is_active: false, extra: { professional: true } },
    { code: 'X', label: 'X', is_active: true, extra: null },
  ];
  expect(legalFormOptions(rows)).toEqual([
    { code: 'SRL', label: 'SRL' },
    { code: 'SPRL', label: 'SPRL' },
  ]);
});
