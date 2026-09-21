/**
 * Mission 06 — lien catalogue Ducati ↔ articles du DMS par la référence normalisée.
 * La normalisation côté écran doit donner la même clé que la base
 * (ducati_catalog_norm_ref, index idx_articles_ref_compact : majuscules, uniquement A-Z0-9).
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { looksLikeReference, normalizeCatalogReference } from '../src/modules/catalog/reference';
import { activeNavTo, mainNav } from '../src/lib/navigation';

describe('normalisation de référence (même clé que la base)', () => {
  test('majuscules, sans espaces, points, tirets ni barres', () => {
    expect(normalizeCatalogReference('852.502.41a')).toBe('85250241A');
    expect(normalizeCatalogReference('852-502-41A')).toBe('85250241A');
    expect(normalizeCatalogReference(' 852 502 41 a ')).toBe('85250241A');
    expect(normalizeCatalogReference('4381c801a')).toBe('4381C801A');
    expect(normalizeCatalogReference('97980/231 BA')).toBe('97980231BA');
  });
  test('accents et caractères non A-Z0-9 retirés (comme regexp_replace [^A-Z0-9])', () => {
    expect(normalizeCatalogReference('É-123')).toBe('123');
    expect(normalizeCatalogReference('')).toBe('');
    expect(normalizeCatalogReference(null)).toBe('');
  });
  test('deux écritures d\'une même pièce donnent la même clé', () => {
    expect(normalizeCatalogReference('460.15391.A')).toBe(normalizeCatalogReference('46015391a'));
  });
});

describe('recherche : proposer le catalogue seulement pour une référence', () => {
  test('au moins 4 caractères utiles dont un chiffre', () => {
    expect(looksLikeReference('852.50')).toBe(true);
    expect(looksLikeReference('85')).toBe(false);
    expect(looksLikeReference('filtre')).toBe(false);
    expect(looksLikeReference('4381C801A')).toBe(true);
  });
});

describe('menu : « Catalogue Ducati » sous Pièces & Accessoires', () => {
  test('entrée présente juste après Pièces & Accessoires, en sous-entrée', () => {
    const i = mainNav.findIndex((n) => n.to === '/parts');
    expect(mainNav[i + 1].to).toBe('/parts/catalog');
    expect(mainNav[i + 1].child).toBe(true);
  });
  test('seule l\'entrée la plus précise est active', () => {
    expect(activeNavTo('/parts/catalog', mainNav)).toBe('/parts/catalog');
    expect(activeNavTo('/parts/123', mainNav)).toBe('/parts');
    expect(activeNavTo('/sales/balances', mainNav)).toBe('/sales/balances');
  });
});
