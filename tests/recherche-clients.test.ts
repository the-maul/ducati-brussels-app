import { describe, expect, test } from 'bun:test';
import { quickClientNames, vehiclesFirst } from '../src/modules/contacts/search-order';
import { sheetMissingCount, vehicleSheetGroups } from '../src/modules/workshop/planning/vehicle-sheet';

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

describe('Nouveau client depuis le rendez-vous', () => {
  test('la recherche préremplit nom puis prénom', () => {
    expect(quickClientNames('  dupont  jean marc ')).toEqual({ last: 'DUPONT', first: 'JEAN MARC' });
  });
  test('un numéro ou un e-mail ne préremplit rien', () => {
    expect(quickClientNames('0496123456')).toEqual({ last: '', first: '' });
    expect(quickClientNames('a@b.be')).toEqual({ last: '', first: '' });
  });
});

describe('Fiche de la moto dans le rendez-vous', () => {
  const words = { yes: 'Oui', no: 'Non' };
  const value = (v: Record<string, string | number | boolean | null>, key: string) =>
    vehicleSheetGroups(v, words).flatMap((g) => g.fields).find((f) => f.key === key)?.value;
  test('valeurs lisibles, comme G8', () => {
    const v = { displacement: '1100.0', mileage: 8886, first_registration_date: '2020-03-15', is_restricted: false };
    expect(value(v, 'displacement')).toBe('1100');
    expect(value(v, 'last_visit')).toBe('8 886 km');
    expect(value(v, 'first_registration_date')).toBe('15/03/2020');
    expect(value(v, 'is_restricted')).toBe('Non');
  });
  test('un champ vide compte, sauf tracker, PIN et code d\'exposition', () => {
    const empty = sheetMissingCount(vehicleSheetGroups({}, words));
    const withOptional = sheetMissingCount(vehicleSheetGroups({ gps_tracker_id: 'X', pin_tracker: '1', exposition_code: 'E' }, words));
    expect(empty).toBe(withOptional);
    expect(sheetMissingCount(vehicleSheetGroups({ vin: 'ZDM' }, words))).toBe(empty - 1);
  });
});
