/**
 * Perf 2 (20/11/2026) — sondes de schéma groupées, valeurs de paramètres partagées, stock paginé.
 *   - les sondes demandées ensemble partent en UN appel ; « présent » est retenu ; si l'appel
 *     groupé échoue ou tarde, chaque sonde repart par son ancienne requête ; jamais de blocage ;
 *   - toutes les sondes de l'application passent par la sonde groupée ;
 *   - le filtre JavaScript du stock (repli) suit les règles d'avant ;
 *   - React Query : valeurs par défaut raisonnables.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createSchemaProber } from '../src/lib/schema-probe';
import { filterStockRows, type StockRow } from '../src/modules/stock/stock-api';

const ROOT = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const memStore = () => { const s = new Set<string>(); return { get: () => [...s], add: (k: string[]) => k.forEach((x) => s.add(x)), s }; };

describe('sondes de schema groupees', () => {
  test('sondes simultanees : un seul appel, reponses exactes', async () => {
    const calls: string[][] = [];
    const store = memStore();
    const probe = createSchemaProber(async (c) => { calls.push(c); return c.filter((x) => !x.includes('absente')); }, store, { batchMs: 5 });
    const fb = async () => { throw new Error('ne doit pas servir'); };
    const r = await Promise.all([
      probe('repair_orders.promised_at', fb),
      probe('repair_orders.colonne_absente', fb),
      probe(['workshop_loans.driver_name', 'workshop_loans.customer_vehicle_id'], fb),
      probe(['workshop_loans.driver_name', 'workshop_loans.absente'], fb),
    ]);
    expect(r).toEqual([true, false, true, false]);
    expect(calls.length).toBe(1);
    expect(store.s.has('repair_orders.promised_at')).toBe(true);
    expect(store.s.has('repair_orders.colonne_absente')).toBe(false);
  });

  test('« present » retenu : plus aucun appel ensuite', async () => {
    let n = 0;
    const store = memStore();
    store.add(['repair_orders.promised_at']);
    const probe = createSchemaProber(async (c) => { n++; return c; }, store, { batchMs: 1 });
    expect(await probe('repair_orders.promised_at', async () => false)).toBe(true);
    expect(n).toBe(0);
  });

  test('appel groupe en echec : chaque sonde repart par son ancienne requete', async () => {
    const store = memStore();
    const probe = createSchemaProber(async () => null, store, { batchMs: 1 });
    const r = await Promise.all([probe('a.b', async () => true), probe('c.d', async () => false), probe('e.f', async () => { throw new Error('x'); })]);
    expect(r).toEqual([true, false, false]);
    expect(store.s.has('a.b')).toBe(true);
  });

  test('appel groupe trop lent puis ancienne requete bloquee : reponse « absent », jamais de blocage', async () => {
    const store = memStore();
    const never = new Promise<string[] | null>(() => {});
    const probe = createSchemaProber(() => never, store, { batchMs: 1, rpcTimeoutMs: 20, fallbackTimeoutMs: 20 });
    const t0 = Date.now();
    const ok = await probe('a.b', () => new Promise<boolean>(() => {}));
    expect(ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test("toutes les sondes de l'application passent par la sonde groupee", () => {
    const offenders = walk('src/modules')
      .filter((f) => /(probe|Probe) \?\?= \(async/.test(read(f)));
    expect(offenders).toEqual([]);
    const probes = walk('src/modules').filter((f) => /batchedSchemaProbe\(/.test(read(f)));
    expect(probes.length).toBeGreaterThanOrEqual(15);
  });
});

describe('valeurs de parametres partagees (reference_values)', () => {
  test('listRef lit toute la societe une fois (30 s) et vide la memoire a chaque ecriture', () => {
    const src = read('src/modules/settings/reference-api.ts');
    expect(src).toContain('REF_CACHE_MS = 30_000');
    expect(src).toMatch(/export async function upsertRef[\s\S]*invalidateRefCache\(row\.company_id\)/);
    expect(src).toMatch(/export async function deleteRef[\s\S]*invalidateRefCache\(\)/);
    // au-dela du plafond d'une reponse : lecture table par table
    expect(src).toContain('listRefDirect(companyId, tableKey)');
  });
});

describe('stock pagine : filtre de repli = regles de l ecran', () => {
  const row = (p: Partial<StockRow>): StockRow => ({
    article_id: p.reference ?? 'x', reference: 'R', designation: 'D', mgmt_type: 'A', category_path: null, bin_location: null,
    supplier_id: null, real_qty: 0, reserved_qty: 0, available_qty: 0, pamp: 0, stock_value: 0, stock_min: 0, ...p,
  });
  const rows = [
    row({ reference: 'A1', designation: 'Huile moteur', bin_location: 'B-12', real_qty: 3, available_qty: 3, category_path: '05-01-02', supplier_id: 's1' }),
    row({ reference: 'A2', designation: 'Filtre', real_qty: 0, available_qty: -1, stock_min: 2, category_path: 'Accessoires moto' }),
    row({ reference: 'A3', designation: 'Bougie', real_qty: 1, available_qty: 1, stock_min: 4 }),
  ];
  const refs = (f: Parameters<typeof filterStockRows>[1]) => filterStockRows(rows, f).map((r) => r.reference);
  test('filtres', () => {
    expect(refs({})).toEqual(['A1', 'A2', 'A3']);
    expect(refs({ only_stocked: true })).toEqual(['A1', 'A3']);
    expect(refs({ below_min: true })).toEqual(['A2', 'A3']);
    expect(refs({ reorder: true })).toEqual(['A2', 'A3']);
    expect(refs({ dormant: true })).toEqual(['A1', 'A3']);
    expect(refs({ supplier_id: 's1' })).toEqual(['A1']);
    expect(refs({ rayon_code: '05', rayon_label: 'zzz' })).toEqual(['A1']);
    expect(refs({ rayon_code: 'ZZ', rayon_label: 'accessoires' })).toEqual(['A2']);
    expect(refs({ q: '  HUILE ' })).toEqual(['A1']);
    expect(refs({ q: 'b-12' })).toEqual(['A1']);
  });
  test("les ecrans Stock et Depreciations ne chargent plus tout le stock", () => {
    for (const f of ['src/routes/_app.stock.index.tsx', 'src/routes/_app.stock.depreciation.tsx']) {
      const src = read(f);
      expect(src).not.toMatch(/listStock\(/);
      expect(src).toContain('stockScreenPage(');
    }
    expect(read('src/routes/_app.stock.index.tsx')).toContain('listStockScreenAll(');
  });
});

describe('React Query : valeurs par defaut', () => {
  test('donnees reutilisees 30 s, pas de relecture au retour sur l onglet, 1 nouvel essai', () => {
    const src = read('src/router.tsx');
    expect(src).toContain('QUERY_STALE_MS = 30_000');
    expect(src).toMatch(/refetchOnWindowFocus: false/);
    expect(src).toMatch(/retry: 1/);
  });
});
