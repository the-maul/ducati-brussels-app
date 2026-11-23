import { describe, expect, test } from 'bun:test';
import { isDucatiBrand, superModelsOf, yearOptions } from '../src/modules/vehicles/model-pick';

const model = (supermodel_id: string, label: string, sort: number | null) => ({
  supermodel_id, description: `${label} S`, sort: null, supermodel: { description: label, sort },
});

describe('Choix de la moto', () => {
  test('chaque cylindrée une seule fois, dans l\'ordre du catalogue', () => {
    const r = superModelsOf([model('b', '1200', 2), model('a', '620', 1), model('b', '1200', 2)]);
    expect(r).toEqual([{ id: 'a', label: '620' }, { id: 'b', label: '1200' }]);
  });
  test('sans ordre connu : tri numérique', () => {
    const r = superModelsOf([model('b', '1200', null), model('a', '950', null)]);
    expect(r.map((x) => x.label)).toEqual(['950', '1200']);
  });
  test('années de la plus récente à la plus ancienne', () => {
    expect(yearOptions(2026, 2024)).toEqual(['2027', '2026', '2025', '2024']);
  });
  test('marque vide ou Ducati : catalogue Ducati', () => {
    expect(isDucatiBrand('')).toBe(true);
    expect(isDucatiBrand(' ducati ')).toBe(true);
    expect(isDucatiBrand('BMW')).toBe(false);
  });
});
