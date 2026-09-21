/**
 * Mission 06 — import du catalogue Ducati par l'extension (cartes 2 et 3).
 * Règles pures de tools/myducati-extension/catalog-core.js : filtre Europe / millésime,
 * normalisation des références, dédoublonnage des planches, reprise (état).
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { createRequire } from 'node:module';
import { normalizeCatalogReference } from '../src/modules/catalog/reference';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../tools/myducati-extension/catalog-core.js');

describe('filtre Europe (décision M-15)', () => {
  test('les modèles sans suffixe de marché sont européens', () => {
    for (const d of ['ICON 2G', 'MONSTER 937', 'PANIGALE V4 S', 'MULTISTRADA V2 S TRAVEL', 'SCRAMBLER FULL THROTTLE', 'SUPERSPORT 950 S', 'DIAVEL 1260 S', '1199 PANIGALE S TRICOLORE', 'MONSTER S4RS TESTASTRETTA']) {
      expect(core.isEuropeModel(d)).toBe(true);
    }
  });
  test('les suffixes pays excluent le modèle et donnent le marché', () => {
    expect(core.marketOf('ICON 2G USA')).toBe('USA');
    expect(core.marketOf('ICON 2G THAILAND')).toBe('THAILAND');
    expect(core.marketOf('ICON 2G THAILAND USA')).toBe('THAILAND');
    expect(core.marketOf('MONSTER BRASIL')).toBe('BRASIL');
    expect(core.marketOf('Monster 821 Argentina')).toBe('ARGENTINA');
    expect(core.marketOf('PANIGALE V2 CHINA')).toBe('CHINA');
    expect(core.marketOf('DIAVEL JAPAN')).toBe('JAPAN');
    expect(core.marketOf('SCRAMBLER AUSTRALIA')).toBe('AUSTRALIA');
    expect(core.marketOf('SCRAMBLER INDIA')).toBe('INDIA');
    expect(core.marketOf('MULTISTRADA CANADA')).toBe('CANADA');
    expect(core.marketOf('MONSTER 696 (USA)')).toBe('USA');
    expect(core.marketOf('SS 1000 CALIFORNIA')).toBe('USA');
  });
  test('un marché n’est reconnu que comme mot entier', () => {
    expect(core.marketOf('SUSPENSION')).toBe('EU');       // contient « US »
    expect(core.marketOf('CAUSTIC RED')).toBe('EU');      // contient « AUS »
    expect(core.marketOf('THAIMOTO')).toBe('EU');
    expect(core.marketOf('')).toBe('EU');
    expect(core.marketOf(null)).toBe('EU');
  });
});

const tree = core.buildTree(
  [{ id: 6, description: 'Monster' }, { id: 7, description: 'Scrambler' }],
  { 6: [{ id: 61, description: '937' }], 7: [{ id: 71, description: '800' }] },
  {
    '6/61': [
      { id: 501, description: 'MONSTER 937', modelYears: [{ id: 9001, code: 'M937 21', year: 2021 }, { id: 9002, code: 'M 99', year: '1999' }] },
      { id: 502, description: 'MONSTER 937 USA', modelYears: [{ id: 9003, year: 2021 }] },
    ],
    '7/71': [
      { id: 701, description: 'ICON 2G', modelYears: [{ id: 9101, year: 2023 }, { id: 9102, code: 'ICON 2024' }] },
      { id: 702, description: 'ICON 2G THAILAND', modelYears: [{ id: 9103, year: 2023 }] },
      { id: 703, description: 'ICON OLD', modelYears: [{ id: 9104, year: 1998 }] },
    ],
  },
);

describe('arbre et plan d’import', () => {
  test('l’arbre envoyé au DMS porte le marché et des ids en texte', () => {
    const m = tree.families[0].superModels[0].models[1];
    expect(m).toMatchObject({ id: '502', market: 'USA', isEurope: false });
    expect(tree.families[1].superModels[0].models[0].modelYears[1]).toMatchObject({ id: '9102', year: 2024 });
  });

  test('Europe + millésimes depuis 2000 par défaut', () => {
    const plan = core.buildPlan(tree, { minYear: 2000 });
    expect(plan.jobs.map((j: { modelYearId: string }) => j.modelYearId)).toEqual(['9001', '9101', '9102']);
    expect(plan.summary).toMatchObject({ models: 5, modelsKept: 2, modelsOutsideEurope: 2, modelYearsBeforeMin: 2, modelYearsKept: 3 });
    const reasons = Object.fromEntries(plan.models.map((m: { id: string; reason: string | null }) => [m.id, m.reason]));
    expect(reasons).toEqual({ 501: null, 502: 'market', 701: null, 702: 'market', 703: 'years' });
  });

  test('on peut décocher une famille, décocher un modèle, ou cocher un modèle hors Europe', () => {
    expect(core.buildPlan(tree, { excludedFamilies: ['7'] }).jobs.map((j: { modelYearId: string }) => j.modelYearId)).toEqual(['9001']);
    expect(core.buildPlan(tree, { excludedModels: ['501'] }).jobs.map((j: { modelYearId: string }) => j.modelYearId)).toEqual(['9101', '9102']);
    expect(core.buildPlan(tree, { includedModels: ['502'] }).jobs.map((j: { modelYearId: string }) => j.modelYearId)).toEqual(['9001', '9003', '9101', '9102']);
  });

  test('millésime lu dans le champ year ou, à défaut, dans le code', () => {
    expect(core.yearOf({ year: 2021 })).toBe(2021);
    expect(core.yearOf({ year: '2019' })).toBe(2019);
    expect(core.yearOf({ code: 'MSV4 21 2022' })).toBe(2022);
    expect(core.yearOf({ code: 'X' })).toBe(null);
  });
});

describe('références', () => {
  test('forme compacte identique à la base (majuscules, A-Z0-9)', () => {
    expect(core.normalizeReference(' 460.15391 a ')).toBe('46015391A');
    expect(core.normalizeReference('967-893-AAA')).toBe('967893AAA');
    expect(core.normalizeReference(null)).toBe('');
    expect(normalizeCatalogReference(' 460.15391 a ')).toBe('46015391A');
    expect(normalizeCatalogReference('98104 355')).toBe('98104355');
    expect(normalizeCatalogReference(undefined)).toBe('');
  });
});

describe('dédoublonnage des planches', () => {
  const groups = [
    { id: 11, drawings: [{ id: 'D1' }, { id: 'D2' }] },
    { id: 12, drawings: [{ id: 'D2' }, { id: 'D3' }] },
  ];
  test('une planche présente dans deux groupes n’est lue qu’une fois', () => {
    expect(core.uniqueDrawings(groups)).toEqual([
      { drawingId: 'D1', groupId: '11' }, { drawingId: 'D2', groupId: '11' }, { drawingId: 'D3', groupId: '12' },
    ]);
  });
  test('les planches déjà connues du DMS ne sont pas relues', () => {
    expect(core.withoutKnown(core.uniqueDrawings(groups), ['D1', 'D3'])).toEqual([{ drawingId: 'D2', groupId: '11' }]);
    expect(core.withoutKnown(core.uniqueDrawings(groups), new Set(['D2']))).toHaveLength(2);
  });
});

describe('réponses de l’e-catalog', () => {
  test('401 / 403 / redirection de connexion / page HTML = session à refaire', () => {
    expect(core.classifyResponse({ status: 401 })).toBe('auth');
    expect(core.classifyResponse({ status: 403 })).toBe('auth');
    expect(core.classifyResponse({ status: 200, redirected: true, url: 'https://idp.ducati.com/x/oauth2/v2.0/authorize', contentType: 'text/html' })).toBe('auth');
    expect(core.classifyResponse({ status: 200, url: 'https://e-catalog.ducati.com/EPC/api/x', contentType: 'text/html' })).toBe('auth');
  });
  test('429 = trop de requêtes ; 404 = on saute ; 5xx = réessai ; JSON = ok', () => {
    expect(core.classifyResponse({ status: 429 })).toBe('rate');
    expect(core.classifyResponse({ status: 404, contentType: 'text/html' })).toBe('notfound');
    expect(core.classifyResponse({ status: 503 })).toBe('server');
    expect(core.classifyResponse({ status: 200, contentType: 'application/json;charset=UTF-8' })).toBe('ok');
  });
});

describe('reprise (état dans chrome.storage.local)', () => {
  const plan = core.buildPlan(tree, {});
  test('reprend au modèle-année et à la planche où on s’était arrêté', () => {
    let s = core.newState(plan, { delayMs: 1200 });
    expect(core.resumePoint(s)).toEqual({ job: plan.jobs[0], remaining: null });
    s = core.startModelYear(s, '9001', [{ drawingId: 'D1', groupId: '11' }, { drawingId: 'D2', groupId: '11' }, { drawingId: 'D3', groupId: '12' }]);
    s = core.drawingsSent(s, 2);
    // fermeture du navigateur : l'état est relu tel quel
    const reloaded = JSON.parse(JSON.stringify(core.sanitizeState(s)));
    expect(core.resumePoint(reloaded)).toEqual({ job: plan.jobs[0], remaining: [{ drawingId: 'D3', groupId: '12' }] });
    expect(core.progress(reloaded)).toBeCloseTo(22.2, 1);
    s = core.modelYearDone(core.drawingsSent(reloaded, 1));
    expect(core.resumePoint(s)).toEqual({ job: plan.jobs[1], remaining: null });
    s = core.modelYearDone(core.modelYearDone(s, true));
    expect(s.status).toBe('done');
    expect(s.skipped).toBe(1);
    expect(core.resumePoint(s)).toBe(null);
  });
  test('l’état stocké ne contient aucun identifiant', () => {
    const s = { ...core.newState(plan), password: 'x', xsrfToken: 'y', nested: { sessionId: 'z', ok: 1 } };
    const clean = core.sanitizeState(s);
    expect(JSON.stringify(clean)).not.toMatch(/password|xsrf|session/i);
    expect(clean.nested).toEqual({ ok: 1 });
  });
  test('le rythme ne descend jamais sous 0,5 s', () => {
    expect(core.clampDelay(100)).toBe(500);
    expect(core.clampDelay(undefined)).toBe(1000);
    expect(core.clampDelay(2500)).toBe(2500);
  });
  test('estimation de durée', () => {
    expect(core.estimateHours(1000, 1000, 76, 1)).toBeCloseTo(26.7, 0);
    expect(core.estimateHours(1000, 1000, 76, 4)).toBeLessThan(8);
  });
});
