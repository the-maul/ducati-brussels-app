/**
 * Tests M6 — QR de virement SEPA (mission 02, carte 9) : charge utile EPC069-12 v002 exacte,
 * communication structurée belge (modulo 97, 97 si le reste vaut 0), montants proposés.
 * IBAN d'exemple publics (documentation bancaire), aucune donnée réelle.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  buildEpcPayload, epcAmount, belgianStructuredReference, structuredCheckDigits,
  structuredReferenceForDocument, isValidStructuredReference, freeTextReference,
  isValidIban, maskIban, formatIban, qrProposedAmount, EPC_MAX_BYTES,
} from '../src/modules/sales/epc-qr';

const IBAN = 'BE71 0961 2345 6769'; // IBAN d'exemple (documentation), valide au modulo 97

test('charge utile exacte : lignes EPC v002, UTF-8, SCT, sans BIC, référence structurée', () => {
  const p = buildEpcPayload({ name: 'ITALBIKE STORE', iban: IBAN, amount: 123.45, structuredReference: '+++120/2600/01214+++' });
  expect(p).toBe(['BCD', '002', '1', 'SCT', '', 'ITALBIKE STORE', 'BE71096123456769', 'EUR123.45', '', '+++120/2600/01214+++'].join('\n'));
  expect(p.split('\n')).toHaveLength(10);
});

test('charge utile exacte : BIC présent et communication libre en ligne 11', () => {
  const p = buildEpcPayload({ name: 'ITALBIKE STORE', iban: IBAN, bic: 'gkcc be bb', amount: 50, text: 'DEV-2026-00012 Jean Dupont' });
  expect(p).toBe('BCD\n002\n1\nSCT\nGKCCBEBB\nITALBIKE STORE\nBE71096123456769\nEUR50.00\n\n\nDEV-2026-00012 Jean Dupont');
});

test('montant : « EUR123.45 », deux décimales, point, bornes', () => {
  expect(epcAmount(123.45)).toBe('EUR123.45');
  expect(epcAmount(0.01)).toBe('EUR0.01');
  expect(epcAmount(1234567.8)).toBe('EUR1234567.80');
  expect(epcAmount(10.005)).toBe('EUR10.01');
  expect(() => epcAmount(0)).toThrow();
  expect(() => epcAmount(-5)).toThrow();
  expect(() => epcAmount(1_000_000_000)).toThrow();
});

test('longueurs maximales : nom 70, communication 140, charge utile 331 octets', () => {
  const name70 = 'N'.repeat(70);
  const text140 = 'é'.repeat(140); // 280 octets en UTF-8
  expect(() => buildEpcPayload({ name: 'N'.repeat(71), iban: IBAN, amount: 1 })).toThrow();
  expect(() => buildEpcPayload({ name: 'X', iban: IBAN, amount: 1, text: 'x'.repeat(141) })).toThrow();
  expect(() => buildEpcPayload({ name: 'X', iban: IBAN, amount: 1, structuredReference: 'R'.repeat(36) })).toThrow();
  // 70 + 280 + en-têtes > 331 octets : refusé
  expect(() => buildEpcPayload({ name: name70, iban: IBAN, amount: 1, text: text140 })).toThrow();
  const ok = buildEpcPayload({ name: name70, iban: IBAN, amount: 999999999.99, text: 'x'.repeat(140) });
  expect(new TextEncoder().encode(ok).length).toBeLessThanOrEqual(EPC_MAX_BYTES);
});

test('refus : IBAN invalide, les deux communications, retour à la ligne neutralisé', () => {
  expect(() => buildEpcPayload({ name: 'X', iban: 'BE71096123456768', amount: 1 })).toThrow();
  expect(() => buildEpcPayload({ name: 'X', iban: IBAN, amount: 1, text: 'a', structuredReference: '+++090/9337/55493+++' })).toThrow();
  const p = buildEpcPayload({ name: 'ITAL\nBIKE', iban: IBAN, amount: 1, text: 'a\r\nb' });
  expect(p.split('\n')[5]).toBe('ITAL BIKE');
  expect(p.split('\n')[10]).toBe('a b');
});

test('communication structurée belge : exemples connus, modulo 97', () => {
  expect(belgianStructuredReference('0909337554')).toBe('+++090/9337/55493+++');
  expect(belgianStructuredReference('0108068171')).toBe('+++010/8068/17183+++');
  expect(structuredCheckDigits('0000000001')).toBe('01');
  expect(isValidStructuredReference('+++090/9337/55493+++')).toBe(true);
  expect(isValidStructuredReference('090933755494')).toBe(false);
});

test('communication structurée : 97 quand le reste vaut 0', () => {
  expect(structuredCheckDigits('0000000097')).toBe('97');
  expect(structuredCheckDigits('0000000000')).toBe('97');
  expect(belgianStructuredReference('9700000000')).toBe('+++970/0000/00097+++'); // 9 700 000 000 = 97 × 100 000 000
  expect(() => structuredCheckDigits('123')).toThrow();
});

test('communication structurée d’un document : type + 9 derniers chiffres du numéro', () => {
  expect(structuredReferenceForDocument('DEV', 'DEV-2026-00012')).toBe(belgianStructuredReference('1202600012'));
  expect(structuredReferenceForDocument('FAC', 'FAC-2026-00012')).toBe(belgianStructuredReference('5202600012'));
  expect(structuredReferenceForDocument('FAC', '20180739')).toBe(belgianStructuredReference('5020180739'));
  expect(structuredReferenceForDocument('DEV', null)).toBeNull();
  expect(structuredReferenceForDocument('DEV', 'BROUILLON')).toBeNull();
  const r = structuredReferenceForDocument('RES', 'RES-2026-00003')!;
  expect(isValidStructuredReference(r)).toBe(true);
});

test('communication libre, IBAN masqué et formaté', () => {
  expect(freeTextReference('DEV-2026-00012', 'Jean  Dupont')).toBe('DEV-2026-00012 Jean Dupont');
  expect(freeTextReference('DEV-1', 'x'.repeat(200))).toHaveLength(140);
  expect(isValidIban(IBAN)).toBe(true);
  expect(maskIban(IBAN)).toBe('BE71 •••• •••• 6769');
  expect(formatIban('be71096123456769')).toBe('BE71 0961 2345 6769');
});

test('montants proposés : reste à payer, acompte 10 % plafonné, montant libre', () => {
  expect(qrProposedAmount('solde', 812.5, 1000, 0)).toBe(812.5);
  expect(qrProposedAmount('acompte10', 812.5, 1000, 0)).toBe(100);
  expect(qrProposedAmount('acompte10', 40, 1000, 0)).toBe(40);
  expect(qrProposedAmount('libre', 812.5, 1000, 250.456)).toBe(250.46);
  expect(qrProposedAmount('solde', -3, 1000, 0)).toBe(0);
});
