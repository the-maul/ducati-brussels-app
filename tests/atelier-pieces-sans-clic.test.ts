/**
 * Tests M8 / M5 — lot B du parcours mecanicien (19/11/2026, regle critique « reservations », regle 7) :
 *  - picking list due la veille a l'heure reglee (mode veille), jamais a l'avance en mode reception / manuel ;
 *  - etat d'une piece de RDV (reservee / au panier / commandee / manquante / hors stock) ;
 *  - « commander en urgente » : bascule du panier standard ouvert, commande du manque non couvert,
 *    jamais une piece fin de serie / remplacee, jamais une deuxieme fois ;
 *  - RDV dans 2 jours : manque en urgente (seuil 5 jours, regle existante basketKindFor) ;
 *  - regroupement par jour puis par RDV.
 * Memes regles que supabase/migrations/20261119250000_m8_pieces_sans_clic.sql (essai a blanc
 * supabase/tests/m8_pieces_sans_clic.sql). Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  pickingDue, brusselsParts, upcomingPartState, canReserve, canOrderUrgent, urgentPlan, isOrderable, groupUpcoming,
  missingCount, isPickingMode, DEFAULT_PARTS_SETTINGS, type UpcomingPartRow,
} from '../src/modules/workshop/reservations/parts-flow';
import { basketKindFor, planReservationLine } from '../src/modules/workshop/reservations/rules';

// 19/11/2026 en hiver : Bruxelles = UTC+1.
const at = (iso: string) => new Date(iso);

describe('picking list : quand est-elle due ?', () => {
  const rdvJ2 = '2026-11-21T08:00:00Z'; // 21/11 09:00 Bruxelles
  test('reglages par defaut : la veille a 16 h, urgente sous 5 jours', () => {
    expect(DEFAULT_PARTS_SETTINGS).toEqual({ mode: 'veille', eveHour: 16, urgentDays: 5, eveBasis: 'ouvree' });
    expect(isPickingMode('veille')).toBe(true);
    expect(isPickingMode('demain')).toBe(false);
  });
  test('RDV dans 2 jours : pas aujourd\'hui, pas la veille a 15 h, oui la veille a 16 h 30', () => {
    expect(pickingDue({ mode: 'veille', eveHour: 16, startsAt: rdvJ2, now: at('2026-11-19T09:00:00Z') })).toBe(false);
    expect(pickingDue({ mode: 'veille', eveHour: 16, startsAt: rdvJ2, now: at('2026-11-20T14:30:00Z') })).toBe(false);
    expect(pickingDue({ mode: 'veille', eveHour: 16, startsAt: rdvJ2, now: at('2026-11-20T15:30:00Z') })).toBe(true);
  });
  test('RDV du jour : toujours du (rattrapage d\'un RDV pris apres la veille)', () => {
    expect(pickingDue({ mode: 'veille', eveHour: 16, startsAt: rdvJ2, now: at('2026-11-21T06:00:00Z') })).toBe(true);
  });
  test('l\'heure est celle de Bruxelles (23 h 30 UTC = 0 h 30 le lendemain)', () => {
    expect(brusselsParts(at('2026-11-19T23:30:00Z'))).toEqual({ date: '2026-11-20', hour: 0 });
    // 20/11 a 0 h 30 Bruxelles : la veille du 21/11 a commence mais 0 h < 16 h
    expect(pickingDue({ mode: 'veille', eveHour: 16, startsAt: rdvJ2, now: at('2026-11-19T23:30:00Z') })).toBe(false);
  });
  test('mode reception ou manuel : rien a l\'avance', () => {
    expect(pickingDue({ mode: 'reception', eveHour: 16, startsAt: rdvJ2, now: at('2026-11-20T17:00:00Z') })).toBe(false);
    expect(pickingDue({ mode: 'manuel', eveHour: 16, startsAt: rdvJ2, now: at('2026-11-21T06:00:00Z') })).toBe(false);
    expect(pickingDue({ mode: 'veille', eveHour: 16, startsAt: null })).toBe(false);
  });
  test('RDV passe ou dans 3 jours : rien', () => {
    expect(pickingDue({ mode: 'veille', eveHour: 16, startsAt: rdvJ2, now: at('2026-11-22T10:00:00Z') })).toBe(false);
    expect(pickingDue({ mode: 'veille', eveHour: 0, startsAt: rdvJ2, now: at('2026-11-18T23:30:00Z') })).toBe(false);
  });
});

describe('RDV dans 2 jours : reservation + urgente', () => {
  test('stock partiel : ce qui est libre est reserve, le reste part en urgente', () => {
    const plan = planReservationLine({ needed: 2, stock: { real: 1, reserved: 0 } });
    expect(plan).toEqual({ reserve: 1, move: 1, missing: 1, toBasket: 1 });
    expect(basketKindFor('2026-11-21T09:00:00', '2026-11-19T10:00:00', 5)).toBe('urgente');
    expect(basketKindFor('2026-11-29T09:00:00', '2026-11-19T10:00:00', 5)).toBe('standard');
  });
});

describe('etat d\'une piece de RDV', () => {
  test('tout reserve', () => expect(upcomingPartState({ needed: 1, reserved: 1, qtyOpen: 0, qtySent: 0 })).toBe('reservee'));
  test('manque dans un panier ouvert', () => expect(upcomingPartState({ needed: 2, reserved: 0, qtyOpen: 2, qtySent: 0 })).toBe('au_panier'));
  test('manque dans un panier commande', () => expect(upcomingPartState({ needed: 2, reserved: 1, qtyOpen: 0, qtySent: 1 })).toBe('commandee'));
  test('manque commande nulle part (panier annule)', () => expect(upcomingPartState({ needed: 2, reserved: 0, qtyOpen: 0, qtySent: 0 })).toBe('manquante'));
  test('manque partiellement couvert = manquante', () => expect(upcomingPartState({ needed: 3, reserved: 0, qtyOpen: 1, qtySent: 1 })).toBe('manquante'));
  test('piece non stockee du kit', () => expect(upcomingPartState({ needed: 1, reserved: 0, qtyOpen: 0, qtySent: 0, outsideStock: true })).toBe('hors_stock'));
  test('reserver : seulement s\'il reste du libre', () => {
    expect(canReserve({ missing: 1, freeQty: 2 })).toBe(true);
    expect(canReserve({ missing: 1, freeQty: 0 })).toBe(false);
    expect(canReserve({ missing: 0, freeQty: 5 })).toBe(false);
  });
});

describe('commander en urgente', () => {
  test('fin de serie / remplacee : jamais commandable', () => {
    expect(isOrderable('red')).toBe(false);
    expect(isOrderable('yellow')).toBe(false);
    expect(isOrderable('green')).toBe(true);
    expect(isOrderable(null)).toBe(true);
    expect(canOrderUrgent({ missing: 1, covered: 0, hasOpenStandard: false, availability: 'yellow' })).toBe(false);
    expect(urgentPlan({ needed: 1, reserved: 0, lines: [], availability: 'red' })).toEqual({ moved: 0, added: 0, qtyToOrder: 0 });
  });
  test('ligne au panier standard ouvert : elle passe en urgente, rien de plus', () => {
    expect(canOrderUrgent({ missing: 2, covered: 2, hasOpenStandard: true })).toBe(true);
    expect(urgentPlan({ needed: 2, reserved: 0, lines: [{ qty: 2, kind: 'standard', status: 'ouvert' }] }))
      .toEqual({ moved: 2, added: 0, qtyToOrder: 2 });
  });
  test('panier annule : le manque est recommande en urgente', () => {
    expect(urgentPlan({ needed: 2, reserved: 0, lines: [{ qty: 2, kind: 'urgente', status: 'annule' }] }))
      .toEqual({ moved: 0, added: 2, qtyToOrder: 2 });
  });
  test('deja commande (standard envoye) : rien ne bouge, rien en double', () => {
    expect(canOrderUrgent({ missing: 2, covered: 2, hasOpenStandard: false })).toBe(false);
    expect(urgentPlan({ needed: 2, reserved: 0, lines: [{ qty: 2, kind: 'standard', status: 'commande' }] }))
      .toEqual({ moved: 0, added: 0, qtyToOrder: 2 });
  });
  test('RDV avance : bascule seule, sans ajouter le manque', () => {
    expect(urgentPlan({ needed: 3, reserved: 0, lines: [{ qty: 1, kind: 'standard', status: 'ouvert' }], addMissing: false }))
      .toEqual({ moved: 1, added: 0, qtyToOrder: 1 });
  });
});

describe('ecran du magasin : par jour puis par RDV', () => {
  const row = (p: Partial<UpcomingPartRow>): UpcomingPartRow => ({
    appointmentId: 'a1', startsAt: '2026-11-21T08:00:00Z', appointmentStatus: 'prevu', repairOrderId: null, orNumber: null,
    contactName: 'X', vehicleLabel: 'DUCATI', plate: null, serviceCode: 'annual', mechanicName: null, pickingId: null,
    pickingStatus: null, reservationId: 'r', articleId: 'art', reference: 'A', designation: 'a', bin: null, qtyNeeded: 1,
    qtyReserved: 1, qtyMissing: 0, qtyOnOrder: 0, state: 'reservee', basketId: null, basketLabel: null, basketKind: null,
    basketStatus: null, dcsOrderNumber: null, availability: null, replacementReference: null, realQty: 1, freeQty: 0,
    canReserve: false, canOrderUrgent: false, ...p,
  });
  test('deux jours, RDV tries par heure, pieces regroupees', () => {
    const g = groupUpcoming([
      row({ appointmentId: 'a2', startsAt: '2026-11-22T13:00:00Z', reference: 'B' }),
      row({ appointmentId: 'a1', reference: 'Z', state: 'manquante' }),
      row({ appointmentId: 'a1', reference: 'C' }),
      row({ appointmentId: 'a3', startsAt: '2026-11-22T07:30:00Z' }),
    ]);
    expect(g.map((d) => d.day)).toEqual(['2026-11-21', '2026-11-22']);
    expect(g[0].appointments[0].parts.map((p) => p.reference)).toEqual(['C', 'Z']);
    expect(g[1].appointments.map((a) => a.appointmentId)).toEqual(['a3', 'a2']);
    expect(missingCount(g[0].appointments[0])).toBe(1);
  });
});
