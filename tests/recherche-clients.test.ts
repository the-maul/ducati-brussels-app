import { describe, expect, test } from 'bun:test';
import { vehiclesFirst } from '../src/modules/contacts/search-order';

describe('Recherche globale : ordre des groupes', () => {
  test('un nom cherche d\'abord un client', () => {
    expect(vehiclesFirst('des')).toBe(false);
    expect(vehiclesFirst('desouter domenico')).toBe(false);
  });
  test('un VIN ou une plaque cherche d\'abord une moto', () => {
    expect(vehiclesFirst('ZDMM502AA9B018417')).toBe(true);
    expect(vehiclesFirst('1-MCG-408')).toBe(true);
  });
});
