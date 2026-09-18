/**
 * Règle : on n'extrait jamais `supabase.rpc` du client sans `.bind(supabase)`.
 *
 * `rpc` lit `this.rest` : `const f = supabase.rpc` puis `f('x')` plante dans le navigateur
 * (« Cannot read properties of undefined (reading 'rest') ») sans aucune requête vers la base.
 * Incident du 19/09 : la création manuelle d'une carte CRM et le bouton « Relier ou créer la
 * fiche client » ne marchaient pas pour cette raison (M10). Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** `= supabase.rpc` (ou `= client.rpc`) affecté à une variable sans `.bind(`. */
const DETACHED = /=\s*\(?\s*\w+\.rpc\b(?!\s*\.bind\()(?!\s*\()/;

test('le motif détecte une extraction sans bind', () => {
  expect(DETACHED.test('const rpcUntyped = supabase.rpc as unknown as (')).toBe(true);
  expect(DETACHED.test('const rpcUntyped = supabase.rpc as any;')).toBe(true);
  expect(DETACHED.test('const rpcUntyped = supabase.rpc.bind(supabase) as unknown as (')).toBe(false);
  expect(DETACHED.test('const { data } = await supabase.rpc(\'x\', {});')).toBe(false);
  expect(DETACHED.test('const { data } = await (supabase.rpc as any)(\'x\', {});')).toBe(false);
});

test('le module CRM appelle ses fonctions SQL avec un rpc lié au client', () => {
  const src = readFileSync(join(SRC, 'modules', 'crm', 'api.ts'), 'utf8');
  const bad = src.split('\n').filter((l) => DETACHED.test(l));
  expect(bad).toEqual([]);
});

test('aucun autre fichier du CRM n\'extrait supabase.rpc sans bind', () => {
  const bad = files(join(SRC, 'modules', 'crm'))
    .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => DETACHED.test(l)).map((l) => `${f}: ${l.trim()}`));
  expect(bad).toEqual([]);
});
