/**
 * ATE002 / ATE005 — Planning de charge et motos de pret, rattrapage G8 du 18/11/2026.
 * Regles pures de `src/modules/workshop/planning/rules.ts` et `src/modules/workshop/loans/rules.ts` :
 * feries belges, capacite par compagnon (horaires - feries - fermetures - absences - pauses),
 * taux d'occupation (G8 : 2 h sur 24 h = 8,33 %), glisser-deposer (refus hors dispo / chevauchement),
 * liste d'attente, temps prevu obligatoire avant l'OR, statut du RDV aligne sur l'OR (doublon SQL),
 * prets (chevauchement, sortie / retour, km).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  appointmentStatusForOr, availableIntervals, belgianHolidays, belgianHolidayOn, canCreateOr, checkDrop,
  closedDayReason, dayLoad, easterSunday, formatMinutes, isWaiting, localYmd, occupancyPct, parseMileage,
  plannedMinutesFrom, receptionSort, slotsOfDay, snapMinutes, weekStartFor, weeklyMinutes,
  type CalendarBlock, type DayContext, type MechanicHours, type PlanningMechanic,
} from '../src/modules/workshop/planning/rules';
import {
  checkOut, checkPeriod, checkReturn, conflictingLoan, isOverdue, loanDistance, loanerDayState,
} from '../src/modules/workshop/loans/rules';

const mech = (id: string, extra: Partial<PlanningMechanic> = {}): PlanningMechanic =>
  ({ id, name: id, visible_in_planning: true, is_active: true, sort_order: 0, user_id: null, ...extra });
/** Horaires G8 observes : mardi → samedi, 09:00-12:30 / 13:30-18:00 (8 h par jour). */
const g8Hours = (id: string): MechanicHours[] => [2, 3, 4, 5, 6].map((weekday) =>
  ({ mechanic_id: id, weekday, am_start: '09:00', am_end: '12:30', pm_start: '13:30', pm_end: '18:00' }));
const MECHS = [mech('jeremy'), mech('john'), mech('livio')];
const HOURS = [...g8Hours('jeremy'), ...g8Hours('john'), ...g8Hours('livio')];
const ctx = (blocks: CalendarBlock[] = [], belgian = true): DayContext => ({ hours: HOURS, blocks, belgianHolidays: belgian });
const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);
const iso = (y: number, m: number, d: number, h = 0, mi = 0) => at(y, m, d, h, mi).toISOString();

describe('jours feries belges', () => {
  test('Paques 2026 = 5 avril, 2027 = 28 mars', () => {
    expect(localYmd(easterSunday(2026))).toBe('2026-04-05');
    expect(localYmd(easterSunday(2027))).toBe('2027-03-28');
  });
  test('les 10 jours legaux de 2026', () => {
    expect(belgianHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25',
      '2026-07-21', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
    ]);
  });
  test('11 novembre = Armistice ; 12 novembre = jour ouvrable', () => {
    expect(belgianHolidayOn(at(2026, 11, 11))).toBe('armistice');
    expect(belgianHolidayOn(at(2026, 11, 12))).toBeNull();
  });
});

