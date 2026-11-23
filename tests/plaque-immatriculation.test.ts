import { describe, expect, test } from 'bun:test';
import { cleanPlate, normalizePlate, plateInput, plateIsValid } from '../src/lib/plate';

describe("Plaque d'immatriculation", () => {
  test('retire les caractères spéciaux et passe en majuscules', () => {
    expect(normalizePlate('m-ark-250')).toBe('MARK250');
    expect(plateInput('1 abc.234', false)).toBe('1ABC234');
  });
  test('7 caractères minimum', () => {
    expect(plateIsValid('MARK250', false)).toBe(true);
    expect(plateIsValid('ABC123', false)).toBe(false);
  });
  test('plaque vide permise', () => {
    expect(plateIsValid('', false)).toBe(true);
  });
  test('plaque personnalisée : ni longueur ni caractères imposés', () => {
    expect(plateInput('duc-1', true)).toBe('DUC-1');
    expect(cleanPlate(' duc-1 ', true)).toBe('DUC-1');
    expect(plateIsValid('D', true)).toBe(true);
  });
});
