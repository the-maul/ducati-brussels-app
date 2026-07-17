/**
 * Tests de l'import DCS/My Ducati (M1/M3) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { splitFullName } from '../src/lib/myducati';

test('splitFullName : « SÉBASTIEN NUNES » → prénom puis nom (règle magasin)', () => {
  expect(splitFullName('SÉBASTIEN NUNES')).toEqual({ first: 'SÉBASTIEN', last: 'NUNES' });
});

test('splitFullName : nom composé — le premier mot est le prénom, le reste est le nom', () => {
  expect(splitFullName('JEAN MARIE VAN DEN BERG')).toEqual({ first: 'JEAN', last: 'MARIE VAN DEN BERG' });
});

test('splitFullName : espaces multiples et bords nettoyés', () => {
  expect(splitFullName('  Sébastien   Nunes  ')).toEqual({ first: 'Sébastien', last: 'Nunes' });
});

test('splitFullName : un seul mot → prénom seul', () => {
  expect(splitFullName('NUNES')).toEqual({ first: 'NUNES', last: '' });
});

test('splitFullName : vide / null → vide', () => {
  expect(splitFullName('')).toEqual({ first: '', last: '' });
  expect(splitFullName(null)).toEqual({ first: '', last: '' });
  expect(splitFullName(undefined)).toEqual({ first: '', last: '' });
});
