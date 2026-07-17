/**
 * Tests de la vérification TVA VIES (M1) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { parseVatInput, parseViesAddress, kboUrl } from '../src/modules/contacts/vies-api';

test('parseVatInput : formats belges (points, espaces, minuscules, sans préfixe)', () => {
  expect(parseVatInput('be 0451.308.707')).toEqual({ country: 'BE', number: '0451308707' });
  expect(parseVatInput('BE0451308707')).toEqual({ country: 'BE', number: '0451308707' });
  expect(parseVatInput('0451308707')).toEqual({ country: 'BE', number: '0451308707' });
  // 9 chiffres (ancien format) → 0 devant
  expect(parseVatInput('451308707')).toEqual({ country: 'BE', number: '0451308707' });
});

test('parseVatInput : numéros étrangers UE', () => {
  expect(parseVatInput('FR40303265045')).toEqual({ country: 'FR', number: '40303265045' });
  expect(parseVatInput('NL999999999B01')).toEqual({ country: 'NL', number: '999999999B01' });
  expect(parseVatInput('DE 129.273.398')).toEqual({ country: 'DE', number: '129273398' });
});

test('parseVatInput : vide → null', () => {
  expect(parseVatInput('')).toBeNull();
  expect(parseVatInput('  .  ')).toBeNull();
});

test('parseViesAddress : rue + numéro + CP + ville', () => {
  const a = parseViesAddress('Rue de la Loi 16\n1000 Bruxelles');
  expect(a).toEqual({ street: 'Rue de la Loi', number: '16', zip: '1000', city: 'Bruxelles' });
});

test('parseViesAddress : cas limites (---, vide, une seule ligne)', () => {
  expect(parseViesAddress('---')).toEqual({ street: '', number: '', zip: '', city: '' });
  expect(parseViesAddress(null)).toEqual({ street: '', number: '', zip: '', city: '' });
  const one = parseViesAddress('1785 Merchtem');
  expect(one.zip).toBe('1785');
  expect(one.city).toBe('Merchtem');
});

test('parseViesAddress : rue sans numéro conservée', () => {
  const a = parseViesAddress('Grand Place\n1000 Bruxelles');
  expect(a.street).toBe('Grand Place');
  expect(a.number).toBe('');
});

test('kboUrl : lien BCE pré-rempli', () => {
  expect(kboUrl('0451308707')).toContain('nummer=0451308707');
});
