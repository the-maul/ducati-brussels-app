import { describe, expect, test } from 'bun:test';
import { cleanPlate, normalizePlate, plateInput, plateIsValid } from '../src/lib/plate';

describe("Plaque d'immatriculation", () => {
  test('retire les caractères spéciaux et passe en majuscules', () => {
    expect(normalizePlate('m-ark-250')).toBe('MARK250');
    expect(plateInput('1 abc.234', false)).toBe('1ABC234');
  });
  test('exactement 7 caractères', () => {
    expect(plateIsValid('MARK250', false)).toBe(true);
    expect(plateIsValid('ABC123', false)).toBe(false);
    expect(plateIsValid('MARK2500', false)).toBe(false);
  });
  test("la saisie s'arrête à 7 caractères", () => {
    expect(plateInput('1-abc-2345', false)).toBe('1ABC234');
  });
  test("une plaque lue trop longue n'est pas coupée en silence", () => {
    expect(cleanPlate('1-ABC-2345', false)).toBe('1ABC2345');
    expect(plateIsValid(cleanPlate('1-ABC-2345', false), false)).toBe(false);
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
