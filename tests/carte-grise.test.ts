/**
 * Mission 04, carte 7 — mappage de la carte grise lue par Claude (read-id-doc, mode
 * « carte_grise ») vers les champs du formulaire véhicule, avec l'indice de confiance.
 * On ne peut pas tester avec une vraie carte grise : on teste la logique de mappage
 * sur des réponses types. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  CARTE_GRISE_KEYS, CARTE_GRISE_SCHEMA, kwToCv, mapCarteGrise, normalizeDate, normalizeEuro,
  normalizeEnergy, normalizePlate, parseNumber, type CarteGriseKey, type Confidence, type RawCarteGrise,
} from '../supabase/functions/_shared/carte-grise.ts';

const TODAY = new Date(Date.UTC(2026, 8, 19));

function raw(values: Partial<Record<CarteGriseKey, string | [string, Confidence]>>, isCert = true): RawCarteGrise {
  const fields = Object.fromEntries(CARTE_GRISE_KEYS.map((k) => {
    const v = values[k];
    if (v === undefined) return [k, { value: null, confidence: 'low' }];
    return Array.isArray(v) ? [k, { value: v[0], confidence: v[1] }] : [k, { value: v, confidence: 'high' }];
  })) as RawCarteGrise['fields'];
  return { is_registration_certificate: isCert, fields };
}

test('carte grise complète : chaque case va dans le bon champ, au format du formulaire', () => {
  const m = mapCarteGrise(raw({
    A: 'M-AWA 695', B: '14/03/2021', C11: 'MOREAU', C12: 'Simon', D1: 'Ducati', D2: '1A',
    D3: 'Multistrada V4 S', E: 'zdm 1a02bgmb009261', J: 'L3e', P1: '1.158', P2: '124,0',
    P3: 'Essence', R: 'rouge', V9: 'EURO 5',
  }), TODAY);
  expect(m.is_registration_certificate).toBe(true);
  expect(m.values).toEqual({
    vin: 'ZDM1A02BGMB009261', plate: 'M-AWA-695', first_registration_date: '2021-03-14',
    brand: 'DUCATI', model: 'MULTISTRADA V4 S', displacement: '1158', power_kw: '124',
    power_cv: '169', energy: 'ESSENCE', antipollution: 'EURO 5', color: 'ROUGE',
  });
  expect(m.confidence.vin).toBe('high');
  expect(m.holder).toBe('MOREAU Simon');
  expect(m.unmapped).toEqual([]);
});

test('la confiance donnée par Claude est reprise champ par champ', () => {
  const m = mapCarteGrise(raw({ E: ['ZDM1A02BGMB009261', 'medium'], D3: ['PANIGALE V4', 'low'] }), TODAY);
  expect(m.confidence).toEqual({ vin: 'medium', model: 'low' });
});

test('VIN douteux (pas 17 caractères, ou I/O/Q) : gardé mais confiance basse', () => {
  const m = mapCarteGrise(raw({ E: 'ZDM1A02BGMBOO9261' }), TODAY);
  expect(m.values.vin).toBe('ZDM1A02BGMBOO9261');
  expect(m.confidence.vin).toBe('low');
  expect(mapCarteGrise(raw({ E: 'ZDM750SS12345' }), TODAY).confidence.vin).toBe('low');
});

test('case vide ou illisible : aucun champ pré-rempli', () => {
  const m = mapCarteGrise(raw({ E: '   ', D1: 'DUCATI' }), TODAY);
  expect(m.values).toEqual({ brand: 'DUCATI' });
  expect(m.holder).toBeNull();
});

test("document qui n'est pas une carte grise : rien n'est renvoyé", () => {
  const m = mapCarteGrise(raw({ E: 'ZDM1A02BGMB009261', D1: 'DUCATI' }, false), TODAY);
  expect(m.is_registration_certificate).toBe(false);
  expect(m.values).toEqual({});
  expect(mapCarteGrise(null).values).toEqual({});
});

test('valeurs impossibles : non reprises, signalées dans « unmapped »', () => {
  const m = mapCarteGrise(raw({ B: '31/02/2021', P1: 'abc', P2: '9999', V9: '168/2013' }), TODAY);
  expect(m.values).toEqual({});
  expect(m.unmapped).toEqual([
    { code: 'B', raw: '31/02/2021' }, { code: 'P.1', raw: 'abc' },
    { code: 'P.2', raw: '9999' }, { code: 'V.9', raw: '168/2013' },
  ]);
});

test('plaque belge : 1-ABC-123 ou M-ABC-123 ; autre format gardé avec confiance moyenne', () => {
  expect(normalizePlate('mafh315')).toEqual({ value: 'M-AFH-315', suspicious: false });
  expect(normalizePlate('1 abc 123')).toEqual({ value: '1-ABC-123', suspicious: false });
  expect(normalizePlate('AB 123 CD')).toEqual({ value: 'AB 123 CD', suspicious: true });
  expect(mapCarteGrise(raw({ A: 'AB 123 CD' }), TODAY).confidence.plate).toBe('medium');
});

test('dates : JJ/MM/AAAA, JJ.MM.AAAA, AAAA-MM-JJ ; date future ou impossible refusée', () => {
  expect(normalizeDate('01.02.2019', TODAY)).toBe('2019-02-01');
  expect(normalizeDate('2019-2-1', TODAY)).toBe('2019-02-01');
  expect(normalizeDate('1/2/2019', TODAY)).toBe('2019-02-01');
  expect(normalizeDate('01/01/2030', TODAY)).toBeNull();
  expect(normalizeDate('29/02/2023', TODAY)).toBeNull();
});

test('nombres : milliers, virgule décimale, unité', () => {
  expect(parseNumber('1.262')).toBe(1262);
  expect(parseNumber('1262 cm3')).toBe(1262);
  expect(parseNumber('84,00')).toBe(84);
  expect(parseNumber('35 kW')).toBe(35);
  expect(parseNumber('x12')).toBeNull();
  expect(kwToCv(35)).toBe(48);
});

test('énergie (P.3) et norme (V.9) ramenées aux valeurs du DMS', () => {
  expect(normalizeEnergy('Benzine')).toBe('ESSENCE');
  expect(normalizeEnergy('ESS')).toBe('ESSENCE');
  expect(normalizeEnergy('Elektriciteit')).toBe('ÉLECTRIQUE');
  expect(normalizeEnergy('Hybride essence')).toBe('HYBRIDE');
  expect(normalizeEuro('Euro 5+')).toBe('EURO 5+');
  expect(normalizeEuro('EURO4')).toBe('EURO 4');
  expect(normalizeEuro('EU3')).toBe('EURO 3');
  expect(normalizeEuro('E5')).toBe('EURO 5');
  expect(normalizeEuro('EURO 2')).toBeNull();
});

test('le schéma demandé à Claude exige toutes les cases avec une confiance', () => {
  const fields = CARTE_GRISE_SCHEMA.properties.fields;
  expect([...fields.required].sort()).toEqual([...CARTE_GRISE_KEYS].sort());
  expect(fields.additionalProperties).toBe(false);
});

// ------------------------------------------------ application au formulaire (écran)
import { applyCgReading, type CgReading } from '../src/modules/vehicles/carte-grise-apply';

test("pré-remplissage : champs vides remplis, champ saisi différent jamais écrasé", () => {
  const reading: CgReading = {
    is_registration_certificate: true,
    values: { vin: 'ZDM1A02BGMB009261', brand: 'DUCATI', model: 'MONSTER', color: 'ROUGE' },
    confidence: { vin: 'high', brand: 'high', model: 'medium', color: 'low' },
    unmapped: [], holder: null,
  };
  const { next, filled, conflicts } = applyCgReading({ vin: '', brand: 'Ducati', model: 'PANIGALE', color: '', notes: 'x' }, reading);
  expect(next.vin).toBe('ZDM1A02BGMB009261');
  expect(next.color).toBe('ROUGE');
  expect(next.model).toBe('PANIGALE');           // pas écrasé
  expect(next.brand).toBe('Ducati');             // même valeur (casse près) : rien à signaler
  expect(filled.sort()).toEqual(['color', 'vin']);
  expect(conflicts).toEqual({ model: 'MONSTER' });
});
