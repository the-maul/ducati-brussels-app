/**
 * Téléphones uniformisés (carte « Inscription en ligne », retour client du 21/09) :
 * stockage E.164, saisie « 0470… » acceptée, e-mail refusé, affichage lisible.
 * Exécution : `npx --yes bun test`.
 */
import { test, expect } from 'bun:test';
import { toE164, isValidPhone, isEmptyPhone, formatPhone, formatLocalPart, hasOnlyPhoneChars } from '../src/lib/phone';

test('saisie belge « 0470… » → E.164 +32470…', () => {
  expect(toE164('0470123456')).toBe('+32470123456');
  expect(toE164('0470 12 34 56')).toBe('+32470123456');
  expect(toE164('0470/12.34.56')).toBe('+32470123456');
  expect(toE164('+32 0470 12 34 56')).toBe('+32470123456'); // 0 national après le préfixe
  expect(toE164('+32 470 12 34 56')).toBe('+32470123456');
  expect(toE164('0032 470 12 34 56')).toBe('+32470123456');
  expect(toE164('470123456')).toBe('+32470123456'); // sans 0 ni indicatif : belge
  expect(toE164('+32496947527')).toBe('+32496947527'); // déjà au bon format : inchangé
});

test('le cas de la vidéo : préfixe + adresse e-mail → refusé', () => {
  expect(toE164('+32 desouter.d@gmail.com')).toBeNull();
  expect(isValidPhone('+32 desouter.d@gmail.com')).toBe(false);
  expect(toE164('desouter.d@gmail.com')).toBeNull();
  expect(toE164('0470 abc')).toBeNull();
  expect(hasOnlyPhoneChars('+32 (0)470-12.34/56')).toBe(true);
  expect(hasOnlyPhoneChars('a@b.be')).toBe(false);
});

test('vide ou préfixe seul → aucun numéro', () => {
  expect(toE164('')).toBe('');
  expect(toE164(null)).toBe('');
  expect(toE164('   ')).toBe('');
  expect(toE164('+32')).toBe('');
  expect(toE164('+32 ')).toBe('');
  expect(isEmptyPhone('+352')).toBe(true);
  expect(isEmptyPhone('+32 470')).toBe(false);
  expect(isValidPhone('')).toBe(true);
});

test('autres pays', () => {
  expect(toE164('+33 06 12 34 56 78')).toBe('+33612345678');
  expect(toE164('+33 6 12 34 56 78')).toBe('+33612345678');
  expect(toE164('+352 621 123 456')).toBe('+352621123456');
  expect(toE164('+39 06 1234 5678')).toBe('+390612345678'); // Italie : le 0 fait partie du numéro
  expect(toE164('0033612345678')).toBe('+33612345678');
});

test('trop court / trop long → refusé', () => {
  expect(toE164('+32 47')).toBeNull();
  expect(toE164('+32 4701234567890123')).toBeNull();
});

test('affichage lisible', () => {
  expect(formatPhone('+32470123456')).toBe('+32 470 12 34 56');
  expect(formatPhone('0470123456')).toBe('+32 470 12 34 56');
  expect(formatPhone('+3221234567')).toBe('+32 2 123 45 67'); // Bruxelles
  expect(formatPhone('+3210123456')).toBe('+32 10 12 34 56'); // Wavre
  expect(formatPhone('+33612345678')).toBe('+33 6 12 34 56 78');
  expect(formatPhone('+352621123456')).toBe('+352 621 123 456');
  expect(formatPhone('')).toBe('');
  expect(formatPhone(null)).toBe('');
  // Donnée ancienne qui n'est pas un numéro : montrée telle quelle, jamais perdue.
  expect(formatPhone('voir épouse')).toBe('voir épouse');
});

test('champ de saisie : numéro national remis en forme', () => {
  expect(formatLocalPart('+32', '0470123456')).toBe('470 12 34 56');
  expect(formatLocalPart('+32', '470 123 456')).toBe('470 12 34 56');
  expect(formatLocalPart('+32', '')).toBe('');
  expect(formatLocalPart('+32', 'desouter.d@gmail.com')).toBe('desouter.d@gmail.com');
  expect(formatLocalPart('+33', '0612345678')).toBe('6 12 34 56 78');
});
