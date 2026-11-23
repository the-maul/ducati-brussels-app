import { describe, expect, test } from 'bun:test';
import { dcsWarrantyType, isCarGarantie, warrantyPlanFor } from '../src/modules/vehicles/warranty-types';

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
