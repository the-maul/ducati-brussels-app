/**
 * Tests M03 — marques et modèles de motos toutes marques (retour client du 21/09).
 *
 * `vehicle_slug` vit en base (migration 20261005100000) : on teste ici la MÊME règle de
 * normalisation en TypeScript, pour que le code et la base ne divergent pas, puis le
 * comportement de l'écran (liste de secours, bornes des années proposées).
 * Aucun accès réseau, aucune donnée réelle.
 */
import { test, expect } from 'bun:test';
import { OTHER_BRANDS, recentYears, yearsFor, latestModelYear } from '../src/lib/ducati-models.ts';

/** Même règle que `public.vehicle_slug` : minuscules, sans accent ni ponctuation. */
const slug = (v: string): string | null =>
  (v || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null;

test('normalisation d’un nom de marque : accents, ponctuation, espaces', () => {
  expect(slug('Moto Guzzi')).toBe('moto guzzi');
  expect(slug('  MOTO   GUZZI  ')).toBe('moto guzzi');
  expect(slug('Harley-Davidson')).toBe('harley davidson');
  expect(slug('CF-Moto')).toBe('cf moto');
  expect(slug('Peugeot Métropolis')).toBe('peugeot metropolis');
  expect(slug('R 1250 GS')).toBe('r 1250 gs');
  expect(slug('   ')).toBeNull();
  expect(slug('!!!')).toBeNull();
});

test('« cfmoto » et « cf moto » se rejoignent (recherche sans espaces)', () => {
  const sansEspaces = (v: string) => (slug(v) ?? '').replace(/ /g, '');
  expect(sansEspaces('CF Moto')).toBe(sansEspaces('CFMOTO'));
  expect(sansEspaces('Harley Davidson')).toBe(sansEspaces('Harley-Davidson'));
  expect(sansEspaces('MV Agusta')).not.toBe(sansEspaces('Agusta MV'));
});

test('liste de secours : la liste courte d’avant reste utilisable hors ligne', () => {
  // L'écran retombe sur OTHER_BRANDS quand la base ne répond pas : elle doit rester saine.
  expect(OTHER_BRANDS.length).toBeGreaterThan(10);
  expect(OTHER_BRANDS).toContain('BMW');
  expect(new Set(OTHER_BRANDS.map((b) => slug(b))).size).toBe(OTHER_BRANDS.length);
  expect(OTHER_BRANDS.every((b) => slug(b) !== null)).toBe(true);
});

test('années proposées : bornées par le modèle quand on les connaît, 30 ans sinon', () => {
  const now = new Date('2026-06-15T00:00:00Z');
  // Modèle dont la base connaît les années (year_from / year_to de vehicle_models).
  expect(yearsFor({ name: 'X', from: 2020, to: 2022 }, now)).toEqual([2022, 2021, 2020]);
  // Modèle toujours au catalogue : jamais au-delà du millésime courant.
  expect(yearsFor({ name: 'X', from: 2024, to: null }, now)[0]).toBe(latestModelYear(now));
  // Années inconnues : la liste générique.
  expect(recentYears(now)).toHaveLength(30);
  expect(recentYears(now)[0]).toBe(latestModelYear(now));
});
