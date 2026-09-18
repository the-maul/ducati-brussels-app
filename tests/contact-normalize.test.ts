/**
 * Mission 04 — normalisation du mobile (carte 3), de l'e-mail (carte 4) et contrôle
 * de l'IBAN (carte 5). Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  normalizeEmail, normalizeMobile, belgianGsmFromPhone, isValidIban, normalizeIban, formatIban,
} from '../src/lib/contact-normalize';

test('e-mail : espaces retirés et minuscules', () => {
  expect(normalizeEmail('  Jean.Dupont@Gmail.COM ')).toBe('jean.dupont@gmail.com');
  expect(normalizeEmail('')).toBe('');
  expect(normalizeEmail(null)).toBe('');
  expect(normalizeEmail(undefined)).toBe('');
});

test('mobile belge commençant par 0 → +32', () => {
  expect(normalizeMobile('0471 12 34 56')).toBe('+32471123456');
  expect(normalizeMobile('0475/870.444')).toBe('+32475870444');
  expect(normalizeMobile('0412-34-56-78')).toBe('+32412345678');
});

test('mobile commençant par + : gardé, formatage retiré', () => {
  expect(normalizeMobile('+32 412 34 56 78')).toBe('+32412345678');
  expect(normalizeMobile('+33 6 12 34 56 78')).toBe('+33612345678');
  expect(normalizeMobile('+1 778 855 1952')).toBe('+17788551952');
  expect(normalizeMobile('+32471722249')).toBe('+32471722249');
});

test('0 national saisi après l\'indicatif : retiré', () => {
  expect(normalizeMobile('+32 0471 12 34 56')).toBe('+32471123456');
  expect(normalizeMobile('+33 06 12 34 56 78')).toBe('+33612345678');
});

test('00 international → +', () => {
  expect(normalizeMobile('0032 470 62 31 44')).toBe('+32470623144');
  expect(normalizeMobile('00 31 6 20038003')).toBe('+31620038003');
});

test('mobile vide ou sans chiffre', () => {
  expect(normalizeMobile('')).toBe('');
  expect(normalizeMobile('   ')).toBe('');
  expect(normalizeMobile(null)).toBe('');
  expect(normalizeMobile('+32')).toBe(''); // indicatif seul du menu, rien de saisi
  expect(normalizeMobile('.')).toBe('');
});

test('numéro sans indicatif ni 0 : gardé (chiffres)', () => {
  expect(normalizeMobile('335 833 2150')).toBe('3358332150');
});

test('GSM belge trouvé dans le téléphone G8', () => {
  expect(belgianGsmFromPhone('0475/870.444')).toBe('+32475870444');
  expect(belgianGsmFromPhone('0475/87 04 44')).toBe('+32475870444');
  expect(belgianGsmFromPhone('+32475/727873')).toBe('+32475727873');
  expect(belgianGsmFromPhone('+32 0475 72 78 73')).toBe('+32475727873');
  expect(belgianGsmFromPhone('0032 475 72 78 73')).toBe('+32475727873');
  // fixes belges et numéros étrangers : pas un GSM belge
  expect(belgianGsmFromPhone('02/345.67.89')).toBeNull();
  expect(belgianGsmFromPhone('081 22 33 44')).toBeNull();
  expect(belgianGsmFromPhone('+33 6 12 34 56 78')).toBeNull();
  expect(belgianGsmFromPhone('')).toBeNull();
  expect(belgianGsmFromPhone('0475 12 34')).toBeNull();
});

test('IBAN valides (modulo 97)', () => {
  expect(isValidIban('BE68 5390 0754 7034')).toBe(true);
  expect(isValidIban('be68539007547034')).toBe(true);
  expect(isValidIban('FR14 2004 1010 0505 0001 3M02 606')).toBe(true);
  expect(isValidIban('NL91ABNA0417164300')).toBe(true);
  expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
  expect(isValidIban('LU28 0019 4006 4475 0000')).toBe(true);
});

test('IBAN invalides', () => {
  expect(isValidIban('BE68 5390 0754 7035')).toBe(false); // chiffre changé
  expect(isValidIban('BE68 5390 0754 703')).toBe(false);  // trop court pour BE
  expect(isValidIban('BE6853900754703412')).toBe(false);  // trop long pour BE
  expect(isValidIban('')).toBe(false);
  expect(isValidIban('12345678')).toBe(false);
  expect(isValidIban('NL91ABNA0417164301')).toBe(false);
});

test('IBAN normalisé et affiché par groupes de 4', () => {
  expect(normalizeIban(' be68 5390-0754 7034 ')).toBe('BE68539007547034');
  expect(formatIban('BE68539007547034')).toBe('BE68 5390 0754 7034');
});
