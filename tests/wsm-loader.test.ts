/**
 * Mission 07, carte 3 — parseur et chargeur des manuels d'atelier (tools/wsm-loader/transform.mjs).
 *
 * Les fixtures sont des extraits RÉELS de l'extraction Ducati (un fichier d'entretien et une
 * procédure), allégés : mêmes structures, listes coupées. Aucune donnée personnelle.
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — module .mjs sans déclaration de types (outil de chargement, hors src/)
import { buildManual, buildProcedure, procedureImages, contentHash, parseDmDate, serviceCode, norm, rowKey, chunk, dollarQuote } from '../tools/wsm-loader/transform.mjs';

const FIX = join(import.meta.dir, 'fixtures', 'manuels-atelier');
const read = (f: string) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const manualJson = () => read('entretien-desertx-rally-2024.json');
const procedureJson = () => read('parcours-000cec15b7b424b6e07f.json');

describe('utilitaires', () => {
  test('la date du DM devient une date ISO, le fuseau imprimé est ignoré', () => {
    expect(parseDmDate('Tue Sep 16 00:00:00 CEST 2025')).toBe('2025-09-16');
    expect(parseDmDate('Thu Jul 09 00:00:00 CEST 2026')).toBe('2026-07-09');
    expect(parseDmDate('Tue Mar 17 00:00:00 CET 2026')).toBe('2026-03-17');
    expect(parseDmDate('2025-09-16')).toBe('2025-09-16');
    expect(parseDmDate(null)).toBeNull();
    expect(parseDmDate('n’importe quoi')).toBeNull();
  });

  test('le nom d’échéance donne un code stable', () => {
    expect(serviceCode('Oil Service')).toBe('oil_service');
    expect(serviceCode('First Service 1000')).toBe('first_service_1000');
    expect(serviceCode('Desmo Service')).toBe('desmo_service');
    expect(serviceCode('  Annual   Service  ')).toBe('annual_service');
  });

  test('la normalisation enlève accents et ponctuation', () => {
    expect(norm('Contrôle du niveau d’huile')).toBe('CONTROLE DU NIVEAU D HUILE');
    expect(norm(null)).toBe('');
  });

  test('l’empreinte ne dépend pas de l’ordre des clés', () => {
    expect(contentHash({ a: 1, b: [2, 3] })).toBe(contentHash({ b: [2, 3], a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  test('clé de contenu, découpage et littéral SQL', () => {
    expect(rowKey('a', 'b')).toBe(rowKey('a', 'b'));
    expect(rowKey('a', 'b')).not.toBe(rowKey('a', 'c'));
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const q = dollarQuote('texte avec $w$ dedans');
    expect(q.startsWith('$ww$')).toBe(true);
    expect(q.endsWith('$ww$')).toBe(true);
  });
});

describe('procédure d’atelier (parcours réel)', () => {
  const p = buildProcedure(procedureJson());

  test('identité, source et déduplication', () => {
    expect(p.id).toBe('000cec15b7b424b6e07f');
    expect(p.title).toContain('Vidange du liquide du circuit');
    expect(p.roles).toEqual(['procedure']);
    expect(p.source_code).toBe('WSM.160.004.1737');
    expect(p.source_dm_path).toBe('290747/303545/303549/303557');
    expect(p.source_updated_at).toBe('2026-07-09');
    // 4 modèles-années partagent cette procédure : elle n'est stockée qu'une fois.
    expect(p.usages_count).toBe(4);
  });

  test('les étapes gardent leur numéro, leur texte et leurs figures', () => {
    expect(p.steps.length).toBe(5);
    expect(p.steps[0].n).toBe(1);
    expect(p.steps[0].text).toContain('réservoir liquide');
    expect(p.steps[0].figures[0].local).toBe('images/edocdmimages/0E/0ECBDC485DD4A1DE7E52EB522191E978.png');
    expect(p.steps.every((s: { n: number }) => Number.isInteger(s.n))).toBe(true);
  });

  test('les couples de serrage deviennent des lignes à clé stable', () => {
    expect(p.torques.length).toBe(2);
    const c = p.torques[0];
    expect(c.value_nm).toBe(6);
    expect(c.min_nm).toBe(5);
    expect(c.max_nm).toBe(7);
    expect(c.step_n).toBe(8);
    expect(c.text).toContain('6 Nm');
    expect(new Set(p.torques.map((x: { row_key: string }) => x.row_key)).size).toBe(p.torques.length);
  });

  test('les avertissements généraux sont conservés', () => {
    expect(p.warnings.length).toBeGreaterThan(0);
    expect(p.warnings[0].type).toBe('attention');
  });

  test('deux lectures du même fichier donnent la même empreinte (idempotence)', () => {
    expect(buildProcedure(procedureJson()).content_hash).toBe(p.content_hash);
  });

  test('un changement de texte change l’empreinte', () => {
    const j = procedureJson();
    j.etapes[0].texte = 'autre chose';
    expect(buildProcedure(j).content_hash).not.toBe(p.content_hash);
  });

  test('les images sont dédoublonnées, figure et miniature distinguées', () => {
    const imgs = procedureImages(procedureJson());
    expect(imgs.size).toBeGreaterThan(0);
    for (const [path, kind] of imgs) {
      expect(path.startsWith('images/')).toBe(true);
      expect(['figure', 'miniature']).toContain(kind);
    }
  });

  test('une procédure sans identifiant est refusée', () => {
    expect(() => buildProcedure({ titre: 'x' })).toThrow();
  });
});

describe('manuel d’un modèle-année (fichier d’entretien réel)', () => {
  const m = buildManual(manualJson(), { sourceFile: 'entretien/desert-x/desertx-rally-2024.json' });

  test('identité du modèle-année', () => {
    expect(m.id).toBe('406');
    expect(m.family).toBe('DESERT X');
    expect(m.model).toBe('DESERTX RALLY');
    expect(m.model_year).toBe(2024);
    expect(m.manual_root).toBe('870');
    expect(m.source_file).toBe('entretien/desert-x/desertx-rally-2024.json');
  });

  test('le programme officiel garde les échéances km / mi / mois', () => {
    expect(m.services.length).toBe(4);
    const first = m.services.find((s: { code: string }) => s.code === 'first_service_1000');
    expect(first.km).toBe(1000);
    expect(first.mi).toBe(600);
    expect(first.first_service).toBe(true);
    const annual = m.services.find((s: { code: string }) => s.code === 'annual_service');
    expect(annual.months).toBe(12);
    expect(annual.km).toBeNull();
    // Décision M-16 : partout, le premier atteint (km ou mois).
    expect(m.services.every((s: { first_reached: boolean }) => s.first_reached)).toBe(true);
  });

  test('les opérations pointent vers des échéances qui existent', () => {
    expect(m.operations.length).toBeGreaterThan(0);
    const codes = new Set(m.services.map((s: { code: string }) => s.code));
    for (const o of m.operations) for (const c of o.service_codes) expect(codes.has(c)).toBe(true);
    // Les quatre portées sont reconnues.
    const scopes = new Set(m.operations.map((o: { scope: string }) => o.scope));
    expect(scopes.has('concessionnaire')).toBe(true);
    expect(scopes.has('liste_1000')).toBe(true);
    expect(scopes.has('client')).toBe(true);
  });

  test('les clés de ligne sont uniques dans chaque table', () => {
    const uniq = (rows: { row_key: string }[]) => new Set(rows.map((r) => r.row_key)).size === rows.length;
    expect(uniq(m.operations)).toBe(true);
    expect(uniq(m.torque_tables)).toBe(true);
    expect(uniq(m.tool_sets)).toBe(true);
    expect(uniq(m.fluid_tables)).toBe(true);
    expect(uniq(m.product_tables)).toBe(true);
    expect(uniq(m.times)).toBe(true);
    expect(new Set(m.services.map((s: { code: string }) => s.code)).size).toBe(m.services.length);
  });

  test('les usages de procédures sont uniques par (procédure, rôle) et portent le chemin du DM', () => {
    expect(m.usages.length).toBeGreaterThan(0);
    const keys = m.usages.map((u: { procedure_id: string; role: string }) => `${u.procedure_id}|${u.role}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(m.usages.some((u: { role: string }) => u.role === 'prelivraison')).toBe(true);
    expect(m.usages.some((u: { role: string }) => u.role === 'liee')).toBe(true);
    expect(m.usages.every((u: { dm_path: string | null }) => u.dm_path === null || u.dm_path.includes('/'))).toBe(true);
  });

  test('les procédures par échéance visent une échéance connue', () => {
    const codes = new Set(m.services.map((s: { code: string }) => s.code));
    expect(m.service_procedures.length).toBeGreaterThan(0);
    // « Annual Service (24) » est ramené à l'échéance « Annual Service » du programme.
    for (const sp of m.service_procedures) expect(codes.has(sp.service_code)).toBe(true);
  });

  test('les temps sont lus en UT et en minutes (1 UT = 6 min)', () => {
    expect(m.times.length).toBeGreaterThan(0);
    const t0 = m.times[0];
    expect(t0.label).toBe('OIL SERVICE 1000');
    expect(t0.ut).toBe(11);
    expect(t0.minutes).toBe(66);
    expect(t0.minutes).toBe(t0.ut * 6);
  });

  test('les annexes gardent leur source (manuel, chemin du DM, code, version, date)', () => {
    const tq = m.torque_tables[0];
    expect(tq.source_manual_root).toBe('870');
    expect(tq.source_dm_path).toBe('870/143113/143136/143138');
    expect(tq.source_code).toBe('WSM.140.002.0892');
    expect(tq.source_version).toBe('1.0');
    expect(tq.source_updated_at).toBe('2025-09-16');
    expect(m.fluid_tables[0].lines.length).toBeGreaterThan(0);
    expect(m.tool_sets[0].tools.length).toBeGreaterThan(0);
    expect(m.product_tables[0].products.length).toBeGreaterThan(0);
  });

  test('deux lectures donnent la même empreinte, un changement la modifie', () => {
    expect(buildManual(manualJson(), { sourceFile: 'entretien/desert-x/desertx-rally-2024.json' }).content_hash)
      .toBe(m.content_hash);
    const j = manualJson();
    j.programme.services[0].km = 1500;
    expect(buildManual(j, { sourceFile: 'entretien/desert-x/desertx-rally-2024.json' }).content_hash)
      .not.toBe(m.content_hash);
  });

  test('un fichier sans identifiant de modèle-année est refusé', () => {
    expect(() => buildManual({ modele: {}, programme: {} })).toThrow();
  });
});

describe('manuel ancien, en grille kilométrique (Diavel 1260 2019)', () => {
  // 235 des 469 modèles-années ne nomment pas leurs révisions : leurs échéances ne sont que des
  // colonnes kilométriques. Sans ce repli, ces manuels arriveraient en base sans aucune échéance.
  const m = buildManual(read('entretien-diavel-1260-2019.json'), { sourceFile: 'entretien/diavel/diavel-1260-2019.json' });

  test('les échéances viennent de la grille quand le manuel ne nomme pas ses révisions', () => {
    expect(read('entretien-diavel-1260-2019.json').programme.services).toEqual([]);
    expect(m.services.length).toBe(5);
    expect(m.services.map((s: { name: string }) => s.name)).toEqual(['1000 km', '15000 km', '30000 km', '45000 km', '60000 km']);
    const first = m.services[0];
    expect(first.km).toBe(1000);
    expect(first.mi).toBe(600);
    expect(first.first_service).toBe(true);
    expect(m.services[1].first_service).toBe(false);
  });

  test('les opérations de la grille pointent vers ces échéances', () => {
    const codes = new Set(m.services.map((s: { code: string }) => s.code));
    const withServices = m.operations.filter((o: { service_codes: string[] }) => o.service_codes.length);
    expect(withServices.length).toBeGreaterThan(0);
    for (const o of m.operations) for (const c of o.service_codes) expect(codes.has(c)).toBe(true);
  });

  test('les en-têtes de colonne qui ne sont pas des échéances sont écartés', () => {
    // proceduresParService contient « km x 1000 », « mi x 1000 », « Temps (mois) ».
    const codes = new Set(m.services.map((s: { code: string }) => s.code));
    for (const sp of m.service_procedures) expect(codes.has(sp.service_code)).toBe(true);
    expect(m.service_procedures.some((sp: { service_code: string }) => sp.service_code === 'temps_mois')).toBe(false);
  });
});
