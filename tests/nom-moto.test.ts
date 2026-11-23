import { describe, expect, test } from 'bun:test';
import { motoName } from '../src/lib/moto-name';

describe('Nom de la moto à l\'écran', () => {
  test('Ducati : le modèle seul', () => {
    expect(motoName({ brand: 'DUCATI', model: 'MONSTER 1100 S' })).toBe('MONSTER 1100 S');
    expect(motoName({ brand: 'Ducati', model: 'Diavel' })).toBe('Diavel');
  });
  test('la marque recopiée dans le modèle disparaît aussi', () => {
    expect(motoName({ brand: 'DUCATI', model: 'DUCATI PANIGALE V4' })).toBe('PANIGALE V4');
  });
  test('une autre marque reste affichée', () => {
    expect(motoName({ brand: 'BMW', model: 'R 1250 GS' })).toBe('BMW R 1250 GS');
  });
  test('sans modèle : la marque', () => {
    expect(motoName({ brand: 'DUCATI', model: '' })).toBe('DUCATI');
    expect(motoName({})).toBe('');
  });
});
