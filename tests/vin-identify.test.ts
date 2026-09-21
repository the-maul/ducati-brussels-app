/**
 * Mission 06, carte 4 — reconnaissance de la moto par son VIN (fonctions pures).
 * VIN fictifs (aucun VIN de client). Exécution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildVinPatterns, ducatiCommercialName, identifyVin, isDucatiFullVin, isFullVin, mergeVinSuggestions,
  normalizeEuro, rankPatternCandidates, vinBrand, vinCandidateLabel, vinNeedsChoice, vinPatternKey,
  vinSerial, vinSuggestedFields, vinYear, UNIQUE_MIN_SAMPLES,
  type CatalogYear, type VinIdentifyResult,
} from '../src/lib/vin-identify';

// VIN fictif : ZDM + K100AA (descripteur) + G (2016) + B (Bologne) + n° de série.
const vin = (vds: string, year: string, serial: number) => `ZDM${vds}${year}B${String(serial).padStart(6, '0')}`;

describe('décodage', () => {
  test('VIN complet : 17 caractères, sans I, O, Q', () => {
    expect(isFullVin('ZDMK100AAGB012345')).toBe(true);
    expect(isFullVin('zdm-k100aa gb012345')).toBe(true);
    expect(isFullVin('ZDMK100AAGB01234')).toBe(false);
    expect(isFullVin('ZDMK100OAGB012345')).toBe(false);
    expect(isDucatiFullVin('ZDMK100AAGB012345')).toBe(true);
    expect(isDucatiFullVin('JYARN23E0AA000001')).toBe(false);
  });

  test('année du 10e caractère, cycle de 30 ans', () => {
    expect(vinYear('G', 2026)).toBe(2016);
    expect(vinYear('T', 2026)).toBe(2026);
    expect(vinYear('V', 2026)).toBe(2027); // millésime suivant vendu dès l'automne
    expect(vinYear('1', 2026)).toBe(2001); // pas 2031
    expect(vinYear('9', 2026)).toBe(2009);
    expect(vinYear('Y', 2026)).toBe(2000);
    expect(vinYear('A', 2026)).toBe(2010);
    expect(vinYear('A', 2040)).toBe(2040);
    expect(vinYear('I', 2026)).toBeNull();
    expect(vinYear('', 2026)).toBeNull();
  });

  test('clé de motif = caractères 1 à 9 + année ; n° de série', () => {
    expect(vinPatternKey('ZDMK100AAGB012345')).toBe('ZDMK100AAG');
    expect(vinPatternKey('ZDMK100AAGB01234')).toBeNull();
    expect(vinSerial('ZDMK100AAGB012345')).toBe(12345);
    expect(vinSerial('ZDMK100AAGBA12345')).toBeNull();
  });

  test('constructeur par le code WMI', () => {
    expect(vinBrand('ZDMK100AAGB012345')).toBe('Ducati');
    expect(vinBrand('JYARN23E0AA000001')).toBe('Yamaha');
    expect(vinBrand('XXX0000000A000001')).toBeNull();
  });
});

describe('table de correspondance', () => {
  test('une ligne par motif et modèle-année, plage de série arrondie à la centaine', () => {
    const rows = buildVinPatterns([
      { vin: vin('K100AA', 'G', 12345), modelYearId: 'icon16' },
      { vin: vin('K100AA', 'G', 12999), modelYearId: 'icon16' },
      { vin: vin('K100AA', 'G', 13050), modelYearId: 'classic16' },
      { vin: 'TROPCOURT', modelYearId: 'x' },
    ]);
    expect(rows).toEqual([
      { pattern: 'ZDMK100AAG', model_year_id: 'icon16', samples: 2, serial_from: 12300, serial_to: 12999 },
      { pattern: 'ZDMK100AAG', model_year_id: 'classic16', samples: 1, serial_from: 13000, serial_to: 13099 },
    ]);
    // Aucun VIN complet dans la table.
    expect(JSON.stringify(rows)).not.toContain('12345');
  });
});

describe('choix du candidat', () => {
  const row = (id: string, samples: number, from = 0, to = 999_999) =>
    ({ pattern: 'ZDMK100AAG', model_year_id: id, samples, serial_from: from, serial_to: to });

  test(`unique : un seul modèle-année vu au moins ${UNIQUE_MIN_SAMPLES} fois`, () => {
    const r = rankPatternCandidates(vin('K100AA', 'G', 1), [row('a', UNIQUE_MIN_SAMPLES)]);
    expect(r.confidence).toBe('unique');
    expect(r.candidates[0].model_year_id).toBe('a');
  });

  test('probable : un seul modèle-année peu vu', () => {
    expect(rankPatternCandidates(vin('K100AA', 'G', 1), [row('a', 2)]).confidence).toBe('probable');
  });

  test('probable : le n° de série ne tombe que dans la plage d\'un candidat, qui passe en tête', () => {
    const r = rankPatternCandidates(vin('K100AA', 'G', 15050), [row('a', 10, 0, 9999), row('b', 3, 15000, 15999)]);
    expect(r.confidence).toBe('probable');
    expect(r.candidates.map((c) => c.model_year_id)).toEqual(['b', 'a']);
    expect(r.candidates[0].in_range).toBe(true);
  });

  test('plusieurs : plages qui se recouvrent, classement par fréquence', () => {
    const r = rankPatternCandidates(vin('K100AA', 'G', 500), [row('a', 3), row('b', 7)]);
    expect(r.confidence).toBe('plusieurs');
    expect(r.candidates.map((c) => c.model_year_id)).toEqual(['b', 'a']);
    expect(r.candidates[0].share).toBeCloseTo(0.7);
  });

  test('hors plage : le plus proche d\'abord', () => {
    const r = rankPatternCandidates(vin('K100AA', 'G', 20000), [row('a', 9, 0, 999), row('b', 1, 18000, 18999)]);
    expect(r.confidence).toBe('plusieurs');
    expect(r.candidates[0].model_year_id).toBe('b');
  });

  test('motif inconnu', () => {
    expect(rankPatternCandidates(vin('K100AA', 'G', 1), []).confidence).toBeNull();
  });
});

describe('reconnaissance avec replis', () => {
  const catalog = new Map<string, CatalogYear>([
    ['icon16', { id: 'icon16', model_id: 'icon', supermodel_id: 's800', family_id: 'scr', year: 2016 }],
    ['classic16', { id: 'classic16', model_id: 'classic', supermodel_id: 's800', family_id: 'scr', year: 2016 }],
    ['icon19', { id: 'icon19', model_id: 'icon', supermodel_id: 's800', family_id: 'scr', year: 2019 }],
    ['classic19', { id: 'classic19', model_id: 'classic', supermodel_id: 's800', family_id: 'scr', year: 2019 }],
    ['s1100_19', { id: 's1100_19', model_id: 's1100', supermodel_id: 's1100', family_id: 'scr', year: 2019 }],
  ]);
  const rows = buildVinPatterns([
    ...Array.from({ length: 6 }, (_, i) => ({ vin: vin('K100AA', 'G', 100 + i), modelYearId: 'icon16' })),
    { vin: vin('K100AA', 'F', 50), modelYearId: 'icon16' },
    { vin: vin('K100AA', 'F', 60), modelYearId: 'classic16' },
    { vin: vin('K102AA', 'K', 10), modelYearId: 's1100_19' },
  ]);

  test('motif exact unique', () => {
    const r = identifyVin(vin('K100AA', 'G', 103), rows, catalog, 2026);
    expect(r).toMatchObject({ confidence: 'unique', modelYearId: 'icon16', familyId: 'scr', supermodelId: 's800' });
  });

  test('motif exact à plusieurs versions : pas de modèle-année retenu, cylindrée commune', () => {
    const r = identifyVin(vin('K100AA', 'F', 55), rows, catalog, 2026);
    expect(r.confidence).toBe('plusieurs');
    expect(r.modelYearId).toBeNull();
    expect(r.candidates.sort()).toEqual(['classic16', 'icon16']);
    expect(r.supermodelId).toBe('s800');
  });

  test('descripteur vu d\'autres années : modèles projetés sur l\'année du VIN', () => {
    const r = identifyVin(vin('K100AA', 'K', 1), rows, catalog, 2026);
    expect(r.confidence).toBe('modele');
    expect(r.candidates).toEqual(['icon19', 'classic19']);
  });

  test('mêmes 6 premiers caractères : famille seule', () => {
    const r = identifyVin(vin('K10ZZZ', 'K', 1), rows, catalog, 2026);
    expect(r).toMatchObject({ confidence: 'famille', familyId: 'scr', candidates: [] });
  });

  test('rien de connu', () => {
    expect(identifyVin(vin('M99999', 'K', 1), rows, catalog, 2026).confidence).toBe('inconnu');
    expect(identifyVin('ZDM', rows, catalog, 2026).confidence).toBe('inconnu');
  });
});

describe('écran : nom commercial et remplissage', () => {
  test('nom commercial sans répétition', () => {
    expect(ducatiCommercialName('SCRAMBLER', '800', 'ICON')).toBe('SCRAMBLER 800 ICON');
    expect(ducatiCommercialName('MONSTER', '1200', '1200 S')).toBe('MONSTER 1200 S');
    expect(ducatiCommercialName('MULTISTRADA', 'MULTISTRADA V4', 'MULTISTRADA V4 S')).toBe('MULTISTRADA V4 S');
    expect(ducatiCommercialName('HYPERMOTARD', '821', 'HYPERMOTARD SP')).toBe('HYPERMOTARD 821 SP');
    expect(ducatiCommercialName('SUPERBIKE', '1299 Panigale', '1299S ABS')).toBe('PANIGALE 1299S ABS');
    expect(ducatiCommercialName('SUPERBIKE', '848', '848')).toBe('848');
    expect(ducatiCommercialName('DIAVEL', 'DIAVEL', 'Diavel')).toBe('DIAVEL');
    expect(ducatiCommercialName('SCRAMBLER', '800', null)).toBe('SCRAMBLER 800');
  });

  test('norme antipollution', () => {
    expect(normalizeEuro('EURO4')).toBe('EURO 4');
    expect(normalizeEuro('euro 5+')).toBe('EURO 5+');
    expect(normalizeEuro('/')).toBeNull();
  });

  test('jamais d\'écrasement : les champs remplis deviennent des conflits', () => {
    const r = mergeVinSuggestions(
      { brand: 'Ducati', model: 'MON SCRAMBLER', model_year: '', displacement: '803.0' },
      { brand: 'DUCATI', model: 'SCRAMBLER 800 ICON', model_year: 2016, displacement: 803 },
    );
    expect(r.filled).toEqual(['model_year']);
    expect(r.next.model_year).toBe('2016');
    expect(r.next.model).toBe('MON SCRAMBLER');
    expect(r.conflicts).toEqual({ model: 'SCRAMBLER 800 ICON' });
  });

  const result = (over: Partial<VinIdentifyResult>): VinIdentifyResult => ({
    vin: 'ZDMK100AAGB012345', valid: true, ducati: true, vin_year: 2016, confidence: 'plusieurs',
    model_year_id: null, family: 'SCRAMBLER', supermodel: '800', model: null, year: 2016,
    displacement_cc: 803, power_cv: 75, cylinders: 2, euro: 'EURO 4', maintenance_plans: [],
    candidates: [
      { model_year_id: 'icon16', family: 'SCRAMBLER', supermodel: '800', model: 'ICON', year: 2016, samples: 10, in_range: false, drawings_count: 40, displacement_cc: 803, power_cv: 75 },
      { model_year_id: 'ft16', family: 'SCRAMBLER', supermodel: '800', model: 'FULL THROTTLE', year: 2016, samples: 6, in_range: true, drawings_count: 41, displacement_cc: 803, power_cv: 75 },
    ],
    ...over,
  });

  test('plusieurs versions : seulement ce qui est commun, pas de version devinée', () => {
    const s = vinSuggestedFields(result({}));
    expect(s).toEqual({
      brand: 'Ducati', family: 'SCRAMBLER', model: 'SCRAMBLER 800', model_year: '2016',
      displacement: '803', power_cv: '75', cylinders: '2', antipollution: 'EURO 4',
    });
    expect(vinNeedsChoice(result({}))).toBe(true);
  });

  test('version choisie : son nom et ses caractéristiques', () => {
    const s = vinSuggestedFields(result({}), 'ft16');
    expect(s.model).toBe('SCRAMBLER 800 FULL THROTTLE');
    expect(vinCandidateLabel(result({}).candidates[1])).toBe('SCRAMBLER 800 FULL THROTTLE 2016');
  });

  test('reconnaissance unique : le modèle-année reconnu, pas de liste', () => {
    const r = result({ confidence: 'unique', model_year_id: 'icon16', model: 'ICON', candidates: result({}).candidates.slice(0, 1) });
    expect(vinSuggestedFields(r).model).toBe('SCRAMBLER 800 ICON');
    expect(vinNeedsChoice(r)).toBe(false);
  });

  test('autre constructeur : marque et année seulement', () => {
    const r = result({ vin: 'JYARN23E0AA000001', ducati: false, vin_year: 2010 });
    expect(vinSuggestedFields(r)).toEqual({ brand: 'Yamaha', model_year: '2010' });
  });
});
