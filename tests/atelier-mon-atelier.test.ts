/**
 * M8 — Parcours mecanicien, lot F (19/11/2026) : ecran tablette « Mon atelier », regles pures.
 *  - page d'accueil : reglage du compte, sinon mecanicien / chef d'atelier → Mon atelier ;
 *  - qui suis-je : compagnon lie au compte, sinon par le nom (sans accents ni casse) ;
 *  - mes motos du jour : RDV du jour a mon nom (fuseau de Bruxelles), OR a mon nom, OR ou j'ai un
 *    pointage en pause (meme d'hier), OR « a faire » non attribues ; jamais facture / annule ;
 *  - un geste par moto : Creer l'OR, Demarrer, Reprendre, Continuer, bloque (accord client) ;
 *  - photos d'abord (lot C) seulement pour Demarrer, puis parcours (lot D) ou fiche OR ;
 *  - pieces (lot B) et photos (lot C) en un mot ; bandeau « mon pointage du moment » ;
 *  - vue eclatee d'une operation (lot E) : une entree par article.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  afterStartTarget, buildDayCards, cardGesture, homeTarget, isHomePref, myCurrentWork, myIdentity, needsReceptionFirst, normName,
  partsSummary, photosState, photosTone, partsTone, MY_WORKSHOP_REFRESH_MS,
  type DayAppointment, type DayOr, type MyEntry,
} from '../src/modules/workshop/my-workshop/rules';
import { operationArticles } from '../src/modules/workshop/exploded/rules';
import { PAGE_ALIASES, accessLevel } from '../src/lib/auth/permissions';

const ME = 'user-marco';
const mechanics = [
  { id: 'm-marco', name: 'Marco Rossi', user_id: ME, is_active: true },
  { id: 'm-luca', name: 'Luca', user_id: 'user-luca', is_active: true },
  { id: 'm-old', name: 'Ancien', user_id: null, is_active: false },
];
const me = myIdentity(ME, 'Marco Rossi', mechanics);
const TODAY = '2026-11-19';

const appt = (p: Partial<DayAppointment> & { id: string }): DayAppointment => ({
  starts_at: '2026-11-19T08:30:00Z', status: 'prevu', or_id: null, mechanic_id: 'm-marco', mechanic_name: 'Marco Rossi',
  unassigned: false, planned_minutes: 60, work_description: 'Entretien 15 000 km', ...p,
});
const or = (p: Partial<DayOr> & { id: string }): DayOr => ({
  number: p.id.toUpperCase(), status: 'a_faire', created_at: '2026-11-18T09:00:00Z', operator: null, operator_id: null,
  work_description: null, customer_approval: null, service_code: null, ...p,
});
const entry = (p: Partial<MyEntry> & { id: string; or_id: string | null }): MyEntry => ({
  kind: 'travail', mechanic_id: ME, mechanic_code: null, mechanic_name: 'Marco Rossi', journey_operation: null,
  started_at: '2026-11-19T07:00:00Z', ended_at: null, minutes: null, stop_kind: null, stop_reason: null, ...p,
});

describe('lot F — page d accueil apres connexion', () => {
  test('mecanicien ou chef d atelier : Mon atelier ; les autres : tableau de bord', () => {
    expect(homeTarget(['mecanicien'], null)).toBe('my_workshop');
    expect(homeTarget(['chef_atelier', 'vendeur'], 'auto')).toBe('my_workshop');
    expect(homeTarget(['vendeur'], null)).toBe('dashboard');
    expect(homeTarget(['magasinier', 'comptable'], undefined)).toBe('dashboard');
  });
  test('un administrateur garde le tableau de bord, meme avec un role atelier', () => {
    expect(homeTarget(['admin', 'chef_atelier'], null)).toBe('dashboard');
  });
  test('le reglage du compte prime sur le role', () => {
    expect(homeTarget(['mecanicien'], 'dashboard')).toBe('dashboard');
    expect(homeTarget(['vendeur'], 'my_workshop')).toBe('my_workshop');
    expect(homeTarget(['admin'], 'my_workshop')).toBe('my_workshop');
  });
  test('valeurs du reglage', () => {
    expect(isHomePref('auto') && isHomePref('dashboard') && isHomePref('my_workshop')).toBe(true);
    expect(isHomePref('planning')).toBe(false);
    expect(isHomePref(null)).toBe(false);
  });
  test('aucun droit change : Mon atelier a exactement les droits de l atelier', () => {
    expect(PAGE_ALIASES['/workshop/my-workshop']).toBe('/workshop');
    for (const role of ['mecanicien', 'chef_atelier', 'vendeur', 'magasinier', 'comptable', 'marketing', 'admin'] as const) {
      expect(`${role}:${accessLevel('/workshop/my-workshop', [role])}`).toBe(`${role}:${accessLevel('/workshop', [role])}`);
    }
  });
  test('relecture entre 30 et 60 secondes', () => {
    expect(MY_WORKSHOP_REFRESH_MS).toBeGreaterThanOrEqual(30_000);
    expect(MY_WORKSHOP_REFRESH_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('lot F — qui suis-je', () => {
  test('compagnon lie au compte', () => {
    expect(me.mechanicIds).toEqual(['m-marco']);
    expect(me.displayName).toBe('Marco Rossi');
    expect(me.names).toContain('marco rossi');
  });
  test('sans compagnon lie : repli sur le nom (accents, casse, espaces)', () => {
    const m = myIdentity('user-x', ' Élodie   Dupont ', [{ id: 'm-e', name: 'elodie dupont', user_id: null }]);
    expect(m.mechanicIds).toEqual(['m-e']);
    expect(normName('Élodie  DUPONT')).toBe('elodie dupont');
  });
  test('un compagnon lie a un AUTRE compte n est pas pris par le nom', () => {
    const m = myIdentity('user-x', 'Luca', mechanics);
    expect(m.mechanicIds).toEqual([]);
  });
  test('compagnon inactif ignore', () => {
    expect(myIdentity('user-y', 'Ancien', mechanics).mechanicIds).toEqual([]);
  });
});

describe('lot F — mes motos du jour', () => {
  test('RDV du jour a mon nom, avec et sans OR ; pas les RDV d hier, d un autre, annules ou demandes', () => {
    const cards = buildDayCards({
      me, today: TODAY, myEntries: [],
      appointments: [
        appt({ id: 'r1', or_id: 'or1' }),
        appt({ id: 'r2' }),
        appt({ id: 'r-hier', starts_at: '2026-11-18T08:00:00Z' }),
        appt({ id: 'r-luca', mechanic_id: 'm-luca', mechanic_name: 'Luca' }),
        appt({ id: 'r-annule', status: 'annule' }),
        appt({ id: 'r-demande', status: 'demande' }),
      ],
      ors: [or({ id: 'or1', status: 'a_faire', operator: 'Marco Rossi' })],
    });
    expect(cards.map((c) => c.key)).toEqual(['or:or1', 'rdv:r2']);
    expect(cards.every((c) => c.section === 'mine')).toBe(true);
  });
  test('le jour est celui de Bruxelles (RDV a 23 h 30 UTC = lendemain a Bruxelles)', () => {
    const cards = buildDayCards({ me, today: TODAY, myEntries: [], ors: [], appointments: [appt({ id: 'tard', starts_at: '2026-11-19T23:30:00Z' })] });
    expect(cards).toEqual([]);
    const tot = buildDayCards({ me, today: TODAY, myEntries: [], ors: [], appointments: [appt({ id: 'tot', starts_at: '2026-11-18T23:30:00Z' })] });
    expect(tot.map((c) => c.key)).toEqual(['rdv:tot']);
  });
  test('OR ouverts a mon nom (compte ou nom saisi) ; OR prets ou factures a mon nom absents sans RDV du jour', () => {
    const cards = buildDayCards({
      me, today: TODAY, myEntries: [], appointments: [],
      ors: [
        or({ id: 'a', status: 'en_cours', operator_id: ME }),
        or({ id: 'b', status: 'attente_pieces', operator: 'marco ROSSI' }),
        or({ id: 'c', status: 'pret', operator_id: ME }),
        or({ id: 'd', status: 'facture', operator_id: ME }),
        or({ id: 'e', status: 'en_cours', operator_id: 'user-luca' }),
      ],
    });
    expect(cards.map((c) => c.key).sort()).toEqual(['or:a', 'or:b']);
  });
  test('OR ou j ai un pointage en pause (hier soir, fin de journee) : il revient pour Reprendre', () => {
    const cards = buildDayCards({
      me, today: TODAY, appointments: [],
      ors: [or({ id: 'x', status: 'en_cours', operator_id: 'user-luca' })],
      myEntries: [entry({ id: 'e1', or_id: 'x', started_at: '2026-11-18T15:00:00Z', ended_at: '2026-11-18T17:00:00Z', stop_kind: 'pause', stop_reason: 'fin_journee' })],
    });
    expect(cards.map((c) => c.key)).toEqual(['or:x']);
    expect(cardGesture(cards[0])).toBe('resume');
  });
  test('OR « a faire » non attribues, a part ; un OR dont le RDV est a un autre compagnon n y est pas', () => {
    const cards = buildDayCards({
      me, today: TODAY, myEntries: [],
      appointments: [appt({ id: 'r-luca', or_id: 'pris', mechanic_id: 'm-luca', mechanic_name: 'Luca' })],
      ors: [
        or({ id: 'libre', status: 'a_faire' }),
        or({ id: 'pris', status: 'a_faire' }),
        or({ id: 'encours', status: 'en_cours' }),
      ],
    });
    expect(cards.map((c) => `${c.section}:${c.key}`)).toEqual(['unassigned:or:libre']);
  });
  test('ordre : en cours, en pause, a l heure du RDV, puis termine ; mes motos avant les non attribuees', () => {
    const cards = buildDayCards({
      me, today: TODAY,
      appointments: [
        appt({ id: 'r-9h', starts_at: '2026-11-19T08:00:00Z', or_id: 'o-9h' }),
        appt({ id: 'r-8h', starts_at: '2026-11-19T07:00:00Z', or_id: 'o-pret' }),
        appt({ id: 'r-14h', starts_at: '2026-11-19T13:00:00Z', or_id: 'o-run' }),
      ],
      ors: [
        or({ id: 'o-9h' }), or({ id: 'o-pret', status: 'pret' }), or({ id: 'o-run', status: 'en_cours' }),
        or({ id: 'o-pause', status: 'en_cours', operator_id: ME }), or({ id: 'o-libre' }),
      ],
      myEntries: [
        entry({ id: 'run', or_id: 'o-run' }),
        entry({ id: 'p', or_id: 'o-pause', ended_at: '2026-11-19T06:50:00Z', stop_kind: 'pause', stop_reason: 'attente_piece' }),
      ],
    });
    expect(cards.map((c) => c.key)).toEqual(['or:o-run', 'or:o-pause', 'or:o-9h', 'or:o-pret', 'or:o-libre']);
  });
  test('un OR n apparait qu une fois', () => {
    const cards = buildDayCards({
      me, today: TODAY, myEntries: [entry({ id: 'e', or_id: 'o1' })],
      appointments: [appt({ id: 'r1', or_id: 'o1' })],
      ors: [or({ id: 'o1', status: 'en_cours', operator_id: ME })],
    });
    expect(cards.length).toBe(1);
  });
});

describe('lot F — un geste par moto', () => {
  const card = (o: Partial<DayOr> | null, entries: MyEntry[] = [], a: DayAppointment | null = null) => {
    const theOr = o ? or({ id: 'o', ...o }) : null;
    return buildDayCards({ me, today: TODAY, myEntries: entries, appointments: a ? [a] : [], ors: theOr ? [{ ...theOr, operator_id: ME }] : [] })[0];
  };
  test('RDV sans OR : ouvrir l OR', () => {
    expect(cardGesture(card(null, [], appt({ id: 'r' })))).toBe('create_or');
  });
  test('OR a faire : Demarrer ; mon pointage ouvert : Continuer ; en pause : Reprendre', () => {
    expect(cardGesture(card({ status: 'a_faire' }))).toBe('start');
    expect(cardGesture(card({ status: 'en_cours' }, [entry({ id: 'e', or_id: 'o' })]))).toBe('continue');
    expect(cardGesture(card({ status: 'en_cours' }, [entry({ id: 'e', or_id: 'o', ended_at: '2026-11-19T08:00:00Z', stop_kind: 'pause' })]))).toBe('resume');
  });
  test('travail termine (« Terminer ») : on peut Demarrer de nouveau', () => {
    expect(cardGesture(card({ status: 'en_cours' }, [entry({ id: 'e', or_id: 'o', ended_at: '2026-11-19T08:00:00Z', stop_kind: 'stop' })]))).toBe('start');
  });
  test('accord du client en attente : bloque (meme garde-fou que l OR)', () => {
    expect(cardGesture(card({ status: 'attente_devis', customer_approval: 'en_attente' }))).toBe('blocked');
    expect(cardGesture(card({ status: 'attente_devis', customer_approval: 'signe' }))).toBe('start');
  });
  test('moto prete : aucun geste ; ecran en consultation : aucun geste', () => {
    const pret = buildDayCards({ me, today: TODAY, myEntries: [], appointments: [appt({ id: 'r', or_id: 'o' })], ors: [or({ id: 'o', status: 'pret' })] })[0];
    expect(cardGesture(pret)).toBe('none');
    expect(cardGesture(card({ status: 'a_faire' }), false)).toBe('none');
  });
  test('photos de reception avant le pointage : Demarrer / Creer l OR seulement, jamais Reprendre, jamais si faites', () => {
    expect(needsReceptionFirst('start', 'none', 'a_faire', true)).toBe(true);
    expect(needsReceptionFirst('create_or', 'none', 'a_faire', true)).toBe(true);
    expect(needsReceptionFirst('start', 'en_cours', 'a_faire', true)).toBe(true);
    expect(needsReceptionFirst('start', 'complete', 'a_faire', true)).toBe(false);
    expect(needsReceptionFirst('start', 'plus_tard', 'a_faire', true)).toBe(false);
    expect(needsReceptionFirst('resume', 'none', 'en_cours', true)).toBe(false);
    expect(needsReceptionFirst('start', 'none', 'a_faire', false)).toBe(false);
  });
  test('apres le pointage : parcours guide (liste ou entretien), sinon fiche OR ; operation reprise', () => {
    expect(afterStartTarget({ planTotal: 8, serviceCode: null })).toEqual({ to: 'journey', op: null });
    expect(afterStartTarget({ planTotal: 0, serviceCode: '15000', operation: 'op3' })).toEqual({ to: 'journey', op: 'op3' });
    expect(afterStartTarget({ planTotal: 0, serviceCode: null })).toEqual({ to: 'or' });
  });
});

describe('lot F — pieces et photos en un mot', () => {
  test('pieces : manquantes, reservees, preparees, rien', () => {
    expect(partsSummary([], null).state).toBe('none');
    expect(partsSummary([{ qty_needed: 1, qty_reserved: 1, status: 'active' }], 'en_cours').state).toBe('reserved');
    expect(partsSummary([{ qty_needed: 1, qty_reserved: 1, status: 'active' }], 'pret').state).toBe('prepared');
    const m = partsSummary([
      { qty_needed: 2, qty_reserved: 1, status: 'active' },
      { qty_needed: 1, qty_reserved: 1, status: 'active' },
      { qty_needed: 3, qty_reserved: 0, status: 'liberee' },
    ], 'pret');
    expect(m).toEqual({ state: 'missing', total: 2, missing: 1 });
    expect(partsSummary([{ qty_needed: '1', qty_reserved: '0', qty_consumed: '1', status: 'active' }], null).state).toBe('reserved');
    expect(partsTone('missing')).toBe('warning');
    expect(partsTone('prepared')).toBe('success');
  });
  test('photos : faites, incompletes, remises, commencees, a faire', () => {
    expect(photosState('complete', 0)).toBe('done');
    expect(photosState('complete', 2)).toBe('incomplete');
    expect(photosState('plus_tard', 0)).toBe('later');
    expect(photosState('en_cours', 1)).toBe('started');
    expect(photosState(undefined, 0)).toBe('todo');
    expect(photosTone('done')).toBe('success');
    expect(photosTone('later')).toBe('warning');
  });
});

describe('lot F — mon pointage du moment', () => {
  test('travail ouvert : en cours ; tache improductive ouverte : en cours', () => {
    expect(myCurrentWork([entry({ id: 'a', or_id: 'o1' })], ME).kind).toBe('running');
    expect(myCurrentWork([entry({ id: 't', or_id: null, kind: 'improductif', task_code: 'NET' })], ME).kind).toBe('running');
  });
  test('dernier travail en pause : en pause (Reprendre) ; termine : rien', () => {
    const paused = myCurrentWork([
      entry({ id: 'old', or_id: 'o1', ended_at: '2026-11-19T07:30:00Z', stop_kind: 'stop' }),
      entry({ id: 'p', or_id: 'o2', started_at: '2026-11-19T08:00:00Z', ended_at: '2026-11-19T09:00:00Z', stop_kind: 'pause' }),
    ], ME);
    expect(paused.kind).toBe('paused');
    expect(paused.kind === 'paused' && paused.entry.id).toBe('p');
    expect(myCurrentWork([entry({ id: 's', or_id: 'o1', ended_at: '2026-11-19T07:30:00Z', stop_kind: 'stop' })], ME).kind).toBe('idle');
  });
  test('pause sur un OR deja pret / facture : rien a reprendre', () => {
    const e = [entry({ id: 'p', or_id: 'o2', ended_at: '2026-11-19T09:00:00Z', stop_kind: 'pause' })];
    expect(myCurrentWork(e, ME, new Set(['o2'])).kind).toBe('idle');
  });
  test('pointage d un code mecano (poste partage) ou d un autre compte : pas le mien', () => {
    expect(myCurrentWork([entry({ id: 'c', or_id: 'o1', mechanic_code: 'M07' })], ME).kind).toBe('idle');
    expect(myCurrentWork([entry({ id: 'l', or_id: 'o1', mechanic_id: 'user-luca' })], ME).kind).toBe('idle');
  });
});

describe('lot E integre au parcours — vue eclatee d une operation', () => {
  test('une entree par article, sans les lignes sans article', () => {
    expect(operationArticles({ lines: [
      { article_id: 'a1', designation: 'Filtre a huile' },
      { article_id: 'a1', designation: 'Filtre a huile' },
      { article_id: null, designation: 'Huile en vrac' },
      { article_id: 'a2', designation: 'Joint' },
    ] })).toEqual([{ articleId: 'a1', designation: 'Filtre a huile' }, { articleId: 'a2', designation: 'Joint' }]);
    expect(operationArticles({ lines: [] })).toEqual([]);
  });
});