describe('capacite et taux d\'occupation', () => {
  test('horaires G8 : 8 h par jour, 40 h par semaine', () => {
    const w = weeklyMinutes(HOURS, 'jeremy');
    expect(w.perDay[3]).toBe(480);
    expect(w.perDay[1]).toBe(0);
    expect(w.total).toBe(2400);
  });
  test('mercredi 18/11/2026 : 3 compagnons = 24 h ; un RDV de 2 h = 8,33 % (parcours G8 n° 20)', () => {
    const day = at(2026, 11, 18);
    const load = dayLoad(day, MECHS, [{ id: 'r1', starts_at: iso(2026, 11, 18, 10), planned_minutes: 120, status: 'prevu', mechanic_id: 'jeremy' }], ctx(), 10);
    expect(load.capacity).toBe(24 * 60);
    expect(load.planned).toBe(120);
    expect(load.pct).toBe(8.33);
  });
  test('un RDV en attente, annule ou une simple demande ne charge pas le planning', () => {
    const day = at(2026, 11, 18);
    const load = dayLoad(day, MECHS, [
      { id: 'a', starts_at: iso(2026, 11, 18, 10), planned_minutes: 60, status: 'prevu', unassigned: true },
      { id: 'b', starts_at: iso(2026, 11, 18, 11), planned_minutes: 60, status: 'annule', mechanic_id: 'john' },
      { id: 'c', starts_at: iso(2026, 11, 18, 11), planned_minutes: 60, status: 'demande' },
    ], ctx(), 10);
    expect(load.planned).toBe(0);
  });
  test('ferie belge : capacite nulle, journee fermee ; reglage desactive : capacite normale', () => {
    const armistice = at(2026, 11, 11);
    expect(dayLoad(armistice, MECHS, [], ctx(), 10).capacity).toBe(0);
    expect(closedDayReason(armistice, ctx())?.holiday).toBe('armistice');
    expect(dayLoad(armistice, MECHS, [], ctx([], false), 10).capacity).toBe(24 * 60);
  });
  test('fermeture de tout l\'atelier la journee entiere = jour ferme', () => {
    const b: CalendarBlock = { kind: 'fermeture', mechanic_id: null, starts_at: iso(2026, 11, 19), ends_at: iso(2026, 11, 20), label: 'Inventaire' };
    expect(closedDayReason(at(2026, 11, 19), ctx([b]))?.label).toBe('Inventaire');
    expect(dayLoad(at(2026, 11, 19), MECHS, [], ctx([b]), 10).capacity).toBe(0);
  });
  test('absence d\'un compagnon et pause d\'atelier retirent la capacite', () => {
    const absence: CalendarBlock = { kind: 'absence', mechanic_id: 'john', starts_at: iso(2026, 11, 18), ends_at: iso(2026, 11, 19) };
    const pause: CalendarBlock = { kind: 'pause', mechanic_id: null, starts_at: iso(2026, 11, 18, 16), ends_at: iso(2026, 11, 18, 16, 30) };
    const load = dayLoad(at(2026, 11, 18), MECHS, [], ctx([absence, pause]), 10);
    expect(load.capacity).toBe(2 * (480 - 30));
    expect(availableIntervals('jeremy', at(2026, 11, 18), ctx([pause]))).toEqual([[540, 750], [810, 960], [990, 1080]]);
  });
  test('compagnon invisible ou inactif : pas de capacite ; filtre par compagnon', () => {
    const ms = [mech('jeremy'), mech('john', { visible_in_planning: false }), mech('livio', { is_active: false })];
    expect(dayLoad(at(2026, 11, 18), ms, [], ctx(), 10).capacity).toBe(480);
    expect(dayLoad(at(2026, 11, 18), MECHS, [], ctx(), 10, 'livio').capacity).toBe(480);
  });
  test('taux : sans capacite = null ; arrondi a 2 decimales', () => {
    expect(occupancyPct(60, 0)).toBeNull();
    expect(occupancyPct(100, 300)).toBe(33.33);
  });
});

