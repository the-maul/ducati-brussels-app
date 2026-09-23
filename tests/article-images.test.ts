/**
 * Décision M-27 — ordre de préférence des images d'un article :
 * photo Ducati du produit > photo du site (Shopify) > vue éclatée > rien.
 *
 * La règle est écrite DEUX fois : en base (`_article_thumbnail`, qui sert la
 * liste Pièces & Accessoires) et ici en TypeScript (`sourceImages`, qui sert la
 * galerie de la fiche article). Ce test garde la version TypeScript alignée.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { sourceImages } from '../src/modules/articles/article-source-images';
import type { ArticleLink } from '../src/modules/articles/links-api';

const link = (kind: string, status: string, info: unknown): ArticleLink => ({
  id: `${kind}-${status}`, target_kind: kind as ArticleLink['target_kind'], target_ref: 'REF',
  status: status as ArticleLink['status'], method: 'ref_exacte', score: 100, reason: null,
  is_auto: true, decided_at: null, decision_note: null, info: info as ArticleLink['info'],
});

const ducatiProduct = (url: string | null) => link('ducati_product', 'lie', { reference: 'R', image_url: url });
const shopify = (url: string | null) => link('shopify_variant', 'lie', { image_url: url });
const ducatiPart = (drawing: { image_url: string | null; thumbnail_url: string | null } | null) =>
  link('ducati_part', 'lie', { reference: 'R', drawing });

test('aucun lien : aucune image', () => {
  expect(sourceImages([], 'Casque')).toEqual([]);
  expect(sourceImages(undefined, 'Casque')).toEqual([]);
});

test('la photo Ducati du produit passe avant celle du site et la vue éclatée', () => {
  const imgs = sourceImages(
    [shopify('https://cdn.shopify.com/a.jpg'), ducatiPart({ image_url: 'https://e-catalog.ducati.com/v.png', thumbnail_url: null }), ducatiProduct('https://e-catalog.ducati.com/p.jpg')],
    'Casque',
  );
  expect(imgs.map((i) => i.source)).toEqual(['ducati_product', 'shopify', 'ducati_drawing']);
  expect(imgs[0].url).toBe('https://e-catalog.ducati.com/p.jpg');
});

test('le texte alternatif est la désignation de l\'article', () => {
  expect(sourceImages([shopify('https://cdn.shopify.com/a.jpg')], 'Plaquettes avant')[0].alt).toBe('Plaquettes avant');
});

test('la photo du site sert quand le produit Ducati n\'en a pas', () => {
  const imgs = sourceImages([ducatiProduct(null), shopify('https://cdn.shopify.com/a.jpg')], 'Casque');
  expect(imgs.map((i) => i.source)).toEqual(['shopify']);
});

test('la vue éclatée sert en dernier recours, image entière puis vignette', () => {
  expect(sourceImages([ducatiPart({ image_url: null, thumbnail_url: 'https://e-catalog.ducati.com/t.png' })], 'Vis')[0])
    .toEqual({ url: 'https://e-catalog.ducati.com/t.png', source: 'ducati_drawing', alt: 'Vis' });
});

test('un lien à valider ou rejeté ne donne jamais d\'image', () => {
  const imgs = sourceImages(
    [link('ducati_product', 'a_valider', { image_url: 'https://e-catalog.ducati.com/p.jpg' }),
     link('shopify_variant', 'rejete', { image_url: 'https://cdn.shopify.com/a.jpg' })],
    'Casque',
  );
  expect(imgs).toEqual([]);
});

test('la même URL n\'apparaît qu\'une fois dans la galerie', () => {
  const url = 'https://cdn.shopify.com/a.jpg';
  expect(sourceImages([ducatiProduct(url), shopify(url)], 'Casque')).toHaveLength(1);
});
