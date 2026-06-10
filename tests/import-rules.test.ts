/**
 * Tests du moteur d'import des tarifs (M2, INV013) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { diffRow, buildDiff, round3, type ExistingArticle, type ImportRow } from '../src/modules/articles/import/rules';

const existing = (over: Partial<ExistingArticle> = {}): ExistingArticle => ({
  id: 'a1',
  reference: 'REF1',
  designation: 'Ancienne désignation',
  brand: 'Ducati',
  category_path: 'Pièces',
  supplier_ref: 'F-001',
  purchase_price: 10,
  sale_price_ttc: 100,
  coefficient: 2,
  superseded_by_id: null,
  is_library: false,
  ...over,
});

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  reference: 'REF1',
  rowIndex: 1,
  ...over,
});

test('nouvelle référence → création en librairie, PA arrondi 3 décimales', () => {
  const r = diffRow(row({ reference: 'NEW1', purchase_price: 12.34567, sale_price_ttc: 50 }), null);
  expect(r.action).toBe('create');
  expect(r.patch.is_library).toBe(true);
  expect(r.patch.purchase_price).toBe(12.346);
});

test('PV à la hausse → mis à jour', () => {
  const r = diffRow(row({ sale_price_ttc: 120 }), existing());
  expect(r.action).toBe('update');
  expect(r.patch.sale_price_ttc).toBe(120);
});

test('PV à la baisse → conservé + anomalie, jamais dans le patch', () => {
  const r = diffRow(row({ sale_price_ttc: 80 }), existing());
  expect(r.patch.sale_price_ttc).toBeUndefined();
  expect(r.anomalies.some((a) => a.includes('baisse'))).toBe(true);
});

test('coefficient existant JAMAIS écrasé', () => {
  const r = diffRow(row({ coefficient: 5, purchase_price: 11 }), existing());
  expect(r.patch.coefficient).toBeUndefined();
});

test('référence remplacée → non recréée, proposée en équivalence', () => {
  const r = diffRow(row({ purchase_price: 11 }), existing({ superseded_by_id: 'a2' }));
  expect(r.action).toBe('skip');
  expect(r.patch._suggest_equivalence).toBe('a2');
  expect(r.anomalies.some((a) => a.includes('remplacée'))).toBe(true);
});

test('accepte les changements désignation / PA / fournisseur / marque / rayon', () => {
  const r = diffRow(
    row({ designation: 'Nouvelle', purchase_price: 15, supplier_ref: 'F-999', brand: 'Rizoma', category_path: 'Accessoires' }),
    existing(),
  );
  expect(r.patch.designation).toBe('Nouvelle');
  expect(r.patch.purchase_price).toBe(15);
  expect(r.patch.supplier_ref).toBe('F-999');
  expect(r.patch.brand).toBe('Rizoma');
  expect(r.patch.category_path).toBe('Accessoires');
});

test('aucun changement → action skip', () => {
  const r = diffRow(row({ designation: 'Ancienne désignation', purchase_price: 10, sale_price_ttc: 100 }), existing());
  expect(r.action).toBe('skip');
  expect(r.changes.length).toBe(0);
});

test('référence vide → ignorée', () => {
  const r = diffRow(row({ reference: '  ' }), null);
  expect(r.action).toBe('skip');
});

test('référence en double dans le fichier → anomalie', () => {
  const map = new Map([['REF1', existing()]]);
  const diff = buildDiff([row({ sale_price_ttc: 110 }), row({ sale_price_ttc: 120, rowIndex: 2 })], map);
  expect(diff[1].anomalies.some((a) => a.includes('double'))).toBe(true);
});

test('round3 arrondit correctement', () => {
  expect(round3(1.23456)).toBe(1.235);
  expect(round3(0.0004)).toBe(0);
});