describe('vues reception et activite', () => {
  test('semaine G8 commencant le mardi', () => {
    expect(localYmd(weekStartFor(at(2026, 11, 18), 2))).toBe('2026-11-17');
    expect(localYmd(weekStartFor(at(2026, 11, 16), 2))).toBe('2026-11-10');
    expect(localYmd(weekStartFor(at(2026, 11, 23), 2, 5))).toBe('2026-11-24'); // lundi de fermeture : la semaine qui vient
    expect(localYmd(weekStartFor(at(2026, 11, 21), 2, 5))).toBe('2026-11-17');
  });
  test('creneaux de 10 min de 09:00 a 18:00 = 54 lignes ; arrondi a la granularite', () => {
    const s = slotsOfDay('09:00', '18:00', 10);
    expect(s.length).toBe(54);
    expect(s[0]).toBe(540);
    expect(snapMinutes(604, 10)).toBe(600);
    expect(snapMinutes(606, 15)).toBe(600);
  });
  test('semainier : 1er tri heure, 2e tri avancement', () => {
    const rows = receptionSort([
      { id: 'b', starts_at: '2026-11-18T10:00:00Z', status: 'en_cours' },
      { id: 'a', starts_at: '2026-11-18T10:00:00Z', status: 'prevu' },
      { id: 'c', starts_at: '2026-11-18T09:00:00Z', status: 'termine' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
  test('format des durees', () => {
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(90)).toBe('1h30');
    expect(formatMinutes(45)).toBe('45 min');
  });
});

describe('glisser-deposer (RDV en attente → compagnon / creneau)', () => {
  const base = { day: at(2026, 11, 18), ctx: ctx(), slotMinutes: 10, appts: [] as { id: string; starts_at: string; planned_minutes: number | null; status: string; mechanic_id?: string | null }[] };
  test('mercredi 10:00 sur Jeremy : accepte', () => {
    expect(checkDrop({ ...base, mechanicId: 'jeremy', startMinutes: 600, minutes: 120, blockOverlaps: true }).ok).toBe(true);
  });
  test('pendant la pause de midi ou apres 18:00 : refuse', () => {
    expect(checkDrop({ ...base, mechanicId: 'jeremy', startMinutes: 12 * 60 + 30, minutes: 30, blockOverlaps: false })).toEqual({ ok: false, reason: 'unavailable' });
    expect(checkDrop({ ...base, mechanicId: 'jeremy', startMinutes: 17 * 60, minutes: 120, blockOverlaps: false })).toEqual({ ok: false, reason: 'unavailable' });
  });
  test('un jour ferie : refuse', () => {
    expect(checkDrop({ ...base, day: at(2026, 11, 11), mechanicId: 'jeremy', startMinutes: 600, minutes: 60, blockOverlaps: false }).ok).toBe(false);
  });
  test('chevauchement refuse seulement si le reglage le demande', () => {
    const appts = [{ id: 'x', starts_at: iso(2026, 11, 18, 10), planned_minutes: 60, status: 'prevu', mechanic_id: 'jeremy' }];
    expect(checkDrop({ ...base, appts, mechanicId: 'jeremy', startMinutes: 630, minutes: 60, blockOverlaps: true })).toEqual({ ok: false, reason: 'overlap' });
    expect(checkDrop({ ...base, appts, mechanicId: 'jeremy', startMinutes: 630, minutes: 60, blockOverlaps: false }).ok).toBe(true);
    expect(checkDrop({ ...base, appts, mechanicId: 'jeremy', startMinutes: 660, minutes: 60, blockOverlaps: true }).ok).toBe(true);
    // Deplacer le RDV sur lui-meme n'est pas un chevauchement.
    expect(checkDrop({ ...base, appts, mechanicId: 'jeremy', startMinutes: 630, minutes: 60, blockOverlaps: true, appointmentId: 'x' }).ok).toBe(true);
  });
  test('liste d\'attente : sans affectation ou demande de l\'espace client, sans OR', () => {
    expect(isWaiting({ status: 'prevu', unassigned: true })).toBe(true);
    expect(isWaiting({ status: 'demande', unassigned: false })).toBe(true);
    expect(isWaiting({ status: 'prevu', unassigned: false })).toBe(false);
    expect(isWaiting({ status: 'prevu', unassigned: true, or_id: 'or1' })).toBe(false);
    expect(isWaiting({ status: 'annule', unassigned: true })).toBe(false);
  });
});

describe('RDV → OR (G8 « Valider RDV et saisie OR »)', () => {
  test('temps prevu obligatoire', () => {
    expect(canCreateOr({ planned_minutes: null, status: 'prevu' })).toBe(false);
    expect(canCreateOr({ planned_minutes: 0, status: 'prevu' })).toBe(false);
    expect(canCreateOr({ planned_minutes: 120, status: 'prevu' })).toBe(true);
    expect(canCreateOr({ planned_minutes: 120, status: 'prevu', or_id: 'deja' })).toBe(false);
    expect(canCreateOr({ planned_minutes: 120, status: 'annule' })).toBe(false);
  });
  test('saisie du temps prevu en h + min, km', () => {
    expect(plannedMinutesFrom('2', '')).toBe(120);
    expect(plannedMinutesFrom('1,5', '10')).toBe(100);
    expect(plannedMinutesFrom('', '')).toBeNull();
    expect(parseMileage('60 000')).toBe(60000);
    expect(parseMileage('')).toBeNull();
    expect(Number.isNaN(parseMileage('abc') as number)).toBe(true);
  });
  test('statut du RDV aligne sur le statut de l\'OR', () => {
    expect(appointmentStatusForOr('a_faire')).toBe('arrive');
    expect(appointmentStatusForOr('en_cours')).toBe('en_cours');
    expect(appointmentStatusForOr('attente_pieces')).toBe('attente');
    expect(appointmentStatusForOr('pret')).toBe('termine');
    expect(appointmentStatusForOr('client_informe')).toBe('client_informe');
    expect(appointmentStatusForOr('facture')).toBe('facture');
    expect(appointmentStatusForOr('annule')).toBeNull();
  });
  test('la meme correspondance est ecrite en base (fonction SQL)', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261118120000_m8_planning_charge_g8.sql', import.meta.url), 'utf8');
    for (const [or, rdv] of [['a_faire', 'arrive'], ['en_cours', 'en_cours'], ['pret', 'termine'], ['client_informe', 'client_informe'], ['facture', 'facture']]) {
      expect(sql.includes(`when _or_status = '${or}' then '${rdv}'`)).toBe(true);
    }
    expect(sql.includes("when _or_status like 'attente%' then 'attente'")).toBe(true);
    expect(sql.includes('Temps prevu obligatoire')).toBe(true);
  });
});

describe('motos de pret', () => {
  const loans = [
    { id: 'l1', loaner_id: 'm1', status: 'reserve', planned_start: iso(2026, 11, 18, 9), planned_end: iso(2026, 11, 19, 18) },
    { id: 'l2', loaner_id: 'm1', status: 'annule', planned_start: iso(2026, 11, 20, 9), planned_end: iso(2026, 11, 20, 18) },
    { id: 'l3', loaner_id: 'm2', status: 'sorti', planned_start: iso(2026, 11, 17, 9), planned_end: iso(2026, 11, 18, 12) },
  ];
  test('pas deux prets actifs qui se chevauchent sur la meme moto', () => {
    expect(conflictingLoan(loans, { loaner_id: 'm1', status: 'reserve', planned_start: iso(2026, 11, 19, 9), planned_end: iso(2026, 11, 19, 12) })?.id).toBe('l1');
    expect(checkPeriod(loans, { loaner_id: 'm1', status: 'reserve', planned_start: iso(2026, 11, 20, 9), planned_end: iso(2026, 11, 20, 12) })).toBeNull();
    expect(checkPeriod(loans, { loaner_id: 'm2', status: 'reserve', planned_start: iso(2026, 11, 19, 9), planned_end: iso(2026, 11, 19, 12) })).toBeNull();
    expect(checkPeriod(loans, { loaner_id: 'm1', status: 'reserve', planned_start: iso(2026, 11, 21, 12), planned_end: iso(2026, 11, 21, 9) })).toBe('period');
  });
  test('sortie : date et km obligatoires ; retour : km >= sortie, apres la sortie', () => {
    expect(checkOut({ outAt: null, outKm: 100 })).toBe('out_date');
    expect(checkOut({ outAt: iso(2026, 11, 18, 9), outKm: null })).toBe('out_km');
    expect(checkOut({ outAt: iso(2026, 11, 18, 9), outKm: 1200 })).toBeNull();
    const out = { outAt: iso(2026, 11, 18, 9), outKm: 1200 };
    expect(checkReturn({ ...out, returnedAt: iso(2026, 11, 19, 17), returnKm: 1100 })).toBe('km_lower');
    expect(checkReturn({ ...out, returnedAt: iso(2026, 11, 17, 17), returnKm: 1300 })).toBe('return_before_out');
    expect(checkReturn({ ...out, returnedAt: null, returnKm: 1300 })).toBe('return_date');
    expect(checkReturn({ ...out, returnedAt: iso(2026, 11, 19, 17), returnKm: 1340 })).toBeNull();
    expect(loanDistance({ out_km: 1200, return_km: 1340 })).toBe(140);
  });
  test('disponibilite par jour et retard', () => {
    expect(loanerDayState(loans, 'm1', at(2026, 11, 18)).state).toBe('reserve');
    expect(loanerDayState(loans, 'm1', at(2026, 11, 20)).state).toBe('libre');
    expect(loanerDayState(loans, 'm2', at(2026, 11, 18)).state).toBe('sorti');
    expect(isOverdue(loans[2], at(2026, 11, 18, 15))).toBe(true);
    expect(isOverdue(loans[0], at(2026, 11, 25))).toBe(false);
  });
});
