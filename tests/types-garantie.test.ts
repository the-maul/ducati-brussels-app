import { describe, expect, test } from 'bun:test';
import { dcsWarrantyType, FOUR_EVER_WARRANTY, isCarGarantie, isFourEverEligible, warrantyPlanFor, warrantyTypesFor } from '../src/modules/vehicles/warranty-types';

describe('Type de garantie', () => {
  test('la formule ne vaut que pour CarGarantie', () => {
    expect(warrantyPlanFor('CarGarantie', 'EverRed (24 mois)')).toBe('EverRed (24 mois)');
    expect(warrantyPlanFor('Factory Ever Red +12', 'EverRed (24 mois)')).toBeNull();
    expect(warrantyPlanFor('CarGarantie', '')).toBeNull();
  });
  test('CarGarantie reconnue sans tenir compte des majuscules', () => {
    expect(isCarGarantie(' cargarantie ')).toBe(true);
    expect(isCarGarantie('Conventionnelle (24 mois)')).toBe(false);
  });
  test('le DCS met à jour le type', () => {
    expect(dcsWarrantyType('Factory Ever Red +24', 'Conventionnelle (24 mois)')).toBe('Factory Ever Red +24');
  });
  test('le DCS ne remplace pas une CarGarantie', () => {
    expect(dcsWarrantyType('Conventionnelle (24 mois)', 'CarGarantie')).toBeUndefined();
  });
  test('un tiret du DCS ne vaut rien', () => {
    expect(dcsWarrantyType('-', null)).toBeUndefined();
  });
});

describe('4Ever Ducati', () => {
  test('Multistrada à partir de 2020', () => {
    expect(isFourEverEligible({ category: 'MULTISTRADA', model_year: 2020 })).toBe(true);
    expect(isFourEverEligible({ model: 'MULTISTRADA V4 S', model_year: '2024' })).toBe(true);
    expect(isFourEverEligible({ category: 'MULTISTRADA', model_year: 2019 })).toBe(false);
  });
  test('Multistrada sans année connue : non proposé', () => {
    expect(isFourEverEligible({ category: 'MULTISTRADA', model_year: '' })).toBe(false);
  });
  test('DesertX, toute année', () => {
    expect(isFourEverEligible({ category: 'DESERT X', model_year: 2022 })).toBe(true);
    expect(isFourEverEligible({ model: 'DESERTX RALLY' })).toBe(true);
  });
  test('autres familles : non proposé', () => {
    expect(isFourEverEligible({ category: 'MONSTER', model_year: 2024 })).toBe(false);
    expect(warrantyTypesFor({ category: 'MONSTER', model_year: 2024 })).not.toContain(FOUR_EVER_WARRANTY);
  });
  test('placé avant CarGarantie', () => {
    const list = warrantyTypesFor({ category: 'DESERT X' });
    expect(list[list.length - 2]).toBe(FOUR_EVER_WARRANTY);
    expect(list[list.length - 1]).toBe('CarGarantie');
  });
});
