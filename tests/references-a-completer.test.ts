import { describe, expect, test } from 'bun:test';
import { kitPartsToComplete } from '../src/modules/workshop/parts-popup-rules';
import { dcsOrigin, dcsOwnerMatches } from '../src/lib/myducati';

const line = (designation: string, confidence: 'sur' | 'a_confirmer' | 'absent') => ({
  articleId: null, reference: null, designation, quantity: 1, realQty: 0, reservedQty: 0, onOrderQty: 0, confidence,
});

describe('Pièces à compléter', () => {
  test('seules les lignes sans référence sont annoncées, une seule fois', () => {
    expect(kitPartsToComplete([
      line('JOINT DE BOUCHON DE VIDANGE', 'absent'), line('JOINT DE BOUCHON DE VIDANGE', 'absent'), line('FILTRE A HUILE', 'sur'),
    ])).toEqual(['JOINT DE BOUCHON DE VIDANGE']);
  });
});

describe('Origine de la moto depuis le DCS', () => {
  test('Garantie activée par passe en premier', () => {
    expect(dcsOrigin('100645 ITALBIKE STORE', '106767 DUCATI AARSCHOT')).toBe('100645 ITALBIKE STORE');
  });
  test('sinon Moto facturée à', () => {
    expect(dcsOrigin('', '106767 DUCATI AARSCHOT')).toBe('106767 DUCATI AARSCHOT');
    expect(dcsOrigin('-', '106767 DUCATI AARSCHOT')).toBe('106767 DUCATI AARSCHOT');
  });
  test('rien de connu : pas d\'origine', () => {
    expect(dcsOrigin('-', '-')).toBeUndefined();
    expect(dcsOrigin(null, undefined)).toBeUndefined();
  });
});

describe('Coordonnées DCS : seulement sur le bon client', () => {
  test('même nom, accents et ordre ignorés', () => {
    expect(dcsOwnerMatches('Sébastien NUNES', { last_name: 'NUNES' })).toBe(true);
    expect(dcsOwnerMatches('JEAN LEFÈVRE', { last_name: 'Lefevre' })).toBe(true);
  });
  test('société reconnue par sa raison sociale', () => {
    expect(dcsOwnerMatches('MOTO STORE SA', { company_name: 'GARAGE MOTO STORE' })).toBe(true);
  });
  test('autre personne ou nom absent : non', () => {
    expect(dcsOwnerMatches('PAUL MARTIN', { last_name: 'DUPONT' })).toBe(false);
    expect(dcsOwnerMatches('', { last_name: 'DUPONT' })).toBe(false);
  });
});
