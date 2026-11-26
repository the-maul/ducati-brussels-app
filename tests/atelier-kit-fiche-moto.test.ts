/**
 * ATE014 — Pièces du kit sur la fiche moto : règles pures du bloc « Pièces du kit ».
 * Exécution : `bun test`.
 */
import { describe, test, expect } from 'bun:test';
import { availableQty, defaultServiceForDue, distinctKitIds, kitQtyLabel, serviceChoices } from '../src/modules/workshop/kits/vehicle-kit-rules';

describe('kit sur la fiche moto', () => {
  test("l'entretien dû est montré d'abord ; une échéance au km seul ouvre l'entretien annuel", () => {
    expect(defaultServiceForDue('oil')).toBe('oil');
    expect(defaultServiceForDue('first_1000')).toBe('first_1000');
    expect(defaultServiceForDue('km')).toBe('annual');
    expect(defaultServiceForDue(null)).toBe('annual');
    expect(serviceChoices('oil')).toEqual(['oil', 'annual', 'first_1000', 'desmo']);
  });

  test("quantité avec l'unité de l'huile, sans unité pour une pièce", () => {
    expect(kitQtyLabel(3.4, 'l')).toBe('3,4 l');
    expect(kitQtyLabel('2', null)).toBe('2');
    expect(kitQtyLabel(1, '  ')).toBe('1');
  });

  test('un lien par kit, dans l’ordre, sans doublon ni ligne hors kit', () => {
    expect(distinctKitIds([{ kit_id: 'a' }, { kit_id: 'b' }, { kit_id: 'a' }, { kit_id: null }])).toEqual(['a', 'b']);
  });

  test('disponible = réel − réservé, seulement pour une pièce stockée', () => {
    expect(availableQty({ mgmtType: 'A', realQty: 5, reservedQty: 2 })).toBe(3);
    expect(availableQty({ mgmtType: 'T', realQty: 0, reservedQty: 0 })).toBeNull();
    expect(availableQty(undefined)).toBeNull();
  });
});
