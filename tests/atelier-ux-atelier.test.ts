/**
 * M8 — Lot UX atelier (20/11/2026) : « Mon atelier » selon la maquette de la revue UX/UI et fiche
 * OR en 3 onglets. Regles PURES de presentation, aucune regle metier nouvelle :
 *  - onglets de la fiche OR : nom dans l'adresse, onglet par defaut selon l'etape ;
 *  - frise des cartes = frise de la fiche OR (meme calcul `orProgress`) ;
 *  - badges seulement pour les alertes ;
 *  - un seul « a faire maintenant » (un seul bouton rouge) ;
 *  - une seule confirmation (ancien OR + moto d'un autre + autre travail) ;
 *  - libelles presents dans les quatre langues.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultOrTab, editorPane, parseOrTab, OR_TABS } from '../src/modules/workshop/or-base/or-tabs';
import { orProgress, type OrProgressInput } from '../src/modules/workshop/or-base/progress-rules';
import { cardAlerts, cardProgressInput, cardSteps, doNowKey, durationParts, startReasons } from '../src/modules/workshop/my-workshop/card-view';
import type { DayCard } from '../src/modules/workshop/my-workshop/rules';
import { uxAtelierEn, uxAtelierFr, uxAtelierIt, uxAtelierNl } from '../src/lib/i18n/ux-atelier';

const ROOT = join(import.meta.dir, '..');

const or = (patch: Partial<NonNullable<DayCard['or']>> = {}): NonNullable<DayCard['or']> => ({
  id: 'or1', number: 'OR-2026-00004', status: 'a_faire', created_at: '2026-11-20T08:00:00Z',
  operator: null, operator_id: null, work_description: null, customer_approval: null, service_code: 'annual', ...patch,
});
const rdv = (patch: Partial<NonNullable<DayCard['appointment']>> = {}): NonNullable<DayCard['appointment']> => ({
  id: 'a1', starts_at: '2026-11-20T08:00:00Z', status: 'confirme', or_id: null, mechanic_id: null, mechanic_name: null,
  unassigned: false, planned_minutes: 120, work_description: null, service_code: 'annual', ...patch,
});
const card = (patch: Partial<DayCard> = {}): DayCard => ({ key: 'k1', section: 'mine', or: or(), appointment: null, work: null, ...patch });
const ctx = { receptionReady: true, pointageReady: true };

describe('fiche OR : 3 onglets', () => {
  test('trois onglets, noms dans l\'adresse', () => {
    expect([...OR_TABS]).toEqual(['travail', 'lignes', 'documents']);
    expect(parseOrTab('lignes')).toBe('lignes');
    expect(parseOrTab('autre')).toBeUndefined();
    expect(parseOrTab(undefined)).toBeUndefined();
  });
  test('onglet par defaut selon l\'etape : Travail tant qu\'on travaille, Lignes et prix a la facturation', () => {
    for (const s of ['a_faire', 'en_cours', 'attente_pieces', 'attente_devis']) expect(defaultOrTab(s)).toBe('travail');
    for (const s of ['pret', 'client_informe', 'facture']) expect(defaultOrTab(s)).toBe('lignes');
    expect(defaultOrTab(null)).toBe('travail');
  });
  test('volet de l\'editeur par onglet (Documents : aucun)', () => {
    expect(editorPane('travail')).toBe('work');
    expect(editorPane('lignes')).toBe('lines');
    expect(editorPane('documents')).toBe('none');
  });
});

describe('frise : la meme que la fiche OR', () => {
  test('la carte calcule la frise avec orProgress (memes etapes, meme etat)', () => {
    const c = card({ or: or({ status: 'en_cours' }) });
    const p = { ...ctx, reception: { status: 'complete' as const, missing: 0 }, workStatus: { work_state: 'running' as const }, progress: { total: 28, done: 3, not_done: 0, mandatory_open: 25 } };
    const direct = orProgress(cardProgressInput(c, p)).steps;
    expect(cardSteps(c, p)).toEqual(direct);
    expect(direct.map((s) => s.key)).toEqual(['reception', 'work', 'operations', 'ready', 'invoice']);
    expect(direct.find((s) => s.key === 'operations')).toEqual({ key: 'operations', state: 'current', count: { done: 3, total: 28 } });
  });
  test('RDV sans OR avec un entretien : 5 etapes, tout a faire, Operations sans compteur', () => {
    const steps = cardSteps(card({ or: null, appointment: rdv() }), ctx);
    expect(steps.map((s) => s.key)).toEqual(['reception', 'work', 'operations', 'ready', 'invoice']);
    expect(steps.find((s) => s.key === 'operations')).toEqual({ key: 'operations', state: 'todo' });
    expect(steps[0].state).toBe('current');
  });
  test('planExpected n\'ajoute rien quand la liste existe ou que l\'OR est fini', () => {
    const base: OrProgressInput = {
      orStatus: 'pret', receptionOn: false, receptionStatus: 'none', photosTaken: 0, photosTotal: 0, photosMissing: 0,
      pointageOn: true, workState: 'stopped', mineRunning: false, minePaused: false, planTotal: 0, planResolved: 0,
      planMandatoryOpen: 0, hasService: true, workAllowed: true, warrantyPending: false, planExpected: true,
    };
    expect(orProgress(base).steps.some((s) => s.key === 'operations')).toBe(false);
    const withPlan = orProgress({ ...base, orStatus: 'en_cours', workState: 'running', planTotal: 4, planResolved: 1, planMandatoryOpen: 3 });
    expect(withPlan.steps.filter((s) => s.key === 'operations')).toHaveLength(1);
    // sans planExpected : comportement d'origine (pas d'etape Operations sans liste)
    expect(orProgress({ ...base, orStatus: 'a_faire', workState: 'none', planExpected: undefined }).steps.some((s) => s.key === 'operations')).toBe(false);
  });
  test('accord client en attente : la frise ne demarre rien (meme lecture que l\'OR)', () => {
    const input = cardProgressInput(card({ or: or({ customer_approval: 'en_attente' }) }), ctx);
    expect(input.workAllowed).toBe(false);
    expect(orProgress(input).next).toBe('none');
  });
});

describe('badges : seulement les alertes', () => {
  test('pieces manquantes, ancien OR, accord client en attente', () => {
    expect(cardAlerts(card(), { parts: { state: 'missing', total: 2, missing: 2 }, old: false })).toEqual(['parts_missing']);
    expect(cardAlerts(card(), { parts: { state: 'reserved', total: 2, missing: 0 }, old: true })).toEqual(['old_or']);
    expect(cardAlerts(card({ or: or({ customer_approval: 'en_attente' }) }), { parts: null, old: false })).toEqual(['approval_pending']);
    expect(cardAlerts(card(), { parts: { state: 'prepared', total: 2, missing: 0 }, old: false })).toEqual([]);
  });
});

describe('un seul bouton rouge : la moto a faire maintenant', () => {
  const list = [
    { key: 'a', gesture: 'none' as const, old: false },
    { key: 'b', gesture: 'start' as const, old: true },
    { key: 'c', gesture: 'create_or' as const, old: false },
    { key: 'd', gesture: 'start' as const, old: false },
  ];
  test('la premiere moto avec un geste de depart, jamais un ancien OR', () => {
    expect(doNowKey(list, { running: false, shared: false })).toBe('c');
  });
  test('aucune quand un pointage tourne (le rouge est « Continuer le parcours ») ou sur tablette partagee', () => {
    expect(doNowKey(list, { running: true, shared: false })).toBeNull();
    expect(doNowKey(list, { running: false, shared: true })).toBeNull();
  });
  test('rien a demarrer : aucune', () => {
    expect(doNowKey([{ key: 'x', gesture: 'continue', old: false }, { key: 'y', gesture: 'blocked', old: false }], { running: false, shared: false })).toBeNull();
  });
});

describe('une seule confirmation avant de travailler', () => {
  const base = {
    gesture: 'start' as const, shared: false, oldWithTodayRdv: false, owner: { foreign: false, name: null },
    meLinked: true, running: null, cardOrId: 'or1',
  };
  test('ma moto, rien en cours : aucune question', () => {
    expect(startReasons(base)).toEqual([]);
  });
  test('moto d\'un autre + autre travail + ancien OR : une seule liste, dans l\'ordre', () => {
    const r = startReasons({
      ...base, oldWithTodayRdv: true, owner: { foreign: true, name: 'John' }, meLinked: false,
      running: { entryId: 'e3', orId: 'or3', kind: 'travail' },
    });
    expect(r).toEqual([
      { kind: 'old_or' },
      { kind: 'foreign', name: 'John', notLinked: true },
      { kind: 'switch', entryId: 'e3', orId: 'or3', task: false },
    ]);
  });
  test('je travaille deja sur cette moto : pas de « mis en pause »', () => {
    expect(startReasons({ ...base, running: { entryId: 'e1', orId: 'or1', kind: 'travail' } })).toEqual([]);
  });
  test('tache hors OR en cours : annoncee comme tache', () => {
    expect(startReasons({ ...base, running: { entryId: 'e9', orId: null, kind: 'improductif' } })).toEqual([{ kind: 'switch', entryId: 'e9', orId: null, task: true }]);
  });
  test('tablette partagee : ni « moto d\'un autre » ni « mis en pause » (la base demande pour la personne identifiee)', () => {
    expect(startReasons({ ...base, shared: true, owner: { foreign: true, name: 'John' }, running: { entryId: 'e3', orId: 'or3', kind: 'travail' } })).toEqual([]);
  });
  test('Continuer : jamais de question', () => {
    expect(startReasons({ ...base, gesture: 'continue', owner: { foreign: true, name: 'John' } })).toEqual([]);
  });
  test('RDV sans OR : pas d\'« ancien OR »', () => {
    expect(startReasons({ ...base, gesture: 'create_or', oldWithTodayRdv: true, cardOrId: null })).toEqual([]);
  });
});

describe('duree du pointage', () => {
  test('minutes et heures', () => {
    const from = '2026-11-20T08:00:00Z';
    expect(durationParts(from, Date.parse('2026-11-20T08:42:30Z'))).toEqual({ h: 0, min: 42 });
    expect(durationParts(from, Date.parse('2026-11-20T09:05:00Z'))).toEqual({ h: 1, min: 5 });
    expect(durationParts(from, Date.parse('2026-11-20T07:00:00Z'))).toEqual({ h: 0, min: 0 });
  });
});

describe('libelles et ecran', () => {
  test('memes cles dans les quatre langues', () => {
    const keys = Object.keys(uxAtelierFr).sort();
    for (const d of [uxAtelierNl, uxAtelierEn, uxAtelierIt]) expect(Object.keys(d).sort()).toEqual(keys);
  });
  test('« Mon atelier » : plus de reglage de page d\'accueil ni de lien Pointeuse, un seul « Demarrer »', () => {
    const src = readFileSync(join(ROOT, 'src/modules/workshop/my-workshop/my-workshop-screen.tsx'), 'utf8');
    expect(src).not.toContain('HomePrefSetting');
    expect(src).not.toContain("to: '/workshop/chrono'");
    expect(src).not.toContain('myWorkshop.createOr');
    expect(src).not.toContain('myWorkshop.foreignConfirm');
    expect(src).toContain('OrStepsTrail');
  });
  test('fiche OR : onglets, ligne d\'identite et « Plus d\'actions » gardes', () => {
    const src = readFileSync(join(ROOT, 'src/routes/_app.workshop.$orId.tsx'), 'utf8');
    for (const k of ["'uxAtelier.tab_travail'", "'uxAtelier.tab_lignes'", "'uxAtelier.tab_documents'", "'orLisible.moreActions'", 'identity={identity}', 'validateSearch']) {
      expect(src).toContain(k);
    }
    // toutes les fonctions du menu sont toujours la
    for (const k of ['workshop.toInvoice', 'workshop.quoteParts', 'parcG8.repairQuote', 'workshop.createPicking', 'basket.addToStandard', 'purchasesG8.propButton', 'orBase.notifyReady', 'parcG8.duplicateOr', 'accidentFile.open']) {
      expect(src).toContain(k);
    }
  });
});
