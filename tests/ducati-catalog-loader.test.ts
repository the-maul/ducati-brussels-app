/**
 * Mission 06 — chargeur des fichiers d'extraction du catalogue Ducati
 * (tools/catalog-loader/transform.mjs) sur l'extrait fictif tests/fixtures/catalogue-ducati.
 * La chaîne complète (SQL généré → fonctions d'import) est essayée en base dans une transaction
 * annulée : node tools/catalog-loader/load.mjs --dir tests/fixtures/catalogue-ducati --sql x.sql --rollback
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyFiles, nestTree, slimGroupsFile, slimDrawingsFile, chunk, dollarQuote, isAlreadyLoaded,
} from '../tools/catalog-loader/transform.mjs';

const DIR = join(import.meta.dir, 'fixtures', 'catalogue-ducati');
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

describe('fichiers', () => {
  test('reconnaît et trie arbre, groupes, planches', () => {
    const c = classifyFiles([...readdirSync(DIR), 'catalogue-ducati-groupes-010.json', 'catalogue-ducati-accessoires-001.json', 'catalogue-ducati-chargement.json', 'autre.json']);
    expect(c.tree).toBe('catalogue-ducati-arbre.json');
    expect(c.groups).toEqual(['catalogue-ducati-groupes-001.json', 'catalogue-ducati-groupes-002.json', 'catalogue-ducati-groupes-010.json']);
    expect(c.drawings).toEqual(['catalogue-ducati-planches-001.json', 'catalogue-ducati-planches-002.json']);
    expect(c.other).toEqual(['catalogue-ducati-accessoires-001.json']);
  });
  test('un fichier inchangé n’est pas rechargé', () => {
    const ledger = { 'a.json': { size: 10, mtimeMs: 5 } };
    expect(isAlreadyLoaded(ledger, 'a.json', { size: 10, mtimeMs: 5 })).toBe(true);
    expect(isAlreadyLoaded(ledger, 'a.json', { size: 11, mtimeMs: 5 })).toBe(false);
    expect(isAlreadyLoaded(ledger, 'b.json', { size: 10, mtimeMs: 5 })).toBe(false);
  });
});

describe('arbre à plat → imbriqué', () => {
  const r = nestTree(read('catalogue-ducati-arbre.json'));
  test('familles → cylindrées → modèles → millésimes, ids en texte, nom de variante gardé', () => {
    expect(r.counts).toEqual({ families: 2, superModels: 2, models: 3, modelYears: 4 });
    const monster = r.tree.families[0].superModels[0].models[0];
    expect(monster).toMatchObject({ id: '298', description: 'MONSTER', order: 1, market: 'EU', isEurope: true });
    expect(monster.modelYears[0]).toEqual({ id: '45968', code: 'M937 21', year: 2021, path: '106/125/298/45968', name: 'MONSTER 937 21 STD' });
    expect(r.tree.families[1].superModels[0].models[0].modelYears[0].year).toBe(2023);
    expect(r.warnings).toEqual([]);
  });
  test('références cassées et modèle hors Europe signalés', () => {
    const bad = nestTree({
      families: [{ id: 1, description: 'F' }],
      superModels: [{ id: 2, family: 1, description: 'S' }, { id: 3, family: 9, description: 'X' }],
      models: [{ id: 4, superModel: 2, description: 'ICON USA' }],
      modelYears: [{ id: 5, model: 4, year: 2020 }, { id: 6, model: 7, year: 2020 }],
    });
    expect(bad.tree.families[0].superModels[0].models[0]).toMatchObject({ market: 'USA', isEurope: false });
    expect(bad.warnings.length).toBe(3);
  });
});

describe('groupes et planches', () => {
  test('groupes : lien modèle-année ↔ planches conservé', () => {
    const g = slimGroupsFile(read('catalogue-ducati-groupes-001.json'));
    expect(g.map((x) => x.modelYear)).toEqual(['45968', '45969', '99999']);
    expect(g[0].groups[0].drawings.map((d) => d.id)).toEqual(['9001', '9002']);
  });
  test('planches : une seule fois par id, champs utiles seulement (itemId compris)', () => {
    const list = [...read('catalogue-ducati-planches-001.json'), { ...read('catalogue-ducati-planches-001.json')[0], description: 'GUIDON (v2)', basket: { secret: 1 } }];
    const d = slimDrawingsFile(list);
    expect(d.map((x) => x.id)).toEqual(['9001', '9002']);
    expect(d[0].description).toBe('GUIDON (v2)');
    expect(Object.keys(d[0])).not.toContain('basket');
    expect(d[0].parts[0].itemId).toBe('IT-1');
    expect(d[0].hotspots).toHaveLength(2);
  });
  test('paquets et SQL', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(dollarQuote('{"a":"b"}')).toBe('$j${"a":"b"}$j$');
    expect(dollarQuote('x $j$ y')).toBe('$jx$x $j$ y$jx$');
  });
});
