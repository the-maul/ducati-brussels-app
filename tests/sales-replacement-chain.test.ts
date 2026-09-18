/**
 * Tests M6 — référence remplacée : proposer la DERNIÈRE de la chaîne (mission 05, carte 3).
 * « Il faut prendre la dernière » : A → B → C propose C ; les boucles sont détectées.
 */
import { test, expect } from 'bun:test';
import { followReplacementChain, MAX_REPLACEMENT_HOPS } from '../src/modules/sales/replacement';

const chainOf = (links: Record<string, string | null>) => (id: string) => links[id] ?? null;

test('article non remplacé : pas de proposition', () => {
  const r = followReplacementChain('A', chainOf({}));
  expect(r.lastId).toBeNull();
  expect(r.path).toEqual(['A']);
  expect(r.loop).toBe(false);
});

test('un seul remplacement : la référence de remplacement', () => {
  const r = followReplacementChain('A', chainOf({ A: 'B' }));
  expect(r.lastId).toBe('B');
  expect(r.loop).toBe(false);
});

test('chaîne A → B → C → D : on propose la dernière (D)', () => {
  const r = followReplacementChain('A', chainOf({ A: 'B', B: 'C', C: 'D' }));
  expect(r.lastId).toBe('D');
  expect(r.path).toEqual(['A', 'B', 'C', 'D']);
  expect(r.loop).toBe(false);
});

test('partir du milieu de la chaîne donne la même dernière référence', () => {
  expect(followReplacementChain('B', chainOf({ A: 'B', B: 'C', C: 'D' })).lastId).toBe('D');
});

test('boucle A → B → A : arrêt sans tourner en rond, signalée', () => {
  const r = followReplacementChain('A', chainOf({ A: 'B', B: 'A' }));
  expect(r.loop).toBe(true);
  expect(r.lastId).toBe('B');
});

test('boucle plus loin A → B → C → B : arrêt sur C, signalée', () => {
  const r = followReplacementChain('A', chainOf({ A: 'B', B: 'C', C: 'B' }));
  expect(r.loop).toBe(true);
  expect(r.lastId).toBe('C');
  expect(r.path).toEqual(['A', 'B', 'C']);
});

test('article qui se remplace lui-même : boucle, pas de proposition', () => {
  const r = followReplacementChain('A', chainOf({ A: 'A' }));
  expect(r.loop).toBe(true);
  expect(r.lastId).toBeNull();
});

test('chaîne anormalement longue : bornée', () => {
  const links: Record<string, string> = {};
  for (let i = 0; i < 100; i++) links[`R${i}`] = `R${i + 1}`;
  const r = followReplacementChain('R0', chainOf(links));
  expect(r.loop).toBe(true);
  expect(r.path.length).toBe(MAX_REPLACEMENT_HOPS + 1);
});
