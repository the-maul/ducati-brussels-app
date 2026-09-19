/**
 * Mission 05, carte 4 — « Ajouter un accessoire trouvé dans l'e-catalog Ducati ».
 * Lecture de la référence collée (brute, texte, lien) et normalisation. Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  normalizeReference, looksLikeDucatiReference, extractReferenceFromUrl, parseEcatalogInput,
  isEcatalogUrl, ecatalogLinkFor, salePricesFrom, ECATALOG_HOME,
} from '../src/modules/sales/ecatalog';

describe('normalisation', () => {
  test('trim, majuscules, sans espaces', () => {
    expect(normalizeReference('  96680574a ')).toBe('96680574A');
    expect(normalizeReference('9668 0574 a')).toBe('96680574A');
    expect(normalizeReference('96782291 ba')).toBe('96782291BA');
    expect(normalizeReference(null)).toBe('');
  });
  test('forme d’une référence Ducati', () => {
    expect(looksLikeDucatiReference('96680574A')).toBe(true);
    expect(looksLikeDucatiReference('96782291BA')).toBe(true);
    expect(looksLikeDucatiReference('981069403')).toBe(true);
    expect(looksLikeDucatiReference('45968')).toBe(false);
    expect(looksLikeDucatiReference('SEED-A-0080')).toBe(false);
  });
});

describe('référence collée', () => {
  test('référence brute', () => {
    expect(parseEcatalogInput('96680574A')).toEqual({ kind: 'reference', reference: '96680574A', url: null });
    expect(parseEcatalogInput(' 96782291ba ')).toEqual({ kind: 'reference', reference: '96782291BA', url: null });
    expect(parseEcatalogInput('9668 0574 A')).toEqual({ kind: 'reference', reference: '96680574A', url: null });
    expect(parseEcatalogInput('SEED-A-0080')).toEqual({ kind: 'reference', reference: 'SEED-A-0080', url: null });
  });
  test('texte copié avec la désignation', () => {
    expect(parseEcatalogInput('96680574A Silencieux racing')).toEqual({ kind: 'reference', reference: '96680574A', url: null });
    expect(parseEcatalogInput('Valises latérales souples - 96782291BA')).toEqual({ kind: 'reference', reference: '96782291BA', url: null });
  });
  test('vide ou inexploitable', () => {
    expect(parseEcatalogInput('   ')).toEqual({ kind: 'empty' });
    expect(parseEcatalogInput('poignées chauffantes')).toEqual({ kind: 'invalid' });
  });
});

describe('lien e-catalog', () => {
  test('lien EPC sans référence (arborescence interne) : la référence est demandée', () => {
    const url = 'https://e-catalog.ducati.com/EPC/parts/106/125/298/1234/45968?lang=fr-FR';
    expect(extractReferenceFromUrl(url)).toBeNull();
    expect(parseEcatalogInput(url)).toEqual({ kind: 'url_without_reference', url });
  });
  test('référence dans le chemin', () => {
    expect(extractReferenceFromUrl('https://e-catalog.ducati.com/EPC/product/accessories/96680574A?lang=fr-FR')).toBe('96680574A');
    expect(extractReferenceFromUrl('https://e-catalog.ducati.com/EPC/parts/106/96782291ba-valises-souples')).toBe('96782291BA');
  });
  test('référence dans un paramètre ou l’ancre', () => {
    expect(extractReferenceFromUrl('https://e-catalog.ducati.com/EPC/search?partNumber=96680574A&lang=fr-FR')).toBe('96680574A');
    expect(extractReferenceFromUrl('https://e-catalog.ducati.com/EPC/search?q=96782291%20BA')).toBe('96782291BA');
    expect(extractReferenceFromUrl('https://e-catalog.ducati.com/EPC/parts/106/125#part-96680574A')).toBe('96680574A');
  });
  test('lien sans protocole', () => {
    expect(parseEcatalogInput('e-catalog.ducati.com/EPC/product/96680574A')).toEqual({
      kind: 'reference', reference: '96680574A', url: 'https://e-catalog.ducati.com/EPC/product/96680574A',
    });
  });
  test('domaine e-catalog reconnu', () => {
    expect(isEcatalogUrl('https://e-catalog.ducati.com/EPC/?lang=fr-FR')).toBe(true);
    expect(isEcatalogUrl('https://evil.example.com/e-catalog.ducati.com')).toBe(false);
  });
  test('lien « Voir dans l’e-catalog » : URL de l’article, sinon accueil', () => {
    const u = 'https://e-catalog.ducati.com/EPC/parts/106/125/298/45968?lang=fr-FR';
    expect(ecatalogLinkFor(u)).toBe(u);
    expect(ecatalogLinkFor(null)).toBe(ECATALOG_HOME);
    expect(ecatalogLinkFor('https://example.com/x')).toBe(ECATALOG_HOME);
  });
});

describe('prix de l’article créé', () => {
  test('saisi TTC ou HT selon la ligne', () => {
    expect(salePricesFrom(121, 'ttc')).toEqual({ ttc: 121, ht: 100 });
    expect(salePricesFrom(100, 'ht')).toEqual({ ht: 100, ttc: 121 });
    expect(salePricesFrom(-5, 'ttc')).toEqual({ ttc: 0, ht: 0 });
  });
});
