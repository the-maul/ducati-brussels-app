import { describe, expect, test } from 'bun:test';
import { catalogSpecValues, fillEmptyVehicleFields, type ModelSpecRow } from '../src/modules/vehicles/catalog-specs';

const spec = (over: Partial<ModelSpecRow> = {}): ModelSpecRow => ({
  model_year_id: '1', displacement_cc: null, power_kw: null, power_cv: null, cylinders: null, euro: null, ...over,
});

describe('Caractéristiques depuis le catalogue', () => {
  test('modèle-année exact', () => {
    const v = catalogSpecValues({ own: spec({ displacement_cc: '1100', power_cv: '95', cylinders: 2, euro: 'EURO 3' }), siblings: [], year: 2009, family: 'MONSTER' });
    expect(v).toMatchObject({ displacement: 1100, power_cv: 95, cylinders: 2, antipollution: 'EURO 3', category: 'MONSTER', model_year: 2009, energy: 'Essence' });
    expect(v.power_kw).toBe(69.9);
  });
  test('valeur absente : année la plus proche du même modèle, sauf la norme', () => {
    const v = catalogSpecValues({
      own: spec({ displacement_cc: '1100' }),
      siblings: [{ ...spec({ model_year_id: '2', power_cv: 100, cylinders: 2, euro: 'EURO 4' }), year: 2015 }, { ...spec({ model_year_id: '3', power_cv: 95, cylinders: 2 }), year: 2010 }],
      year: 2009, family: null,
    });
    expect(v.power_cv).toBe(95);
    expect(v.cylinders).toBe(2);
    expect(v.antipollution).toBeUndefined();
  });
});

describe('Compléter une fiche', () => {
  test('ne remplace jamais une valeur existante', () => {
    const r = fillEmptyVehicleFields({ color: 'BLANC', origin: null }, { color: 'ROUGE', origin: 'DUCBXL' }, null);
    expect(r.vehicle).toEqual({ color: 'BLANC', origin: 'DUCBXL' });
    expect(r.filled).toEqual(['origin']);
  });
  test('la facture passe avant le catalogue', () => {
    const r = fillEmptyVehicleFields({ power_cv: null }, { power_cv: 110 }, { power_cv: 95 });
    expect(r.vehicle.power_cv).toBe(110);
  });
  test('une moto bridée garde sa puissance à saisir', () => {
    const r = fillEmptyVehicleFields({ is_restricted: true, power_cv: null, power_kw: null, displacement: null }, null, { power_cv: 95, power_kw: 69.9, displacement: 1100 });
    expect(r.vehicle.power_cv).toBeNull();
    expect(r.vehicle.power_kw).toBeNull();
    expect(r.vehicle.displacement).toBe(1100);
  });
  test('une origine inconnue « ? » ne remplit rien', () => {
    expect(fillEmptyVehicleFields({ origin: null }, { origin: '?' }, null).filled).toEqual([]);
  });
});
