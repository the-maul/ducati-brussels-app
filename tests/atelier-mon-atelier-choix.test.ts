/**
 * M8 — « Mon atelier » : choix de l'atelier regarde (retour client du 19/11 : « je suis simon et
 * j'ai un rdv aujourd'hui, je le vois pas dans mon atelier »). Regles pures :
 *  - qui peut choisir (administrateur, chef d'atelier ; jamais un mecanicien simple) ;
 *  - adresse `?mechanic=` : moi / id d'une fiche compagnon / all ; valeur inconnue = moi ;
 *  - motos du jour d'un compagnon ou de tous (RDV attribues, OR a leur nom, OR pointes chez eux) ;
 *  - a qui est la moto et si les gestes demandent confirmation (pointage au nom du compte connecte) ;
 *  - message « compte relie a aucun mecanicien » a la place d'une liste vide.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  buildDayCards, canChooseWorkshop, cardGesture, cardOwner, chooserMechanics, effectiveView, myIdentity, notLinkedHint,
  parseWorkshopView, viewScope, workshopViewParam,
  type DayAppointment, type DayOr, type MechanicLite, type MyEntry,
} from '../src/modules/workshop/my-workshop/rules';

const ADMIN = 'user-simon-admin';
const ATELIER = 'user-simon-atelier';
const M_ATELIER = 'dadce629-dc54-4fda-a925-75ed5d4d4f76';
const M_DOME = 'd9c1d028-9ccd-4019-8fe6-04562ecd364d';
const mechanics: MechanicLite[] = [
  { id: M_DOME, name: 'Domenico Desouter', user_id: 'user-dome', is_active: true, visible_in_planning: true },
  { id: M_ATELIER, name: 'Simon-atelier', user_id: ATELIER, is_active: true, visible_in_planning: true },
  { id: '5edce1c3-c4f9-47eb-aa89-bb56aa74cfa5', name: 'John', user_id: null, is_active: true, visible_in_planning: true },
  { id: '6554b806-4e52-431d-9bf0-c02ec20a2441', name: 'Ancien', user_id: null, is_active: false, visible_in_planning: true },
  { id: 'b0b088fb-4c9a-44c1-8c8d-bdccab1bd021', name: 'Cache', user_id: null, is_active: true, visible_in_planning: false },
];
const admin = myIdentity(ADMIN, 'simon@themaul.be', mechanics); // relie a aucune fiche
const TODAY = '2026-11-19';

const appt = (p: Partial<DayAppointment> & { id: string }): DayAppointment => ({
  starts_at: '2026-11-19T08:00:00Z', status: 'prevu', or_id: null, mechanic_id: M_ATELIER, mechanic_name: 'Simon-atelier',
  unassigned: false, planned_minutes: 60, work_description: 'Entretien', ...p,
});
const or = (p: Partial<DayOr> & { id: string }): DayOr => ({
  number: p.id.toUpperCase(), status: 'a_faire', created_at: '2026-11-18T09:00:00Z', operator: null, operator_id: null,
  work_description: null, customer_approval: null, service_code: null, ...p,
});
const entry = (p: Partial<MyEntry> & { id: string; or_id: string | null }): MyEntry => ({
  kind: 'travail', mechanic_id: ATELIER, mechanic_code: null, mechanic_name: 'Simon-atelier', journey_operation: null,
  started_at: '2026-11-19T07:00:00Z', ended_at: null, minutes: null, stop_kind: null, stop_reason: null, ...p,
});

// Le cas du client : RDV ITALBIKE STORE du 19/11 09:00 (Bruxelles), OR cree, attribue a Simon-atelier.
const rdv = appt({ id: 'rdv-italbike', or_id: 'or-1' });
const or1 = or({ id: 'or-1', status: 'a_faire' });

describe('choix de l atelier — qui et quoi', () => {
  test('administrateur et chef d atelier choisissent ; mecanicien simple et autres non', () => {
    expect(canChooseWorkshop(['admin'])).toBe(true);
    expect(canChooseWorkshop(['mecanicien', 'chef_atelier'])).toBe(true);
    expect(canChooseWorkshop(['mecanicien'])).toBe(false);
    expect(canChooseWorkshop(['vendeur', 'magasinier'])).toBe(false);
    expect(canChooseWorkshop([])).toBe(false);
  });
  test('adresse : all, id de fiche, sinon moi', () => {
    expect(parseWorkshopView('all')).toEqual({ kind: 'all' });
    expect(parseWorkshopView(M_ATELIER.toUpperCase())).toEqual({ kind: 'mechanic', mechanicId: M_ATELIER });
    expect(parseWorkshopView('nimporte')).toEqual({ kind: 'me' });
    expect(parseWorkshopView(undefined)).toEqual({ kind: 'me' });
    expect(workshopViewParam({ kind: 'me' })).toBeUndefined();
    expect(workshopViewParam({ kind: 'all' })).toBe('all');
    expect(workshopViewParam(parseWorkshopView(M_ATELIER))).toBe(M_ATELIER);
  });
  test('un mecanicien simple voit toujours le sien, meme avec ?mechanic= dans l adresse', () => {
    expect(effectiveView({ kind: 'all' }, false, admin, mechanics)).toEqual({ kind: 'me' });
    expect(effectiveView({ kind: 'mechanic', mechanicId: M_ATELIER }, false, admin, mechanics)).toEqual({ kind: 'me' });
  });
  test('compagnon inconnu ou qui est ma propre fiche : moi', () => {
    expect(effectiveView({ kind: 'mechanic', mechanicId: '00000000-0000-0000-0000-000000000000' }, true, admin, mechanics)).toEqual({ kind: 'me' });
    const atelier = myIdentity(ATELIER, 'Simon-atelier', mechanics);
    expect(effectiveView({ kind: 'mechanic', mechanicId: M_ATELIER }, true, atelier, mechanics)).toEqual({ kind: 'me' });
    expect(effectiveView({ kind: 'mechanic', mechanicId: M_ATELIER }, true, admin, mechanics)).toEqual({ kind: 'mechanic', mechanicId: M_ATELIER });
  });
  test('le selecteur propose les compagnons actifs et visibles, sans mes fiches, par nom', () => {
    expect(chooserMechanics(mechanics, admin).map((m) => m.name)).toEqual(['Domenico Desouter', 'John', 'Simon-atelier']);
    const dome = myIdentity('user-dome', 'Domenico Desouter', mechanics);
    expect(chooserMechanics(mechanics, dome).map((m) => m.name)).toEqual(['John', 'Simon-atelier']);
  });
});

describe('choix de l atelier — motos du jour', () => {
  test('le cas du client : rien dans « Mes motos » pour l admin non relie, message utile', () => {
    const cards = buildDayCards({ me: admin, today: TODAY, appointments: [rdv], ors: [or1], myEntries: [] });
    const mine = cards.filter((c) => c.section === 'mine');
    expect(mine).toHaveLength(0);
    expect(cards.filter((c) => c.section === 'unassigned')).toHaveLength(0); // attribue : pas « non attribue »
    expect(notLinkedHint({ kind: 'me' }, admin, mine.length)).toBe(true);
  });
  test('atelier de Simon-atelier : le RDV du jour apparait avec son OR', () => {
    const scope = viewScope({ kind: 'mechanic', mechanicId: M_ATELIER }, mechanics);
    expect(scope?.label).toBe('Simon-atelier');
    const cards = buildDayCards({ me: admin, today: TODAY, appointments: [rdv], ors: [or1], myEntries: [], scope, scopeEntries: [] });
    expect(cards.map((c) => `${c.section}:${c.key}`)).toEqual(['mine:or:or-1']);
  });
  test('atelier d un autre : RDV attribue a quelqu un d autre exclu, OR a son nom et OR pointe chez lui inclus', () => {
    const scope = viewScope({ kind: 'mechanic', mechanicId: M_ATELIER }, mechanics);
    const cards = buildDayCards({
      me: admin, today: TODAY, scope,
      appointments: [rdv, appt({ id: 'rdv-dome', mechanic_id: M_DOME, mechanic_name: 'Domenico Desouter' })],
      ors: [or1, or({ id: 'or-op', status: 'en_cours', operator_id: ATELIER }), or({ id: 'or-pause', status: 'en_cours', operator: 'Domenico Desouter' })],
      myEntries: [],
      scopeEntries: [entry({ id: 'e1', or_id: 'or-pause', ended_at: '2026-11-18T17:00:00Z', stop_kind: 'pause' })],
    });
    expect(cards.filter((c) => c.section === 'mine').map((c) => c.key).sort()).toEqual(['or:or-1', 'or:or-op', 'or:or-pause']);
  });
  test('Tous : les RDV attribues de chacun et les OR a un nom ; les non attribues restent a part', () => {
    const scope = viewScope({ kind: 'all' }, mechanics);
    const cards = buildDayCards({
      me: admin, today: TODAY, scope, scopeEntries: [],
      appointments: [rdv, appt({ id: 'rdv-dome', mechanic_id: M_DOME, mechanic_name: 'Domenico Desouter' }), appt({ id: 'rdv-libre', mechanic_id: null, mechanic_name: null, unassigned: true })],
      ors: [or1, or({ id: 'or-txt', status: 'en_cours', operator: 'John' }), or({ id: 'or-free' })],
      myEntries: [],
    });
    expect(cards.filter((c) => c.section === 'mine').map((c) => c.key).sort()).toEqual(['or:or-1', 'or:or-txt', 'rdv:rdv-dome']);
    expect(cards.filter((c) => c.section === 'unassigned').map((c) => c.key)).toEqual(['or:or-free']);
  });
  test('sans choix (scope absent) : exactement le comportement du lot F', () => {
    const atelier = myIdentity(ATELIER, 'Simon-atelier', mechanics);
    const a = buildDayCards({ me: atelier, today: TODAY, appointments: [rdv], ors: [or1], myEntries: [] });
    const b = buildDayCards({ me: atelier, today: TODAY, appointments: [rdv], ors: [or1], myEntries: [], scope: null });
    expect(a).toEqual(b);
    expect(a.map((c) => c.key)).toEqual(['or:or-1']);
  });
});

describe('choix de l atelier — gestes et proprietaire', () => {
  const scope = viewScope({ kind: 'mechanic', mechanicId: M_ATELIER }, mechanics);
  test('moto d un autre : a son nom, gestes permis mais avec confirmation (foreign)', () => {
    const [card] = buildDayCards({ me: admin, today: TODAY, appointments: [rdv], ors: [or1], myEntries: [], scope, scopeEntries: [] });
    expect(cardOwner(card, admin, mechanics)).toEqual({ name: 'Simon-atelier', foreign: true });
    expect(cardGesture(card, true)).toBe('start'); // le geste reste celui du compte connecte
  });
  test('RDV sans OR : « Ouvrir l OR et demarrer », toujours sur confirmation', () => {
    const [card] = buildDayCards({ me: admin, today: TODAY, appointments: [appt({ id: 'r2' })], ors: [], myEntries: [], scope, scopeEntries: [] });
    expect(cardGesture(card, true)).toBe('create_or');
    expect(cardOwner(card, admin, mechanics).foreign).toBe(true);
  });
  test('moto que je pointe deja (dans l atelier de tous) : pas de confirmation', () => {
    const all = viewScope({ kind: 'all' }, mechanics);
    const mineEntry = entry({ id: 'm1', or_id: 'or-1', mechanic_id: ADMIN, mechanic_name: 'simon' });
    const [card] = buildDayCards({ me: admin, today: TODAY, appointments: [rdv], ors: [or1], myEntries: [mineEntry], scope: all, scopeEntries: [mineEntry] });
    expect(card.work?.mineOpen?.id).toBe('m1');
    expect(cardOwner(card, admin, mechanics).foreign).toBe(false);
    expect(cardGesture(card, true)).toBe('continue');
  });
  test('OR a mon nom par operator_id : nom du compagnon relie, pas etranger', () => {
    const dome = myIdentity('user-dome', 'Domenico Desouter', mechanics);
    const all = viewScope({ kind: 'all' }, mechanics);
    const [card] = buildDayCards({ me: dome, today: TODAY, appointments: [], ors: [or({ id: 'or-d', status: 'en_cours', operator_id: 'user-dome' })], myEntries: [], scope: all, scopeEntries: [] });
    expect(cardOwner(card, dome, mechanics)).toEqual({ name: 'Domenico Desouter', foreign: false });
  });
  test('OR non attribue : jamais de confirmation', () => {
    const [card] = buildDayCards({ me: admin, today: TODAY, appointments: [], ors: [or({ id: 'or-free' })], myEntries: [] });
    expect(card.section).toBe('unassigned');
    expect(cardOwner(card, admin, mechanics).foreign).toBe(false);
  });
  test('message « non relie » : seulement dans mon atelier, sans fiche et sans moto', () => {
    const atelier = myIdentity(ATELIER, 'Simon-atelier', mechanics);
    expect(notLinkedHint({ kind: 'me' }, atelier, 0)).toBe(false);
    expect(notLinkedHint({ kind: 'me' }, admin, 1)).toBe(false);
    expect(notLinkedHint({ kind: 'all' }, admin, 0)).toBe(false);
    // relie par le nom (repli du lot A) : pas de message
    const byName = myIdentity('user-john', 'John', mechanics);
    expect(byName.mechanicIds).toHaveLength(1);
    expect(notLinkedHint({ kind: 'me' }, byName, 0)).toBe(false);
  });
});
