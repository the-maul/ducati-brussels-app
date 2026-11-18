/**
 * Rattrapage G8 (18/11/2026, lot parc) — plusieurs chassis du meme modele (moto neuve).
 * Regles pures (src/modules/vehicles/chassis-rules.ts) + lecture de la migration
 * 20261118140000 (l'index unique qui bloquait le 2e chassis est bien remplace).
 * Essai a blanc en base : supabase/tests/m3_chassis_multiples.sql. Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  articleCanShareChassis, receptionChassisErrors, modelChassisSummary, chassisForSale, type ChassisRow,
} from '../src/modules/vehicles/chassis-rules';

const sql = readFileSync(new URL('../supabase/migrations/20261118140000_m3_chassis_multiples_par_modele.sql', import.meta.url), 'utf8');
const old = readFileSync(new URL('../supabase/migrations/20260923150000_m3_motos_parc_article.sql', import.meta.url), 'utf8');

describe('le blocage constate (lecture du schema)', () => {
  test("l'index unique du 23/09 interdisait deux motos sur le meme article", () => {
    expect(old).toMatch(/create unique index if not exists uq_vehicles_article on public\.vehicles \(article_id\)/);
  });
  test('la migration du 18/11 le retire et le remplace par un controle par type de gestion', () => {
    expect(sql).toMatch(/drop index if exists public\.uq_vehicles_article;/);
    expect(sql).toMatch(/create trigger trg_vehicles_article_share_check/);
    expect(sql).toMatch(/if a\.mgmt = 'V' then return new; end if;/);
  });
  test('la reception d\'un chassis est atomique (fiche moto + entree de stock dans la meme fonction)', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.vehicle_chassis_receive'));
    expect(fn).toMatch(/insert into public\.vehicles/);
    expect(fn).toMatch(/perform public\.record_stock_move\(\s*a\.id, 'entree'::public\.stock_move_type, 1/);
    expect(fn).toMatch(/VIN_EXISTS/);
  });
  test('la vente choisit le chassis du document, sinon le plus ancien en stock, et le memorise pour le registre', () => {
    expect(sql).toMatch(/d\.vehicle_id into dv from public\.documents/);
    expect(sql).toMatch(/order by v\.entry_date nulls last, v\.created_at/);
    expect(sql).toMatch(/set_config\('dms\.moto_move_'/);
    // les deux declencheurs de vente passent par le meme choix
    expect((sql.match(/_moto_vehicle_for_move\(new\.id, new\.company_id, new\.article_id, new\.ref\)/g) ?? []).length).toBe(2);
  });
});

describe('qui peut porter plusieurs chassis', () => {
  test('seul le modele de moto neuve (V)', () => {
    expect(articleCanShareChassis('V')).toBe(true);
    expect(articleCanShareChassis('v')).toBe(true);
    for (const m of ['O', 'P', 'D', 'A', 'R', null, undefined]) expect(articleCanShareChassis(m)).toBe(false);
  });
});

describe('controle des lignes de reception (avant toute ecriture)', () => {
  test('3 DESERTX = 3 lignes de quantite 1 : accepte', () => {
    const lines = ['ZDM1', 'ZDM2', 'ZDM3'].map((vin) => ({ article_id: 'desertx', quantity: 1, chassis: { vin } }));
    expect(receptionChassisErrors(lines)).toEqual([]);
  });
  test('quantite 2 avec un seul chassis : refuse', () => {
    expect(receptionChassisErrors([{ article_id: 'm', quantity: 2, chassis: { vin: 'ZDMX' } }])).toEqual([{ index: 0, error: 'chassisQtyOne', vin: 'ZDMX' }]);
  });
  test('chassis sans modele : refuse', () => {
    expect(receptionChassisErrors([{ article_id: null, quantity: 1, chassis: { vin: 'zdm-x' } }])[0]).toEqual({ index: 0, error: 'chassisNeedsArticle', vin: 'ZDMX' });
  });
  test('meme VIN deux fois (meme ecrit autrement) : refuse sur la 2e ligne', () => {
    const r = receptionChassisErrors([
      { article_id: 'm', quantity: 1, chassis: { vin: 'ZDM 123' } },
      { article_id: 'm', quantity: 1, chassis: { vin: 'zdm-123' } },
    ]);
    expect(r).toEqual([{ index: 1, error: 'chassisVinDuplicate', vin: 'ZDM123' }]);
  });
  test('ligne sans chassis ou fiche chassis vide : ligne ordinaire', () => {
    expect(receptionChassisErrors([
      { article_id: 'p', quantity: 5 },
      { article_id: 'p', quantity: 5, chassis: { vin: '' } },
    ])).toEqual([]);
  });
  test('VIN fait seulement de separateurs : illisible', () => {
    expect(receptionChassisErrors([{ article_id: 'm', quantity: 1, chassis: { vin: '--' } }])[0].error).toBe('chassisVinMissing');
  });
});

const row = (id: string, status: ChassisRow['status'], entry: string | null, created = '2026-11-01T10:00:00Z'): ChassisRow =>
  ({ id, status, entry_date: entry, created_at: created });

describe('stock du modele = chassis en stock (logique G8)', () => {
  test('DESERTX : 4 en stock, 1 vendu', () => {
    const rows = [row('a', 'stock_vn', '2026-01-01'), row('b', 'stock_vn', '2026-02-01'), row('c', 'reserve', '2026-03-01'),
      row('d', 'demo', '2026-04-01'), row('e', 'vendu', '2025-12-01')];
    expect(modelChassisSummary(rows)).toEqual({ total: 5, inStock: 4, sold: 1 });
  });
});

describe('chassis vendu', () => {
  const rows = [row('new', 'stock_vn', '2026-10-01'), row('old', 'stock_vn', '2026-03-01'), row('gone', 'vendu', '2026-01-01')];
  test('un seul chassis : lui', () => {
    expect(chassisForSale([row('x', 'stock_vn', null)])).toEqual({ id: 'x', rule: 'unique' });
  });
  test('celui choisi sur le document', () => {
    expect(chassisForSale(rows, 'new')).toEqual({ id: 'new', rule: 'document' });
  });
  test('sinon le plus ancien en stock (jamais un vendu)', () => {
    expect(chassisForSale(rows, null)).toEqual({ id: 'old', rule: 'plus_ancien_en_stock' });
    expect(chassisForSale(rows, 'autre-moto')).toEqual({ id: 'old', rule: 'plus_ancien_en_stock' });
  });
  test('meme date d\'entree : le premier cree', () => {
    const r = [row('b', 'stock_vn', '2026-05-01', '2026-05-01T12:00:00Z'), row('a', 'stock_vn', '2026-05-01', '2026-05-01T09:00:00Z')];
    expect(chassisForSale(r)?.id).toBe('a');
  });
  test('plus aucun chassis en stock : rien', () => {
    expect(chassisForSale([row('a', 'vendu', null), row('b', 'livre', null)])).toBeNull();
  });
});
