/**
 * Tests de l'assainissement du texte PDF (M9) — CLAUDE.md règle 7.
 * Le séparateur de milliers fr-BE (fine insécable U+202F) est hors WinAnsi :
 * jsPDF le rendait « / » (bug « 9/000 km »). Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { sanitizePdfText, patchPdfText } from '../src/modules/documents/pdf-text';

const NNBSP = String.fromCharCode(0x202F); // fine insecable (separateur de milliers fr-BE)
const NBSP = String.fromCharCode(0x00A0);  // insecable classique

test('sanitizePdfText : remplace les espaces exotiques par une espace normale', () => {
  expect(sanitizePdfText(`10${NNBSP}000 km`)).toBe('10 000 km');
  expect(sanitizePdfText(`10${NBSP}000 km`)).toBe('10 000 km');
  expect(sanitizePdfText(`9${NNBSP}500,00 EUR`)).toBe('9 500,00 EUR');
  expect([...sanitizePdfText(`21${NNBSP}285`)].every((c) => c.charCodeAt(0) < 0x80 || c === 'é')).toBe(true);
});

test('sanitizePdfText : texte déjà propre inchangé (aucun faux positif)', () => {
  expect(sanitizePdfText('9 000 km')).toBe('9 000 km');
  expect(sanitizePdfText('208 ch (153 kW)')).toBe('208 ch (153 kW)');
});

test('reproduction du bug : U+202F ressort en « / » sous encodage WinAnsi', () => {
  const winAnsi = (s: string) => [...s].map((c) => (c.charCodeAt(0) <= 0xFF ? c : String.fromCharCode(c.charCodeAt(0) & 0xFF))).join('');
  expect(winAnsi(`10${NNBSP}000 km`)).toBe('10/000 km');            // sans fix → bug
  expect(winAnsi(sanitizePdfText(`10${NNBSP}000 km`))).toBe('10 000 km'); // avec fix → OK
});

test('patchPdfText : assainit toute chaîne écrite, string ET tableau de lignes', () => {
  const written: unknown[] = [];
  const fake = { text: (t: unknown, ..._rest: unknown[]) => { written.push(t); return null; } };
  patchPdfText(fake);
  fake.text(`21${NNBSP}285 km`, 0, 0);
  fake.text([`9${NNBSP}000 km`, 'Ducati'], 0, 0);
  expect(written[0]).toBe('21 285 km');
  expect(written[1]).toEqual(['9 000 km', 'Ducati']);
});
