/**
 * Mission 03 — règle de liaison automatique produit Shopify ↔ article (décision W-6) :
 * seulement une correspondance EXACTE et UNIQUE ; tout le reste « à valider ».
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { decideAutoLinks, normalizeKey, type MatchCandidate, type VariantToMatch } from '../supabase/functions/_shared/shopify-match.ts';

const v = (variant_id: string, sku: string | null, barcode: string | null = null): VariantToMatch => ({ variant_id, sku, barcode });
const sku = (variant_id: string, article_id: string, article_reference: string, taken = false): MatchCandidate =>
  ({ variant_id, article_id, article_reference, article_barcode: null, via: 'sku', taken });
const bc = (variant_id: string, article_id: string, article_barcode: string): MatchCandidate =>
  ({ variant_id, article_id, article_reference: null, article_barcode, via: 'barcode' });

test('clé normalisée : trim + majuscules, vide = null', () => {
  expect(normalizeKey('  96780031b ')).toBe('96780031B');
  expect(normalizeKey('   ')).toBeNull();
  expect(normalizeKey(null)).toBeNull();
});

test('SKU identique à la référence (casse, espaces) : lié automatiquement', () => {
  const d = decideAutoLinks([v('v1', ' 96780031b')], [sku('v1', 'a1', '96780031B')]);
  expect(d.get('v1')).toEqual({ kind: 'auto', article_id: 'a1', via: 'sku' });
});

test('référence proche (tiret) : jamais liée d\'office', () => {
  const d = decideAutoLinks([v('v1', '967-80031B')], [sku('v1', 'a1', '96780031B')]);
  expect(d.get('v1')).toEqual({ kind: 'review', reason: 'no_match' });
});

test('sans SKU ni code-barres : à valider', () => {
  expect(decideAutoLinks([v('v1', '  ')], []).get('v1')).toEqual({ kind: 'review', reason: 'no_sku' });
});

test('aucun article : à valider', () => {
  expect(decideAutoLinks([v('v1', 'XYZ')], []).get('v1')).toEqual({ kind: 'review', reason: 'no_match' });
});

test('deux articles pour le même SKU : ambigu, à valider', () => {
  const d = decideAutoLinks([v('v1', 'ABC')], [sku('v1', 'a1', 'ABC'), sku('v1', 'a2', 'abc ')]);
  expect(d.get('v1')).toEqual({ kind: 'review', reason: 'ambiguous' });
});

test('code-barres exact et unique quand le SKU ne trouve rien : lié', () => {
  const d = decideAutoLinks([v('v1', 'INCONNU', '8012345678901')], [bc('v1', 'a9', '8012345678901')]);
  expect(d.get('v1')).toEqual({ kind: 'auto', article_id: 'a9', via: 'barcode' });
});

test('SKU et code-barres désignent deux articles différents : conflit', () => {
  const d = decideAutoLinks([v('v1', 'ABC', '123')], [sku('v1', 'a1', 'ABC'), bc('v1', 'a2', '123')]);
  expect(d.get('v1')).toEqual({ kind: 'review', reason: 'conflict' });
});

test('SKU et code-barres d\'accord : lié par SKU', () => {
  const d = decideAutoLinks([v('v1', 'ABC', '123')], [sku('v1', 'a1', 'ABC'), bc('v1', 'a1', '123')]);
  expect(d.get('v1')).toEqual({ kind: 'auto', article_id: 'a1', via: 'sku' });
});

test('deux variantes visent le même article : aucune n\'est liée', () => {
  const d = decideAutoLinks([v('v1', 'ABC'), v('v2', 'abc')], [sku('v1', 'a1', 'ABC'), sku('v2', 'a1', 'ABC')]);
  expect(d.get('v1')).toEqual({ kind: 'review', reason: 'shared_article' });
  expect(d.get('v2')).toEqual({ kind: 'review', reason: 'shared_article' });
});

test('article déjà relié à la main à une autre variante : à valider', () => {
  const d = decideAutoLinks([v('v1', 'ABC')], [sku('v1', 'a1', 'ABC', true)]);
  expect(d.get('v1')).toEqual({ kind: 'review', reason: 'article_taken' });
});

test('candidat renvoyé à tort par la base (référence différente) : ignoré', () => {
  const d = decideAutoLinks([v('v1', 'ABC')], [sku('v1', 'a1', 'ABD')]);
  expect(d.get('v1')).toEqual({ kind: 'review', reason: 'no_match' });
});
