/**
 * M8 — « Mon atelier » : cartes lisibles (bug client du 19/11/2026). Deux cartes identiques (meme
 * client, meme Monster) : l'ancien OR accident du 03/11 (OR-2026-00003, operateur saisi en texte,
 * sans entretien) passait AVANT l'OR du RDV du jour (OR-2026-00004), trie par date de creation
 * alors que l'autre l'etait par heure de RDV ; photos et « Demarrer » faits sur le mauvais OR.
 *  - chaque carte : n° d'OR (ou RDV sans OR), motif, heure du RDV ou date de reception, anciennete ;
 *  - un seul ordre : RDV et OR du jour par heure, OR en cours / en pause, autres OR du plus recent
 *    au plus ancien ;
 *  - une moto a plusieurs OR ouverts : l'OR du RDV du jour en avant, les autres « ancien OR » ;
 *  - OR ouvert depuis plus de N jours sans pointage recent : « OR anciens a verifier ».
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  MOTIVE_LABELS, STALE_OR_DAYS_DEFAULT, ageLabel, buildDayCards, cardGroup, cardMotive, cardWhen, daysBetween, finalizeCards,
  isStaleCard, lastPointageAt, myIdentity, orAgeDays, sortCards, staleDaysSetting, vehicleOrGroups,
  type DayAppointment, type DayCard, type DayOr, type MyEntry,
} from '../src/modules/workshop/my-workshop/rules';
import { myWorkshopEn, myWorkshopFr, myWorkshopIt, myWorkshopNl } from '../src/lib/i18n/mon-atelier';

const ME = 'user-simon';
const mechanics = [{ id: 'm-simon', name: 'Simon', user_id: ME, is_active: true }];
const me = myIdentity(ME, 'Simon', mechanics);
const TODAY = '2026-11-19';
const MONSTER = 'veh-monster';

const appt = (p: Partial<DayAppointment> & { id: string }): DayAppointment => ({
  starts_at: '2026-11-19T08:30:00Z', status: 'prevu', or_id: null, mechanic_id: 'm-simon', mechanic_name: 'Simon',
  unassigned: false, planned_minutes: 60, work_description: null, service_code: null, reason_code: null, vehicle_id: null, ...p,
});
const or = (p: Partial<DayOr> & { id: string }): DayOr => ({
  number: p.id.toUpperCase(), status: 'a_faire', created_at: '2026-11-18T09:00:00Z', operator: null, operator_id: null,
  work_description: null, customer_approval: null, service_code: null, reason_code: null, repair_type: null, vehicle_id: null, ...p,
});
const entry = (p: Partial<MyEntry> & { id: string; or_id: string | null }): MyEntry => ({
  kind: 'travail', mechanic_id: ME, mechanic_code: null, mechanic_name: 'Simon', journey_operation: null,
  started_at: '2026-11-19T07:00:00Z', ended_at: null, minutes: null, stop_kind: null, stop_reason: null, ...p,
});
const card = (p: Partial<DayCard> & { key: string }): DayCard => ({ section: 'mine', or: null, appointment: null, work: null, ...p });

// Le cas du client : meme moto, meme client.
const OLD_ACCIDENT = or({
  id: 'or3', number: 'OR-2026-00003', status: 'a_faire', created_at: '2026-11-03T10:15:00Z', operator: 'Simon',
  reason_code: 'accident', vehicle_id: MONSTER,
});
const TODAY_OR = or({
  id: 'or4', number: 'OR-2026-00004', status: 'a_faire', created_at: '2026-11-19T07:50:00Z', operator_id: ME,
  reason_code: 'entretien_annuel', service_code: 'annual', vehicle_id: MONSTER,
});
const TODAY_RDV = appt({ id: 'rdv4', or_id: 'or4', starts_at: '2026-11-19T08:30:00Z', service_code: 'annual', reason_code: 'entretien_annuel', vehicle_id: MONSTER });

describe('cas du client (19/11) : ancien OR accident et OR du RDV du jour de la meme moto', () => {
  const cards = buildDayCards({ me, today: TODAY, myEntries: [], appointments: [TODAY_RDV], ors: [OLD_ACCIDENT, TODAY_OR] });
  test('l OR du RDV du jour passe en premier, l ancien OR ensuite', () => {
    expect(cards.map((c) => c.or?.number)).toEqual(['OR-2026-00004', 'OR-2026-00003']);
  });
  test('les deux cartes se distinguent : numero, motif, heure / reception, anciennete', () => {
    const [today, old] = cards;
    expect(cardMotive(today).label).toBe('annual');
    expect(cardMotive(old)).toEqual({ kind: 'accident', label: 'accident' });
    expect(cardWhen(today, TODAY)).toEqual({ kind: 'appointment', at: TODAY_RDV.starts_at, today: true });
    expect(cardWhen(old, TODAY)).toEqual({ kind: 'received', at: OLD_ACCIDENT.created_at });
    expect(ageLabel(orAgeDays(old.or!.created_at, TODAY))).toEqual({ key: 'age_many', n: 16 });
    expect(ageLabel(orAgeDays(today.or!.created_at, TODAY))).toEqual({ key: 'age_today', n: 0 });
  });
  test('regroupement par moto : 2 OR ouverts, l OR du RDV du jour en avant, l autre « ancien OR »', () => {
    const groups = vehicleOrGroups({ cards, ors: [OLD_ACCIDENT, TODAY_OR], appointments: [TODAY_RDV], today: TODAY });
    const g4 = groups.get('or:or4')!;
    const g3 = groups.get('or:or3')!;
    expect(g4.openOrs).toBe(2);
    expect(g4.role).toBe('primary');
    expect(g3.role).toBe('old');
    expect(g3.primaryToday).toBe(true);
    expect(g3.primary).toEqual({ kind: 'or', id: 'or4', number: 'OR-2026-00004' });
    expect(g4.others.map((o) => o.number)).toEqual(['OR-2026-00003']);
    expect(g3.others.map((o) => o.number)).toEqual(['OR-2026-00004']);
  });
  test('l ancien OR (16 jours) sans pointage passe dans « OR anciens a verifier » ; avec le pointage du jour, il reste', () => {
    const fin = finalizeCards(cards, { today: TODAY, staleDays: 14, myEntries: [], workStatus: new Map() });
    expect(fin.find((c) => c.key === 'or:or3')!.stale).toBe(true);
    expect(fin.find((c) => c.key === 'or:or4')!.stale).toBe(false);
    const pointe = finalizeCards(cards, {
      today: TODAY, staleDays: 14, workStatus: new Map(),
      myEntries: [entry({ id: 'e', or_id: 'or3', started_at: '2026-11-19T07:55:00Z', ended_at: '2026-11-19T08:05:00Z', stop_kind: 'pause', stop_reason: 'autre' })],
    });
    expect(pointe.find((c) => c.key === 'or:or3')!.stale).toBe(false);
    // Meme en pause, l OR du RDV du jour reste devant.
    expect(pointe.map((c) => c.key)).toEqual(['or:or4', 'or:or3']);
  });
});

describe('ordre unique de la liste', () => {
  test('RDV et OR du jour par heure, puis en cours / en pause, puis les autres OR du plus recent au plus ancien', () => {
    const cards = sortCards([
      card({ key: 'or:vieux', or: or({ id: 'vieux', created_at: '2026-10-01T08:00:00Z' }) }),
      card({ key: 'or:recent', or: or({ id: 'recent', created_at: '2026-11-17T08:00:00Z' }) }),
      card({ key: 'rdv:14h', appointment: appt({ id: '14h', starts_at: '2026-11-19T13:00:00Z' }) }),
      card({ key: 'or:9h', or: or({ id: '9h', created_at: '2026-11-10T08:00:00Z' }), appointment: appt({ id: 'r9', or_id: '9h', starts_at: '2026-11-19T08:00:00Z' }) }),
      card({ key: 'or:ouvert-ce-matin', or: or({ id: 'matin', created_at: '2026-11-19T09:30:00Z' }) }),
      card({ key: 'or:en-cours', or: or({ id: 'enc', status: 'en_cours', created_at: '2026-11-05T08:00:00Z' }) }),
      card({ key: 'or:pret', or: or({ id: 'pret', status: 'pret', created_at: '2026-11-18T08:00:00Z' }) }),
      card({ key: 'or:libre', section: 'unassigned', or: or({ id: 'libre', created_at: '2026-11-19T06:00:00Z' }) }),
    ], TODAY);
    expect(cards.map((c) => c.key)).toEqual([
      'or:9h', 'or:ouvert-ce-matin', 'rdv:14h', 'or:en-cours', 'or:recent', 'or:vieux', 'or:pret', 'or:libre',
    ]);
  });
  test('le meme tri pour les OR non attribues', () => {
    const cards = sortCards([
      card({ key: 'a', section: 'unassigned', or: or({ id: 'a', created_at: '2026-11-01T08:00:00Z' }) }),
      card({ key: 'b', section: 'unassigned', or: or({ id: 'b', created_at: '2026-11-18T08:00:00Z' }) }),
      card({ key: 'c', section: 'unassigned', or: or({ id: 'c', created_at: '2026-11-19T10:00:00Z' }) }),
    ], TODAY);
    expect(cards.map((c) => c.key)).toEqual(['c', 'b', 'a']);
  });
  test('etat de l OR tous pointages confondus (vue du lot A) : en cours avant en pause', () => {
    const a = card({ key: 'a', or: or({ id: 'a', created_at: '2026-11-15T08:00:00Z' }) });
    const b = card({ key: 'b', or: or({ id: 'b', created_at: '2026-11-01T08:00:00Z' }) });
    const live = new Map([['a', 'paused' as const], ['b', 'running' as const]]);
    expect(sortCards([a, b], TODAY, live).map((c) => c.key)).toEqual(['b', 'a']);
    expect(cardGroup(a, TODAY, 'paused')).toBe(1);
    expect(cardGroup(a, TODAY, 'stopped')).toBe(2);
  });
  test('un RDV du jour annule ne compte pas comme carte du jour', () => {
    const c = card({ key: 'x', or: or({ id: 'x', created_at: '2026-11-10T08:00:00Z' }), appointment: appt({ id: 'r', status: 'annule' }) });
    expect(cardGroup(c, TODAY)).toBe(2);
  });
});

describe('motif de la carte', () => {
  test('entretien choisi, motif d entree, type de reparation, puis le RDV', () => {
    expect(cardMotive({ or: or({ id: 'a', service_code: 'oil' }), appointment: null }).label).toBe('oil');
    expect(cardMotive({ or: or({ id: 'a', reason_code: 'pneus' }), appointment: null }).label).toBe('tyres');
    expect(cardMotive({ or: or({ id: 'a', repair_type: 'garantie_ducati' }), appointment: null })).toEqual({ kind: 'warranty', label: 'warranty' });
    expect(cardMotive({ or: or({ id: 'a', repair_type: 'reparation' }), appointment: null })).toEqual({ kind: 'repair', label: 'repair' });
    expect(cardMotive({ or: null, appointment: appt({ id: 'r', service_code: 'first_1000' }) }).label).toBe('first_1000');
    expect(cardMotive({ or: or({ id: 'a' }), appointment: appt({ id: 'r', reason_code: 'freins' }) }).label).toBe('brakes');
  });
  test('accident l emporte toujours ; « autre » seulement si rien de plus precis ; rien : non renseigne', () => {
    expect(cardMotive({ or: or({ id: 'a', service_code: 'annual', repair_type: 'accident' }), appointment: null }).label).toBe('accident');
    expect(cardMotive({ or: or({ id: 'a', reason_code: 'autre', repair_type: 'entretien' }), appointment: null }).label).toBe('maintenance');
    expect(cardMotive({ or: or({ id: 'a', reason_code: 'autre' }), appointment: null }).label).toBe('other');
    expect(cardMotive({ or: or({ id: 'a', reason_code: 'entretien_15000' }), appointment: null }).label).toBe('maintenance');
    expect(cardMotive({ or: or({ id: 'a' }), appointment: null })).toEqual({ kind: 'unknown', label: 'unknown' });
  });
  test('chaque motif a son libelle dans les quatre langues', () => {
    for (const dict of [myWorkshopFr, myWorkshopNl, myWorkshopEn, myWorkshopIt] as Record<string, string>[]) {
      for (const l of MOTIVE_LABELS) expect(typeof dict[`motive_${l}`]).toBe('string');
      for (const k of ['rdvNoOr', 'rdvAt', 'receivedOn', 'age_today', 'age_one', 'age_many', 'oldOr', 'vehicleOpenOrs', 'staleTitle', 'staleHint']) {
        expect(dict[k]?.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('heure du RDV, date de reception, anciennete', () => {
  test('RDV sans OR : heure du RDV, pas d anciennete', () => {
    const c = card({ key: 'rdv:x', appointment: appt({ id: 'x', starts_at: '2026-11-19T12:00:00Z' }) });
    expect(cardWhen(c, TODAY)).toEqual({ kind: 'appointment', at: '2026-11-19T12:00:00Z', today: true });
  });
  test('anciennete en jours de Bruxelles (OR ouvert a 23 h 30 UTC = le lendemain a Bruxelles)', () => {
    expect(orAgeDays('2026-11-18T23:30:00Z', TODAY)).toBe(0);
    expect(orAgeDays('2026-11-18T22:30:00Z', TODAY)).toBe(1);
    expect(ageLabel(1)).toEqual({ key: 'age_one', n: 1 });
    expect(ageLabel(0)).toEqual({ key: 'age_today', n: 0 });
    expect(daysBetween('2026-11-03', '2026-11-19')).toBe(16);
    expect(daysBetween('2026-10-24', '2026-11-03')).toBe(10); // passage a l heure d hiver sans effet
  });
});

describe('une moto, plusieurs dossiers ouverts', () => {
  test('RDV du jour sans OR + ancien OR de la meme moto : le RDV en avant, l OR « ancien »', () => {
    const rdv = appt({ id: 'r', vehicle_id: MONSTER });
    const cards = buildDayCards({ me, today: TODAY, myEntries: [], appointments: [rdv], ors: [OLD_ACCIDENT] });
    const g = vehicleOrGroups({ cards, ors: [OLD_ACCIDENT], appointments: [rdv], today: TODAY });
    expect(g.get('rdv:r')).toMatchObject({ role: 'primary', openOrs: 1, primary: { kind: 'rdv', id: 'r' }, primaryToday: true });
    expect(g.get('or:or3')).toMatchObject({ role: 'old', openOrs: 1, primaryToday: true });
  });
  test('deux OR ouverts sans RDV du jour : le plus recent en avant, sans « RDV du jour »', () => {
    const a = or({ id: 'a', vehicle_id: 'v', created_at: '2026-11-01T08:00:00Z', operator_id: ME });
    const b = or({ id: 'b', vehicle_id: 'v', created_at: '2026-11-15T08:00:00Z', operator_id: ME });
    const cards = buildDayCards({ me, today: TODAY, myEntries: [], appointments: [], ors: [a, b] });
    const g = vehicleOrGroups({ cards, ors: [a, b], appointments: [], today: TODAY });
    expect(g.get('or:b')!.role).toBe('primary');
    expect(g.get('or:a')!.role).toBe('old');
    expect(g.get('or:a')!.primaryToday).toBe(false);
  });
  test('compte aussi un OR ouvert de la moto qui n est pas sur l ecran (attribue a un autre)', () => {
    const mine = or({ id: 'm', vehicle_id: 'v', operator_id: ME });
    const other = or({ id: 'o', vehicle_id: 'v', operator_id: 'user-luca', number: 'OR-2026-00001', created_at: '2026-11-02T08:00:00Z' });
    const cards = buildDayCards({ me, today: TODAY, myEntries: [], appointments: [], ors: [mine, other] });
    expect(cards.map((c) => c.key)).toEqual(['or:m']);
    const g = vehicleOrGroups({ cards, ors: [mine, other], appointments: [], today: TODAY });
    expect(g.get('or:m')).toMatchObject({ openOrs: 2, role: 'primary' });
    expect(g.get('or:m')!.others.map((o) => o.number)).toEqual(['OR-2026-00001']);
  });
  test('une seule moto, un seul OR : rien ; OR facture ou annule : non compte', () => {
    const a = or({ id: 'a', vehicle_id: 'v', operator_id: ME });
    const f = or({ id: 'f', vehicle_id: 'v', status: 'facture' });
    const cards = buildDayCards({ me, today: TODAY, myEntries: [], appointments: [], ors: [a, f] });
    expect(vehicleOrGroups({ cards, ors: [a, f], appointments: [], today: TODAY }).size).toBe(0);
  });
});

describe('OR anciens a verifier', () => {
  const base = { today: TODAY, staleDays: 14, lastPointage: null as string | null };
  const c = (created: string, extra: Partial<DayCard> = {}) => card({ key: 'k', or: or({ id: 'k', created_at: created }), ...extra });
  test('plus de 14 jours sans pointage : ancien ; 14 jours pile : pas encore', () => {
    expect(isStaleCard(c('2026-11-04T08:00:00Z'), base)).toBe(true); // 15 jours
    expect(isStaleCard(c('2026-11-05T08:00:00Z'), base)).toBe(false); // 14 jours
  });
  test('pointage recent (14 jours ou moins) : reste dans mes motos', () => {
    expect(isStaleCard(c('2026-10-01T08:00:00Z'), { ...base, lastPointage: '2026-11-10T16:00:00Z' })).toBe(false);
    expect(isStaleCard(c('2026-10-01T08:00:00Z'), { ...base, lastPointage: '2026-10-20T16:00:00Z' })).toBe(true);
  });
  test('jamais ancien : pointage en cours, RDV aujourd hui, RDV sans OR', () => {
    expect(isStaleCard(c('2026-10-01T08:00:00Z'), { ...base, live: 'running' })).toBe(false);
    expect(isStaleCard(c('2026-10-01T08:00:00Z', { appointment: appt({ id: 'r', or_id: 'k' }) }), base)).toBe(false);
    expect(isStaleCard(card({ key: 'rdv', appointment: appt({ id: 'r', starts_at: '2026-10-01T08:00:00Z' }) }), base)).toBe(false);
  });
  test('seuil reglable', () => {
    expect(isStaleCard(c('2026-11-10T08:00:00Z'), { ...base, staleDays: 7 })).toBe(true);
    expect(isStaleCard(c('2026-11-04T08:00:00Z'), { ...base, staleDays: 30 })).toBe(false);
  });
  test('reglage : 14 par defaut, entier de 1 a 365', () => {
    expect(STALE_OR_DAYS_DEFAULT).toBe(14);
    expect(staleDaysSetting(undefined)).toBe(14);
    expect(staleDaysSetting('')).toBe(14);
    expect(staleDaysSetting(0)).toBe(14);
    expect(staleDaysSetting(366)).toBe(14);
    expect(staleDaysSetting(2.5)).toBe(14);
    expect(staleDaysSetting('21')).toBe(21);
    expect(staleDaysSetting(1)).toBe(1);
  });
  test('dernier pointage : vue du lot A (tous comptes) ou mes pointages, le plus recent', () => {
    expect(lastPointageAt('k', { running_since: null, last_stopped_at: '2026-11-02T10:00:00Z' }, [
      entry({ id: 'e', or_id: 'k', started_at: '2026-11-12T08:00:00Z', ended_at: '2026-11-12T09:00:00Z' }),
      entry({ id: 'f', or_id: 'autre', started_at: '2026-11-18T08:00:00Z', ended_at: '2026-11-18T09:00:00Z' }),
    ])).toBe('2026-11-12T09:00:00Z');
    expect(lastPointageAt('k', undefined, [])).toBeNull();
  });
  test('finalizeCards : un OR pointe par un collegue il y a 3 jours (vue du lot A) n est pas ancien', () => {
    const old = card({ key: 'or:k', or: or({ id: 'k', created_at: '2026-10-01T08:00:00Z' }) });
    const fin = finalizeCards([old], {
      today: TODAY, staleDays: 14, myEntries: [],
      workStatus: new Map([['k', { work_state: 'stopped', running_since: null, last_stopped_at: '2026-11-16T17:00:00Z' }]]),
    });
    expect(fin[0].stale).toBe(false);
  });
});
