/**
 * Tests du champ Année (Du/Au) — parsing import + règles de diff (CLAUDE.md règle 7).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { parseYearRange, guessMapping, buildRows, parseCsv } from '../src/modules/articles/import/parse';
import { diffRow, type ExistingArticle } from '../src/modules/articles/import/rules';

test('parseYearRange : année seule, plages, formats variés', () => {
  expect(parseYearRange('2023')).toEqual({ from: 2023, to: null });
  expect(parseYearRange('2020-2023')).toEqual({ from: 2020, to: 2023 });
  expect(parseYearRange('2020/2023')).toEqual({ from: 2020, to: 2023 });
  expect(parseYearRange('de 2020 a 2023')).toEqual({ from: 2020, to: 2023 });
  expect(parseYearRange('2023-2020')).toEqual({ from: 2020, to: 2023 }); // bornes inversées corrigées
  expect(parseYearRange('MY24')).toEqual({ from: null, to: null });      // 2 chiffres : ignoré
  expect(parseYearRange('12023')).toEqual({ from: null, to: null });     // 5 chiffres : pas une année
  expect(parseYearRange('ref 4202388')).toEqual({ from: null, to: null });
  expect(parseYearRange('')).toEqual({ from: null, to: null });
  expect(parseYearRange(null)).toEqual({ from: null, to: null });
});

test('mapping auto : colonnes Année / Année fin / Year to / Millésime', () => {
  const m = guessMapping(['Référence', 'Désignation', 'Année', 'Année fin']);
  expect(m.year_from).toBe(2);
  expect(m.year_to).toBe(3);
  const m2 = guessMapping(['Ref', 'Millésime']);
  expect(m2.year_from).toBe(1);
  const m3 = guessMapping(['Ref', 'Year from', 'Year to']);
  expect(m3.year_from).toBe(1);
  expect(m3.year_to).toBe(2);
});

test('buildRows : plage dans « Du », colonne « Au » prioritaire (borne haute), réordonnancement', () => {
  const csv = parseCsv('Référence;Année\nA1;2020-2023\nA2;2021\nA3;');
  const rows = buildRows(csv, guessMapping(csv.headers));
  expect(rows[0]).toMatchObject({ year_from: 2020, year_to: 2023 });
  expect(rows[1]).toMatchObject({ year_from: 2021, year_to: null });
  expect(rows[2]).toMatchObject({ year_from: null, year_to: null });

  // Colonne « Au » contenant elle-même une plage : borne HAUTE retenue
  const csv2 = parseCsv('Référence;Année;Année fin\nB1;2019;2020-2023\nB2;2024;2020');
  const rows2 = buildRows(csv2, guessMapping(csv2.headers));
  expect(rows2[0]).toMatchObject({ year_from: 2019, year_to: 2023 });
  // Deux colonnes inversées (Du 2024 / Au 2020) : réordonnées
  expect(rows2[1]).toMatchObject({ year_from: 2020, year_to: 2024 });
});

const existing: ExistingArticle = {
  id: 'x', reference: 'A1', designation: 'Pignon', brand: 'Ducati', category_path: null,
  supplier_ref: 'A1', purchase_price: 10, sale_price_ttc: 20, coefficient: null,
  superseded_by_id: null, is_library: false, year_from: 2018, year_to: 2020,
};

test('diffRow : année posée à la création, rafraîchie à la mise à jour', () => {
  const created = diffRow({ reference: 'NEW', year_from: 2022, year_to: 2024, rowIndex: 2 }, null);
  expect(created.patch.year_from).toBe(2022);
  expect(created.patch.year_to).toBe(2024);

  const updated = diffRow({ reference: 'A1', year_from: 2019, year_to: 2021, rowIndex: 3 }, existing);
  expect(updated.action).toBe('update');
  expect(updated.patch.year_from).toBe(2019);
  expect(updated.patch.year_to).toBe(2021);

  const same = diffRow({ reference: 'A1', year_from: 2018, year_to: 2020, rowIndex: 4 }, existing);
  expect(same.action).toBe('skip'); // identique : aucun changement

  const absent = diffRow({ reference: 'A1', rowIndex: 5 }, existing);
  expect(absent.patch.year_from).toBeUndefined(); // pas de colonne année : rien d'écrasé
});
