import { describe, expect, test } from 'bun:test';
import { contactNameLastFirst, quickClientNames, vehiclesFirst } from '../src/modules/contacts/search-order';
import { lowerReadingSource } from '../src/modules/workshop/or-base/lower-mileage';
import type { MileageReading } from '../src/modules/workshop/or-base/rules';
import { sheetInputValue, sheetMissingCount, sheetParseValue, vehicleSheetGroups } from '../src/modules/workshop/planning/vehicle-sheet';

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

describe('Kilométrage inférieur : source du relevé', () => {
  const r = (km: number, at: string, ref: string) => ({ km, at, ref }) as unknown as MileageReading;
  test('retrouve l\'OR qui porte le relevé', () => {
    const src = lowerReadingSource([r(1100, '2026-11-19T09:00:00Z', 'OR-2026-00004'), r(250000, '2026-11-19T10:00:00Z', 'OR-2026-00005')], 250000);
    expect(src?.ref).toBe('OR-2026-00005');
  });
  test('même km sur deux OR : le plus récent', () => {
    const src = lowerReadingSource([r(9000, '2026-01-01T09:00:00Z', 'OR-A'), r(9000, '2026-03-01T09:00:00Z', 'OR-B')], 9000);
    expect(src?.ref).toBe('OR-B');
  });
  test('source introuvable : rien', () => {
    expect(lowerReadingSource([r(1100, '2026-11-19T09:00:00Z', 'OR-A')], 250000)).toBeNull();
  });
});

describe('Fiche de la moto modifiable dans le rendez-vous', () => {
  const words = { yes: 'Oui', no: 'Non' };
  const field = (key: string) => vehicleSheetGroups({}, words).flatMap((g) => g.fields).find((f) => f.key === key)!;
  test('le VIN et le dernier km restent en lecture', () => {
    expect(field('vin').input).toBe('read');
    expect(field('last_visit').input).toBe('read');
  });
  test('un nombre, une date et un champ vidé', () => {
    expect(sheetParseValue(field('displacement'), '1100')).toBe(1100);
    expect(sheetParseValue(field('model_year'), '2009')).toBe(2009);
    expect(sheetParseValue(field('first_registration_date'), '2020-03-15')).toBe('2020-03-15');
    expect(sheetParseValue(field('engine_number'), '  ')).toBeNull();
  });
  test('valeur affichée dans la zone de saisie', () => {
    expect(sheetInputValue(field('displacement'), { displacement: '1100.0' })).toBe('1100');
    expect(sheetInputValue(field('warranty_end'), { warranty_end: '2027-01-02T00:00:00Z' })).toBe('2027-01-02');
  });
});

describe('Nom du client dans les listes de choix', () => {
  test('particulier : nom puis prénom', () => {
    expect(contactNameLastFirst({ type: 'particulier', first_name: 'VITTORIO', last_name: 'MORELLATO', company_name: 'MORELLATO' })).toBe('MORELLATO VITTORIO');
  });
  test('société : raison sociale', () => {
    expect(contactNameLastFirst({ type: 'societe', company_name: 'TURISMO SA', first_name: 'A', last_name: 'B' })).toBe('TURISMO SA');
  });
  test('sans nom : tiret', () => {
    expect(contactNameLastFirst({})).toBe('—');
  });
});
