/**
 * Mission 07, carte 1 — chargeur des plans d'entretien (tools/maintenance-loader/transform.mjs)
 * sur un extrait réel de l'extraction (6 plans, tests/fixtures/plans-entretien).
 * La chaîne complète (SQL généré → maintenance_ingest) est essayée en base dans une transaction
 * annulée : node tools/maintenance-loader/load.mjs --dir tests/fixtures/plans-entretien --sql x.sql --rollback
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPlans, matchNames, normName, slimChecklists, slimSources, stableJson } from '../tools/maintenance-loader/transform.mjs';
import { applyPlanCorrections } from '../tools/maintenance-loader/corrections.mjs';

const DIR = join(import.meta.dir, 'fixtures', 'plans-entretien');
const plansJson = JSON.parse(readFileSync(join(DIR, 'plans.json'), 'utf8'));
const tempsJson = JSON.parse(readFileSync(join(DIR, 'temps.json'), 'utf8'));

describe('transformation', () => {
  const r = buildPlans(plansJson, tempsJson);

  test('tous les plans, échéances et temps sont repris, sans avertissement', () => {
    expect(r.plans.length).toBe(6);
    expect(r.warnings).toEqual([]);
    const times = r.plans.flatMap((p) => p.services.flatMap((s) => s.times));
    expect(times.length).toBe(tempsJson.temps.length);
  });

  test('statuts et usages au format de la base', () => {
    const racing = r.plans.find((p) => p.id === 'racing_paniv4')!;
    expect(racing.usage).toBe('racing');
    const all = r.plans.flatMap((p) => p.services.flatMap((s) => [...s.intervals, ...s.times]));
    expect(new Set(all.map((x) => x.status))).toEqual(new Set(['en_vigueur', 'historique']));
  });

  test('intervalle premier atteint et source conservée', () => {
    const mts = r.plans.find((p) => p.id === 'mts950_17_21')!;
    const oil = mts.services.find((s) => s.code === 'oil')!;
    const cur = oil.intervals.find((i) => i.status === 'en_vigueur')!;
    expect(cur.km_interval).toBe(15000);
    expect(cur.first_reached).toBe(true);
    expect(cur.source_file).toBeTruthy();
    expect(cur.source_sort).toBeTruthy();
  });

  test('idempotent : même fichier = mêmes empreintes et clés de lignes', () => {
    const again = buildPlans(JSON.parse(JSON.stringify(plansJson)), JSON.parse(JSON.stringify(tempsJson)));
    expect(again.plans.map((p) => p.content_hash)).toEqual(r.plans.map((p) => p.content_hash));
    const keys = (x: typeof r) => x.plans.flatMap((p) => p.services.flatMap((s) => s.operations.map((o) => o.row_key)));
    expect(keys(again)).toEqual(keys(r));
    for (const p of r.plans) for (const s of p.services) {
      const k = s.operations.map((o) => o.row_key);
      expect(new Set(k).size).toBe(k.length);
    }
  });

  test('un changement dans le document change l’empreinte du plan', () => {
    const copy = JSON.parse(JSON.stringify(plansJson));
    copy.plans[0].echeances[0].operations[0].texte += ' (modifié)';
    const b = buildPlans(copy, tempsJson);
    expect(b.plans[0].content_hash).not.toBe(r.plans[0].content_hash);
    expect(b.plans[1].content_hash).toBe(r.plans[1].content_hash);
  });

  test('sources et listes des contrôles', () => {
    expect(slimSources(plansJson.meta).length).toBe(plansJson.meta.sources.length);
    expect(slimChecklists(plansJson.listes_controles).every((l) => l.id && l.title)).toBe(true);
  });

  test('clé stable indépendante de l’ordre des propriétés', () => {
    expect(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(stableJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
  });
});

describe('correction de Simon (21/09) : Monster V2, DesertX V2, Hypermotard V2 = modèles 2026+', () => {
  test('appliquée au chargement, avec sa source', () => {
    const r = buildPlans(plansJson, tempsJson);
    const d = r.plans.find((p) => p.id === 'desertx_v2')!;
    expect(d.model_text).toBe('DesertX V2');
    expect(d.year_from).toBe(2026);
    expect(d.year_to).toBeNull();
    expect(d.match_names).toEqual(['DesertX V2']);
    expect(String(d.notes.at(-1))).toContain('Simon');
  });
  test('un plan non concerné est inchangé', () => {
    const p = plansJson.plans.find((x: { id: string }) => x.id === 'mts950_17_21');
    expect(applyPlanCorrections(p)).toBe(p);
  });
});

describe('noms de modèles pour le rattachement au catalogue', () => {
  test('texte du document découpé en modèles', () => {
    expect(matchNames('Multistrada 1200 / 1200 S (Testastretta 11°)')).toEqual(['Multistrada 1200', 'Multistrada 1200 S']);
    expect(matchNames('Monster 696 - 796 - 1100 - 1100 EVO')).toEqual(['Monster 696', 'Monster 796', 'Monster 1100', 'Monster 1100 EVO']);
    expect(matchNames('Hypermotard / Hyperstrada 821')).toEqual(['Hypermotard 821', 'Hyperstrada 821']);
    expect(matchNames('899 / 959 / 1199 / 1299 Panigale (toutes les versions)')).toEqual(['899 Panigale', '959 Panigale', '1199 Panigale', '1299 Panigale']);
    expect(matchNames('1199 Panigale / S / R')).toEqual(['1199 Panigale', '1199 Panigale S', '1199 Panigale R']);
    expect(matchNames('Scrambler 1100 / Sport / Special')).toEqual(['Scrambler 1100', 'Scrambler 1100 Sport', 'Scrambler 1100 Special']);
    expect(matchNames('Panigale V4 (7e génération) - 1100cc')).toEqual(['Panigale V4']);
  });
  test('variantes citées complétées par le nom du modèle', () => {
    expect(matchNames('Multistrada 1200 (DVT)', ['1200 S', '1200 Enduro'])).toEqual(['Multistrada 1200', 'Multistrada 1200 S', 'Multistrada 1200 Enduro']);
    expect(matchNames('Scrambler 800', ['Café Racer'])).toEqual(['Scrambler 800', 'Scrambler Café Racer']);
  });
  test('normalisation identique à la base (_mp_norm)', () => {
    expect(normName('Café Racer')).toBe('CAFE RACER');
    expect(normName('Multistrada 1200 S D|air')).toBe('MULTISTRADA 1200 S D AIR');
  });
});
