/**
 * Mission 07, carte « Parcours d'entretien pas à pas » — règles pures
 * (src/modules/workshop/journey/rules.ts) : choix de l'entretien dû, construction du parcours,
 * avancement, chronos et comparaison des temps (officiel UT / passé / facturé B11).
 *
 * Les cas de rapprochement sont vérifiés sur les VRAIES données de démonstration
 * (public/demo/parcours-entretien.json, extraites des manuels Ducati par tools/journey-demo/build.mjs).
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import {
  normalizeService, serviceFamily, isRealService, dueServices, proceduresForService, buildOperations,
  isOperationDone, journeyProgress, resumePoint, elapsedMs, operationMinutes, spentMinutes,
  startChrono, stopChrono, runningOperationId, officialMinutes, compareTimes, billedMinutes,
  fmtMinutes, torqueLabel, warningTone, findingsToOrLines, summarize, MINUTES_PER_UT,
} from '../src/modules/workshop/journey/rules';
import type { Finding, JourneyState, MaintenanceProgram, OperationProgress } from '../src/modules/workshop/journey/types';

const op = (p: Partial<OperationProgress> & { id: string }): OperationProgress => ({
  label: p.id, parcoursId: null, done: false, steps: {}, note: '', chrono: [], ...p,
});

describe('noms d’entretien : le manuel ne les écrit pas deux fois pareil', () => {
  test('sans accent, sans ponctuation, en minuscules', () => {
    expect(normalizeService('OIL Service 15000')).toBe('oil service 15000');
    expect(normalizeService('Contrôle et/ou réglage du jeu aux soupapes')).toBe('controle et ou reglage du jeu aux soupapes');
  });

  test('« First Service 1000 », « Oil Service 1000 » et « Service 1000 » sont le même premier entretien', () => {
    expect(serviceFamily('First Service 1000')).toBe('premier_1000');
    expect(serviceFamily('Oil Service 1000')).toBe('premier_1000');
    expect(serviceFamily('Service 1000')).toBe('premier_1000');
    expect(serviceFamily('OIL SERVICE 1000')).toBe('premier_1000');
  });

  test('« Temporel », « Annual Service » et « Annual Service (24) » sont l’entretien annuel', () => {
    expect(serviceFamily('Temporel')).toBe('annual');
    expect(serviceFamily('Annual Service')).toBe('annual');
    expect(serviceFamily('Annual Service (24)')).toBe('annual');
  });

  test('Desmo et Oil restent distincts, « Interventions DESMO SERVICE » reste Desmo', () => {
    expect(serviceFamily('Desmo Service')).toBe('desmo');
    expect(serviceFamily('Interventions DESMO SERVICE')).toBe('desmo');
    expect(serviceFamily('OIL Service')).toBe('oil');
    expect(serviceFamily('Oil Service')).not.toBe(serviceFamily('Desmo Service'));
    expect(serviceFamily('Valve Check')).toBe('valve');
  });

  test('les en-têtes de colonnes du tableau ne sont pas des entretiens', () => {
    expect(isRealService('km x 1000')).toBe(false);
    expect(isRealService('mi x 1000')).toBe(false);
    expect(isRealService('Temps (mois)')).toBe(false);
    expect(isRealService('Desmo Service')).toBe(true);
  });
});

describe('quel entretien est dû (premier atteint : km ou mois)', () => {
  const program = {
    services: [
      { service: 'First Service 1000', km: 1000, mois: null, premiereEcheance: true },
      { service: 'Oil Service', km: 15000, mois: null },
      { service: 'Desmo Service', km: 30000, mois: null },
      { service: 'Annual Service', km: null, mois: 12 },
      { service: 'km x 1000', km: null, mois: null },
    ],
    echeances: [
      { echeance: 'First Service 1000', km: 1000, operations: ['a', 'b'] },
      { echeance: 'Oil Service', km: 15000, operations: ['a', 'b', 'c'] },
      { echeance: 'Desmo Service', km: 30000, operations: ['d'] },
      { echeance: 'Annual Service', mois: 12, operations: [] },
    ],
  } satisfies Pick<MaintenanceProgram, 'services' | 'echeances'>;

  test('l’en-tête de colonne est écarté de la liste', () => {
    const d = dueServices(program, { km: 500, date: '2026-09-23' }, null, { date: '2026-01-01' });
    expect(d.map((x) => x.service.service)).not.toContain('km x 1000');
    expect(d).toHaveLength(4);
  });

  test('moto neuve à 1 200 km : le premier entretien est dû, en tête', () => {
    const d = dueServices(program, { km: 1200, date: '2026-09-23' }, null, { date: '2026-06-01' });
    expect(d[0].service.service).toBe('First Service 1000');
    expect(d[0].reached).toBe(true);
    expect(d[0].reachedBy).toBe('km');
    expect(d[0].dueKm).toBe(1000);
  });

  test('un an après la mise en service, l’entretien annuel est dû même à faible kilométrage', () => {
    const d = dueServices(program, { km: 400, date: '2026-09-23' }, null, { date: '2025-06-01' });
    const annual = d.find((x) => x.service.service === 'Annual Service')!;
    expect(annual.reached).toBe(true);
    expect(annual.reachedBy).toBe('mois');
    expect(annual.dueDate).toBe('2026-06-01');
  });

  test('chaque entretien reçoit ses opérations, et l’échéance sans opération vaut 0 (pas une erreur)', () => {
    const d = dueServices(program, { km: 1200, date: '2026-09-23' }, null, { date: '2026-06-01' });
    expect(d.find((x) => x.service.service === 'Oil Service')!.operations).toBe(3);
    expect(d.find((x) => x.service.service === 'Annual Service')!.operations).toBe(0);
  });

  test('rien d’atteint : les entretiens sont proposés du plus proche au plus lointain', () => {
    const d = dueServices(program, { km: 300, date: '2026-02-01' }, null, { date: '2026-01-01' });
    expect(d.every((x) => !x.reached)).toBe(true);
    expect(d.map((x) => x.dueKm)).toEqual([1000, 15000, 30000, null]);
  });

  test('après un Oil Service à 15 000 km, la prochaine échéance est à 30 000 km', () => {
    const d = dueServices(program, { km: 16000, date: '2026-09-23' }, { oil: { km: 15000, date: '2026-08-01' } }, { date: '2024-01-01' });
    expect(d.find((x) => x.service.service === 'Oil Service')!.dueKm).toBe(30000);
    expect(d.find((x) => x.service.service === 'Oil Service')!.reached).toBe(false);
  });
});

describe('construction du parcours : opérations ↔ procédures', () => {
  const program: MaintenanceProgram = {
    modelYearId: '1', famille: 'F', modele: 'M', annee: '2024',
    services: [{ service: 'Desmo Service', km: 24000 }],
    echeances: [{
      echeance: 'Desmo Service', km: 24000,
      operations: [
        'Remplacement du filtre à air',
        'Contrôle et/ou réglage du jeu aux soupapes',
        'Contrôle lamelles air secondaire (si présentes)',
      ],
    }],
    proceduresParService: {
      'DESMO Service': [
        { parcoursId: 'p-air', titre: 'Remplacement et nettoyage des filtres à air', operation: 'Remplacement du filtre à air' },
        { parcoursId: 'p-soup', titre: 'Contrôle du jeu aux soupapes', operation: 'Contrôle du jeu aux soupapes' },
        { parcoursId: 'p-orph', titre: 'Vidange du liquide de refroidissement', operation: 'Vidange du liquide de refroidissement' },
      ],
    },
    temps: [],
  };

  test('le nom exact de l’opération trouve sa procédure', () => {
    const ops = buildOperations(program, 'Desmo Service');
    expect(ops[0].label).toBe('Remplacement du filtre à air');
    expect(ops[0].parcoursId).toBe('p-air');
  });

  test('un libellé approchant trouve quand même la procédure (mots en commun)', () => {
    const ops = buildOperations(program, 'Desmo Service');
    expect(ops[1].label).toContain('jeu aux soupapes');
    expect(ops[1].parcoursId).toBe('p-soup');
  });

  test('§6 — une opération sans procédure reste listée, avec une simple case à cocher', () => {
    const ops = buildOperations(program, 'Desmo Service');
    expect(ops[2].label).toContain('lamelles air secondaire');
    expect(ops[2].parcoursId).toBeNull();
  });

  test('une procédure qu’aucune opération ne réclame est ajoutée en fin de parcours (rien ne se perd)', () => {
    const ops = buildOperations(program, 'Desmo Service');
    expect(ops).toHaveLength(4);
    expect(ops[3].parcoursId).toBe('p-orph');
    expect(ops[3].label).toBe('Vidange du liquide de refroidissement');
  });

  test('une même procédure n’est jamais rattachée deux fois', () => {
    const ops = buildOperations(program, 'Desmo Service');
    const ids = ops.map((o) => o.parcoursId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('le nom d’entretien du programme (« Desmo Service ») retrouve la clé du manuel (« DESMO Service »)', () => {
    expect(proceduresForService(program, 'Desmo Service')).toHaveLength(3);
  });

  test('identifiants d’opération stables (reprise après coupure)', () => {
    expect(buildOperations(program, 'Desmo Service').map((o) => o.id))
      .toEqual(buildOperations(program, 'Desmo Service').map((o) => o.id));
  });
});

describe('avancement', () => {
  const counts = { A: 4, B: 2 };

  test('une opération est faite quand toutes ses étapes sont cochées', () => {
    const a = op({ id: 'op1', parcoursId: 'A', steps: { '1': 'x', '2': 'x', '3': 'x', '4': 'x' } });
    expect(isOperationDone(a, counts.A)).toBe(true);
    expect(isOperationDone(op({ id: 'op1', parcoursId: 'A', steps: { '1': 'x' } }), counts.A)).toBe(false);
  });

  test('sans procédure, seule la case du technicien compte', () => {
    expect(isOperationDone(op({ id: 'op9' }), 0)).toBe(false);
    expect(isOperationDone(op({ id: 'op9', done: true }), 0)).toBe(true);
  });

  test('une opération cochée à la main est faite même si des étapes restent', () => {
    expect(isOperationDone(op({ id: 'op1', parcoursId: 'A', done: true, steps: { '1': 'x' } }), counts.A)).toBe(true);
  });

  test('pourcentage : une opération sans procédure vaut une étape', () => {
    const ops = [
      op({ id: 'op1', parcoursId: 'A', steps: { '1': 'x', '2': 'x' } }), // 2/4
      op({ id: 'op2', parcoursId: 'B' }),                                 // 0/2
      op({ id: 'op3', done: true }),                                      // 1/1
    ];
    const p = journeyProgress(ops, counts);
    expect(p.stepsTotal).toBe(7);
    expect(p.stepsDone).toBe(3);
    expect(p.percent).toBe(43);
    expect(p.opsDone).toBe(1);
    expect(p.opsTotal).toBe(3);
  });

  test('parcours vide : 0 % et pas de division par zéro', () => {
    expect(journeyProgress([], {}).percent).toBe(0);
  });

  test('reprise après coupure : première opération non faite, première étape non cochée', () => {
    const ops = [
      op({ id: 'op1', parcoursId: 'A', steps: { '1': 'x', '2': 'x', '3': 'x', '4': 'x' } }),
      op({ id: 'op2', parcoursId: 'B', steps: { '1': 'x' } }),
    ];
    expect(resumePoint(ops, counts)).toEqual({ operationId: 'op2', stepNo: 2 });
  });

  test('tout est fait → plus rien à reprendre', () => {
    const ops = [op({ id: 'op1', done: true }), op({ id: 'op2', done: true })];
    expect(resumePoint(ops, counts)).toBeNull();
  });
});

describe('chronos par opération', () => {
  const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 23, h, m)).toISOString();

  test('temps cumulé sur plusieurs segments', () => {
    const a = op({ id: 'op1', chrono: [{ startedAt: T(8), endedAt: T(8, 30) }, { startedAt: T(9), endedAt: T(9, 12) }] });
    expect(operationMinutes(a)).toBe(42);
  });

  test('un segment ouvert compte jusqu’à maintenant', () => {
    const a = op({ id: 'op1', chrono: [{ startedAt: T(8), endedAt: null }] });
    expect(operationMinutes(a, new Date(T(8, 25)))).toBe(25);
  });

  test('on arrondit à la minute inférieure : jamais de temps gonflé', () => {
    expect(elapsedMs([{ startedAt: T(8), endedAt: null }], new Date(T(8, 0)).getTime() + 119_000)).toBe(119_000);
    expect(operationMinutes(op({ id: 'x', chrono: [{ startedAt: T(8), endedAt: null }] }), new Date(T(8, 0)).getTime() + 119_000)).toBe(1);
  });

  test('démarrer une opération arrête celle qui tournait (un seul chrono à la fois)', () => {
    let ops = [op({ id: 'op1' }), op({ id: 'op2' })];
    ops = startChrono(ops, 'op1', new Date(T(8)));
    expect(runningOperationId(ops)).toBe('op1');
    ops = startChrono(ops, 'op2', new Date(T(8, 20)));
    expect(runningOperationId(ops)).toBe('op2');
    expect(operationMinutes(ops[0], new Date(T(9)))).toBe(20);
  });

  test('arrêt : plus rien ne tourne, le temps est figé', () => {
    let ops = startChrono([op({ id: 'op1' })], 'op1', new Date(T(8)));
    ops = stopChrono(ops, new Date(T(8, 45)));
    expect(runningOperationId(ops)).toBeNull();
    expect(spentMinutes(ops, new Date(T(23)))).toBe(45);
  });

  test('un segment sans date exploitable est ignoré', () => {
    expect(elapsedMs([{ startedAt: 'n’importe quoi', endedAt: null }], Date.now())).toBe(0);
  });
});

describe('temps officiel Ducati (UT) et rapprochement B11', () => {
  const temps = [
    { intitule: 'OIL SERVICE 1000', minutes: 66, ut: 11 },
    { intitule: 'OIL SERVICE 15000', minutes: 102, ut: 17 },
    { intitule: 'ANNUAL SERVICE', minutes: 30, ut: 5 },
    { intitule: 'Interventions DESMO SERVICE', minutes: 180, ut: 30 },
    { intitule: 'OIL SERVICE + Interventions DESMO SERVICE', minutes: 252, ut: 42 },
  ];

  test('1 UT = 6 minutes quand le manuel ne donne que les UT', () => {
    expect(MINUTES_PER_UT).toBe(6);
    expect(officialMinutes([{ intitule: 'Desmo Service', ut: 30 }], 'Desmo Service')).toBe(180);
  });

  test('le kilométrage de l’entretien départage « OIL SERVICE 1000 » et « OIL SERVICE 15000 »', () => {
    expect(officialMinutes(temps, 'Oil Service', 15000)).toBe(102);
    expect(officialMinutes(temps, 'First Service 1000', 1000)).toBe(66);
  });

  test('les intitulés composés (« OIL + DESMO ») ne sont jamais pris pour un entretien simple', () => {
    expect(officialMinutes(temps, 'Desmo Service', 30000)).toBe(180);
  });

  test('« Temporel » retrouve « ANNUAL SERVICE »', () => {
    expect(officialMinutes(temps, 'Temporel')).toBe(30);
  });

  test('aucun temps publié → null, jamais une valeur inventée', () => {
    expect(officialMinutes(temps, 'Valve Check', 45000)).toBeNull();
    expect(officialMinutes([], 'Oil Service')).toBeNull();
    expect(officialMinutes(null, 'Oil Service')).toBeNull();
  });

  test('temps facturé = heures de main-d’œuvre de l’OR × 60', () => {
    expect(billedMinutes([{ kind: 'mo', quantity: 1.5 }, { kind: 'piece', quantity: 3 }])).toBe(90);
    expect(billedMinutes([{ kind: 'mo', quantity: '2' }, { kind: 'mo', quantity: 0.5 }])).toBe(150);
  });

  test('aucune ligne de main-d’œuvre → pas de temps facturé (et pas 0)', () => {
    expect(billedMinutes([{ kind: 'piece', quantity: 1 }])).toBeNull();
    expect(billedMinutes([])).toBeNull();
  });

  test('écart au barème et au facturé', () => {
    const c = compareTimes(120, 102, 90);
    expect(c.vsOfficial).toBe(18);
    expect(c.vsBilled).toBe(30);
    expect(c.ratio).toBe(1.18);
  });

  test('sans barème ni facturé, on n’invente pas d’écart', () => {
    const c = compareTimes(120, null, null);
    expect(c.vsOfficial).toBeNull();
    expect(c.vsBilled).toBeNull();
    expect(c.ratio).toBeNull();
  });

  test('affichage lisible à l’atelier', () => {
    expect(fmtMinutes(42)).toBe('42 min');
    expect(fmtMinutes(102)).toBe('1 h 42');
    expect(fmtMinutes(-18)).toBe('−18 min');
    expect(fmtMinutes(null)).toBe('—');
  });
});

describe('affichage : couples et avertissements', () => {
  test('la valeur en Nm passe devant, la plage suit', () => {
    expect(torqueLabel({ valeurNm: 6, min: 5.4, max: 6.6 })).toBe('6 Nm (5,4 – 6,6)');
    expect(torqueLabel({ valeurNm: 25, tolerance: '±10%' })).toBe('25 Nm ±10%');
  });

  test('sans valeur chiffrée, on retombe sur le texte du manuel', () => {
    expect(torqueLabel({ valeurNm: null, texte: 'Serrer à la main' })).toBe('Serrer à la main');
  });

  test('Attention, Important et Remarque ne se ressemblent pas', () => {
    expect(warningTone('attention')).toBe('danger');
    expect(warningTone('important')).toBe('warning');
    expect(warningTone('elimination')).toBe('warning');
    expect(warningTone('remarque')).toBe('info');
  });
});

describe('récapitulatif de fin : rien n’est facturé automatiquement', () => {
  const findings: Finding[] = [
    { id: 'f1', kind: 'piece', operationId: 'op1', stepNo: 3, texte: 'Plaquettes avant usées', reference: '61340601A', quantity: 2, at: '2026-09-23T09:00:00.000Z' },
    { id: 'f2', kind: 'observation', operationId: 'op2', stepNo: null, texte: 'Chaîne en limite', at: '2026-09-23T09:10:00.000Z' },
    { id: 'f3', kind: 'photo', operationId: 'op2', stepNo: 4, texte: 'fuite', photoName: 'fuite.jpg', at: '2026-09-23T09:12:00.000Z' },
  ];

  test('une pièce devient une ligne pièce avec sa référence, une observation une ligne texte', () => {
    const lines = findingsToOrLines(findings);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ kind: 'piece', designation: '61340601A — Plaquettes avant usées', quantity: 2 });
    expect(lines[1]).toEqual({ kind: 'texte', designation: 'Chaîne en limite', quantity: 1 });
  });

  test('quantité absente ou nulle → 1', () => {
    expect(findingsToOrLines([{ ...findings[0], quantity: null }])[0].quantity).toBe(1);
  });

  test('le récapitulatif reprend tout : fait, temps, pièces, observations, restant', () => {
    const state: JourneyState = {
      version: 1, orId: 'or1', modelYearId: '398', serviceLabel: 'Oil Service',
      startedAt: '2026-09-23T08:00:00.000Z', finishedAt: null, reportedToOr: false,
      findings,
      operations: [
        op({ id: 'op1', parcoursId: 'A', steps: { '1': 'x', '2': 'x' }, chrono: [{ startedAt: '2026-09-23T08:00:00.000Z', endedAt: '2026-09-23T09:00:00.000Z' }] }),
        op({ id: 'op2', label: 'Contrôle visuel' }),
      ],
    };
    const s = summarize(state, { A: 2 }, 102, 90, new Date('2026-09-23T10:00:00.000Z'));
    expect(s.progress.opsDone).toBe(1);
    expect(s.spent).toBe(60);
    expect(s.times.vsOfficial).toBe(-42);
    expect(s.times.vsBilled).toBe(-30);
    expect(s.parts).toHaveLength(1);
    expect(s.observations).toHaveLength(1);
    expect(s.photos).toHaveLength(1);
    expect(s.pending.map((p) => p.label)).toEqual(['Contrôle visuel']);
    expect(s.lines).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Données réelles : le fichier de démonstration extrait des manuels Ducati.
// Généré par `node tools/journey-demo/build.mjs` ; le test est ignoré s'il manque.
// ---------------------------------------------------------------------------
const DEMO = 'public/demo/parcours-entretien.json';

describe('données réelles des manuels (DesertX 2023, Panigale V4 S 2024)', () => {
  if (!existsSync(DEMO)) {
    test.skip('fichier de démonstration absent — lancer node tools/journey-demo/build.mjs', () => {});
    return;
  }
  const demo = JSON.parse(readFileSync(DEMO, 'utf8')) as {
    bikes: MaintenanceProgram[]; procedures: Record<string, { etapes: unknown[] }>;
  };
  const desertx = demo.bikes.find((b) => b.modele.startsWith('DESERTX'))!;
  const panigale = demo.bikes.find((b) => b.modele.startsWith('PANIGALE'))!;

  test('les deux motos de démonstration sont là avec leur modèle-année', () => {
    expect(desertx.modelYearId).toBe('398');
    expect(panigale.modelYearId).toBe('1190');
  });

  test('DesertX 2023 : les quatre entretiens du manuel, sans en-tête de colonne', () => {
    const d = dueServices(desertx, { km: 16000, date: '2026-09-23' }, null, { date: '2023-04-01' });
    expect(d.map((x) => x.service.service).sort()).toEqual(['Annual Service', 'Desmo Service', 'First Service 1000', 'Oil Service']);
  });

  test('DesertX à 16 000 km depuis 2023 : le Oil Service est dû et détaille ses opérations', () => {
    const d = dueServices(desertx, { km: 16000, date: '2026-09-23' }, null, { date: '2023-04-01' });
    const oil = d.find((x) => x.service.service === 'Oil Service')!;
    expect(oil.reached).toBe(true);
    expect(oil.operations).toBeGreaterThan(10);
  });

  test('le Oil Service de la DesertX construit un parcours avec des procédures pas à pas', () => {
    const ops = buildOperations(desertx, 'Oil Service');
    expect(ops.length).toBeGreaterThan(10);
    const withProc = ops.filter((o) => o.parcoursId);
    expect(withProc.length).toBeGreaterThan(3);
    for (const o of withProc) expect(demo.procedures[o.parcoursId!]).toBeTruthy();
  });

  test('§6 — des opérations sans procédure coexistent avec les autres, sans bloquer', () => {
    const ops = buildOperations(desertx, 'Oil Service');
    expect(ops.some((o) => !o.parcoursId)).toBe(true);
  });

  test('temps officiel du Oil Service DesertX : 1 h 42 (17 UT), pris dans le poster', () => {
    expect(officialMinutes(desertx.temps, 'Oil Service', 15000)).toBe(102);
    expect(fmtMinutes(officialMinutes(desertx.temps, 'Oil Service', 15000))).toBe('1 h 42');
  });

  test('Panigale V4 S 2024 : le Desmo Service se construit aussi, sans temps publié', () => {
    const ops = buildOperations(panigale, 'Desmo Service');
    expect(ops.length).toBeGreaterThan(5);
    expect(officialMinutes(panigale.temps, 'Desmo Service', 24000)).toBeNull();
  });

  test('toutes les procédures citées par les parcours existent dans le fichier', () => {
    for (const bike of demo.bikes) {
      for (const list of Object.values(bike.proceduresParService)) {
        for (const p of list) expect(demo.procedures[p.parcoursId]).toBeTruthy();
      }
    }
  });
});
