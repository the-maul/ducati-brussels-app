/**
 * Rattrapage G8 (18/11/2026, lot parc) — catalogue d'options par modele et « PV vehicule + options ».
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { optionsToLines, vehiclePlusOptions, groupOptions, suggestOptionModel, type VehicleOption } from '../src/modules/vehicles/options-rules';

const opt = (o: Partial<VehicleOption> & { code: string }): VehicleOption => ({
  id: o.code, model_id: 'm', group_code: null, label: o.code, purchase_price_ht: 0, sale_price_ttc: 0, vat_rate: 21, info: null, sort_order: 0, ...o,
});
const pub = opt({ code: 'PUB', label: 'Frais de publicite', purchase_price_ht: 30, sale_price_ttc: 60.5, sort_order: 2 });
const trp = opt({ code: 'TRP', label: 'Transport', purchase_price_ht: 150, sale_price_ttc: 242, sort_order: 1, group_code: 'FRAIS' });

describe('options -> lignes de vente', () => {
  test('une ligne par option, PU HT = PV TTC / 1,21, ordre du catalogue', () => {
    const lines = optionsToLines([pub, trp], 'Option : ');
    expect(lines.map((l) => l.designation)).toEqual(['Option : Transport', 'Option : Frais de publicite']);
    expect(lines[0]).toMatchObject({ unit_price_ht: 200, vat_rate: 21, quantity: 1, reference: 'TRP', article_id: null, line_type: 'article' });
    expect(lines[1].unit_price_ht).toBe(50);
  });
});

describe('PV vehicule + options', () => {
  test('DesertX 16 590 + transport 242 + publicite 60,50', () => {
    expect(vehiclePlusOptions(16590, [pub, trp])).toEqual({ optionsTtc: 302.5, optionsCostHt: 180, optionsMarginHt: 70, totalTtc: 16892.5 });
  });
  test('sans option', () => {
    expect(vehiclePlusOptions(1000, []).totalTtc).toBe(1000);
  });
});

describe('groupes et modele propose', () => {
  test('groupes alphabetiques, sans groupe en dernier', () => {
    expect(groupOptions([pub, trp]).map((g) => g.group)).toEqual(['FRAIS', '']);
  });
  test('modele relie a l\'article de la moto, sinon par code dans le libelle', () => {
    const models = [
      { id: '1', code: 'DESERTX', label: 'Desert X', article_id: 'art-dx' },
      { id: '2', code: 'MTS-V4', label: 'Multistrada V4', article_id: null },
    ];
    expect(suggestOptionModel(models, { articleId: 'art-dx' })?.id).toBe('1');
    expect(suggestOptionModel(models, { text: 'MULTISTRADA V4 S RED' })?.id).toBe('2');
    expect(suggestOptionModel(models, { text: 'Panigale' })).toBeNull();
  });
});
