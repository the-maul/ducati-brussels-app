/**
 * Constats du test a l'ecran du 20/11/2026 (lot-parcours-fix) : regles pures.
 *  - 7 : le releve affiche sous le km de l'OR rejoint le bandeau (km de cet OR a defaut d'un releve anterieur) ;
 *  - 9 : operateur sans compte venu d'un RDV = « compagnon sans compte », pas « saisi a la main ».
 * Execution : `bun test`.
 */
import { describe, test, expect } from 'bun:test';
import { displayedReading, lastReading, type MileageReading } from '../src/modules/workshop/or-base/rules';
import { legacyOperatorKind } from '../src/modules/workshop/or-page-rules';
import { journeyLineInputs } from '../src/modules/workshop/journey/api';
import { findingsToOrLines, serviceOfficialMinutes } from '../src/modules/workshop/journey/rules';
import { serviceKindOf } from '../src/modules/workshop/service-code';

const or = { id: 'or1', number: 'TESTOR-2026-00001', mileage: 24500, created_at: '2026-11-20T11:15:44Z' };

test('7. premier releve de la moto porte par cet OR : affiche (avant « Aucun relevé connu »)', () => {
  // la fiche moto a ete mise a jour PAR cet OR (apres sa creation) et l'OR lui-meme est exclu du controle
  const readings: MileageReading[] = [
    { km: 24500, at: '2026-11-20T11:15:44Z', source: 'or', ref: 'TESTOR-2026-00001', orId: 'or1' },
    { km: 24500, at: '2026-11-20T11:16:00Z', source: 'vehicle' },
  ];
  const last = lastReading(readings, or.id, or.created_at);
  expect(last).toBeNull();
  expect(displayedReading(last, or)).toEqual({ km: 24500, at: or.created_at, source: 'or', ref: 'TESTOR-2026-00001', orId: 'or1' });
});

test('7. un releve anterieur reste prioritaire ; OR sans km ou nouveau : rien', () => {
  const prev: MileageReading = { km: 20000, at: '2026-05-01T10:00:00Z', source: 'or', ref: 'OR-1', orId: 'or0' };
  expect(displayedReading(prev, or)).toBe(prev);
  expect(displayedReading(null, { ...or, mileage: null })).toBeNull();
  expect(displayedReading(null, { ...or, mileage: 0 })).toBeNull();
  expect(displayedReading(null, null)).toBeNull();
});

test('9. operateur texte = fiche compagnon sans compte → compagnon ; sinon texte libre', () => {
  const crew = [{ name: 'John', user_id: null }, { name: 'Simon', user_id: 'u1' }, { name: 'Lívio', user_id: null }];
  expect(legacyOperatorKind('John', crew)).toBe('mechanic');
  expect(legacyOperatorKind(' john ', crew)).toBe('mechanic');
  expect(legacyOperatorKind('Livio', crew)).toBe('mechanic');
  expect(legacyOperatorKind('ENTRETIEN', crew)).toBe('typed');
  // fiche reliee a un compte : l'ecran choisit le compte, le texte seul reste « saisi a la main »
  expect(legacyOperatorKind('Simon', crew)).toBe('typed');
  expect(legacyOperatorKind('', crew)).toBe('typed');
  expect(legacyOperatorKind('John', [])).toBe('typed');
});

test('10. /workshop/mon-atelier : renvoye vers Mon atelier, jamais pris pour un n° d\'OR', async () => {
  const { isOrRouteId, workshopPathAlias } = await import('../src/modules/workshop/or-base/route-id');
  expect(workshopPathAlias('mon-atelier')).toBe('/workshop/my-workshop');
  expect(workshopPathAlias('Mon-Atelier')).toBe('/workshop/my-workshop');
  expect(workshopPathAlias('481574f5-a183-46f9-9dfb-300ba70614b5')).toBeNull();
  expect(workshopPathAlias('%E0%A4%A')).toBeNull();
  expect(isOrRouteId('481574f5-a183-46f9-9dfb-300ba70614b5')).toBe(true);
  expect(isOrRouteId('mon-atelier')).toBe(false);
  expect(isOrRouteId('')).toBe(false);
});

// ---------------------------------------------------------------------------
// Constat 5 : pièces relevées dans le parcours → prix du tarif (plus à 0 €)
// Constat 2 : temps Ducati d'un entretien (repli de la MO forfaitaire)
// ---------------------------------------------------------------------------

describe('parcours : pièces à ajouter au prix du tarif (constat 5)', () => {
  const proposed = findingsToOrLines([
    { id: 'f1', kind: 'piece', operationId: 'op1', stepNo: null, reference: '44440034a', texte: 'Filtre', quantity: 1, at: '2026-11-20T10:00:00Z' },
    { id: 'f2', kind: 'piece', operationId: 'op1', stepNo: null, reference: 'INCONNUE', texte: 'Joint', quantity: 2, at: '2026-11-20T10:00:00Z' },
    { id: 'f3', kind: 'observation', operationId: 'op1', stepNo: null, texte: 'Pneu AR limite', at: '2026-11-20T10:00:00Z' },
  ] as never);
  const lines = journeyLineInputs(proposed, [{ id: 'a1', reference: '44440034A', designation: 'FILTRE A HUILE', vat_rate: 21 }], new Map([['a1', 11.29]]));
  test('référence connue (casse ignorée) : article relié, prix catalogue', () => {
    expect(lines[0]).toMatchObject({ kind: 'piece', article_id: 'a1', designation: 'FILTRE A HUILE', unit_price_ht: 11.29, quantity: 1 });
  });
  test('référence inconnue : reste à 0 €, sans article', () => {
    expect(lines[1]).toMatchObject({ kind: 'piece', article_id: null, unit_price_ht: 0, quantity: 2 });
  });
  test('observation : ligne texte', () => {
    expect(lines[2]).toMatchObject({ kind: 'texte', designation: 'Pneu AR limite' });
  });
});

describe('temps Ducati d\'un entretien (constat 2, repli du forfait)', () => {
  const prog = {
    services: [
      { service: 'Oil Service 15000 km', km: 15000, operations: [] },
      { service: 'Annual Service', mois: 12, operations: [] },
      { service: 'Desmo Service 30000 km', km: 30000, operations: [] },
    ],
    temps: [{ intitule: 'OIL SERVICE', ut: 15 }, { intitule: 'ANNUAL SERVICE', minutes: 48 }, { intitule: 'DESMO SERVICE', ut: 40 }],
  };
  test('oil → temps OIL SERVICE (15 UT = 90 min)', () => {
    expect(serviceOfficialMinutes(prog as never, 'oil', serviceKindOf)).toBe(90);
  });
  test('annual → 48 min ; entretien absent → null', () => {
    expect(serviceOfficialMinutes(prog as never, 'annual', serviceKindOf)).toBe(48);
    expect(serviceOfficialMinutes(prog as never, 'first_1000', serviceKindOf)).toBeNull();
    expect(serviceOfficialMinutes(null, 'oil', serviceKindOf)).toBeNull();
  });
});
