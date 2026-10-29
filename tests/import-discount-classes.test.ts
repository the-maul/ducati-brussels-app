/**
 * Prix d'achat deduit de la classe de remise du tarif Ducati (M2, TAR007,
 * decision client du 29/10/2026). Execution : `bun test`.
 *
 *   PA HT = round2(prix catalogue HT x (1 - remise % / 100))
 */
import { test, expect } from 'bun:test';
import {
  diffRow, purchasePriceFromClass, resolveDiscountClass, DEFAULT_DISCOUNT_CLASSES, DEFAULT_IMPORT_SETTINGS,
  type ExistingArticle, type ImportRow, type DiscountClass,
} from '../src/modules/articles/import/rules';

const grid: DiscountClass[] = DEFAULT_DISCOUNT_CLASSES;

const existing = (over: Partial<ExistingArticle> = {}): ExistingArticle => ({
  id: 'a1',
  reference: 'REF1',
  designation: 'Piece',
  brand: 'Ducati',
  category_path: null,
  supplier_ref: 'REF1',
  purchase_price: 10,
  sale_price_ttc: 100,
  coefficient: null,
  superseded_by_id: null,
  is_library: false,
  price_purchase_locked: false,
  ...over,
});

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  reference: 'REF1',
  supplier_name: 'Ducati',
  rowIndex: 1,
  ...over,
});

test('classe B, prix catalogue 500 -> prix d achat 325 (35 %)', () => {
  const r = purchasePriceFromClass(500, 'B', 'Ducati', grid);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.price).toBe(325);

  const d = diffRow(row({ reference: 'NEW1', ppc_ht: 500, discount_group: 'B' }), null, { discountClasses: grid });
  expect(d.action).toBe('create');
  expect(d.patch.purchase_price).toBe(325);
  expect(d.patch.discount_group).toBe('B');
  expect(d.patch._pa_from_class).toBe(true);
  expect(d.anomalies).toEqual([]);
});

test('sans classe -> ligne vide de la grille, 25 %', () => {
  const r = purchasePriceFromClass(100, null, 'Ducati', grid);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.price).toBe(75);

  const d = diffRow(row({ ppc_ht: 100, discount_group: '' }), existing(), { discountClasses: grid });
  expect(d.action).toBe('update');
  expect(d.patch.purchase_price).toBe(75);
  expect(d.anomalies).toEqual([]);
});

test('classe Z inactive -> pas de prix d achat, anomalie lisible', () => {
  const r = purchasePriceFromClass(100, 'Z', 'Ducati', grid);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('inactive');

  const d = diffRow(row({ ppc_ht: 100, discount_group: 'Z' }), existing(), { discountClasses: grid });
  expect(d.patch.purchase_price).toBeUndefined();
  expect(d.anomalies.some((a) => a.startsWith('Classe de remise Z inactive'))).toBe(true);
  // L'article existant garde son PA : seul le PPC est rafraichi.
  expect(d.changes.map((c) => c.field)).toEqual(['ppc_ht']);
});

test('classe inconnue dans la grille -> anomalie « inconnue », pas de prix d achat', () => {
  const d = diffRow(row({ reference: 'NEW2', ppc_ht: 100, discount_group: 'K' }), null, { discountClasses: grid });
  expect(d.patch.purchase_price).toBeUndefined();
  expect(d.anomalies).toContain("Classe de remise K inconnue : prix d'achat non calculé.");
});

test('verrou G8 sur le prix d achat -> inchange, meme avec une classe valable', () => {
  const d = diffRow(
    row({ ppc_ht: 500, discount_group: 'B' }),
    existing({ purchase_price: 12, price_purchase_locked: true }),
    { discountClasses: grid },
  );
  expect(d.patch.purchase_price).toBeUndefined();
  expect(d.changes.find((c) => c.field === 'purchase_price')).toBeUndefined();
  expect(d.anomalies).toContain("Prix d'achat verrouillé : conservé.");
});

test('reglage « accepter le prix d achat » desactive -> rien ne change sur un article existant', () => {
  const d = diffRow(
    row({ ppc_ht: 500, discount_group: 'B' }),
    existing(),
    { discountClasses: grid, settings: { ...DEFAULT_IMPORT_SETTINGS, accept_purchase_price: false } },
  );
  expect(d.patch.purchase_price).toBeUndefined();
});

test('le prix d achat du fichier garde la main sur la classe', () => {
  const d = diffRow(row({ reference: 'NEW3', ppc_ht: 500, discount_group: 'B', purchase_price: 300 }), null, { discountClasses: grid });
  expect(d.patch.purchase_price).toBe(300);
  expect(d.patch._pa_from_class).toBeUndefined();
});

test('sans grille (table absente, rien charge) -> aucun prix d achat ni anomalie', () => {
  const d = diffRow(row({ reference: 'NEW4', ppc_ht: 500, discount_group: 'B' }), null, {});
  expect(d.patch.purchase_price).toBeUndefined();
  expect(d.anomalies).toEqual([]);
});

test('la ligne propre au fournisseur gagne sur la ligne « tous fournisseurs »', () => {
  const g: DiscountClass[] = [
    { supplier_name: null, code: 'A', discount_pct: 25 },
    { supplier_name: 'Ducati', code: 'A', discount_pct: 30 },
  ];
  expect(resolveDiscountClass('a', 'ducati', g)?.discount_pct).toBe(30);
  expect(resolveDiscountClass('A', 'Autre', g)?.discount_pct).toBe(25);
  expect(resolveDiscountClass('A', null, g)?.discount_pct).toBe(25);
  const r = purchasePriceFromClass(200, ' a ', 'DUCATI', g);
  expect(r.ok && r.price).toBe(140);
});

test('arrondi au centime : 19,90 en classe C (45 %) -> 10,95', () => {
  const r = purchasePriceFromClass(19.9, 'C', null, grid);
  expect(r.ok && r.price).toBe(10.95);
});
