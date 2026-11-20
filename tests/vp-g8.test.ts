/**
 * Lot « VP G8 » (décisions du client du 20/11/2026, « tout comme G8 ») — règles pures :
 *  - VP1 « Bonjour Jean » : prénom en casse titre (écran et fonctions serveur, même règle que SQL) ;
 *  - VP8 champs obligatoires de l'OR et de la cession (même règle que la base) ;
 *  - VP9 seuls les compagnons comptent dans la charge (2 h sur 24 h = 8,33 %, parcours G8 n° 20) ;
 *  - défauts du test écran : libellé d'entretien en français, frise « Travail : en pause ».
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { greetingName, titleCaseName } from '../src/lib/person-name';
import * as shared from '../supabase/functions/_shared/person-name';
import { cessionMissingFields, cessionTypeRequiresVehicle, orMissingFields, orRequiredMessage } from '../src/modules/workshop/required-g8';
import { translateDbError } from '../src/lib/db-error-i18n';
import { dayLoad, type CalendarBlock, type DayContext, type MechanicHours, type PlanningMechanic } from '../src/modules/workshop/planning/rules';
import { serviceLabelDisplay } from '../src/modules/workshop/service-label-fr';
import { orProgress, type OrProgressInput } from '../src/modules/workshop/or-base/progress-rules';

describe('VP1 — Bonjour Jean', () => {
  test('casse titre : JEAN → Jean, JEAN-PIERRE → Jean-Pierre, ANNE MARIE → Anne Marie, accents et apostrophe', () => {
    expect(titleCaseName('JEAN')).toBe('Jean');
    expect(titleCaseName('JEAN-PIERRE')).toBe('Jean-Pierre');
    expect(titleCaseName('ANNE MARIE')).toBe('Anne Marie');
    expect(titleCaseName('ÉLODIE')).toBe('Élodie');
    expect(titleCaseName("D'ARTAGNAN")).toBe("D'Artagnan");
    expect(titleCaseName('  chloé-ève ')).toBe('Chloé-Ève');
    expect(titleCaseName(null)).toBe('');
  });
  test('nom de salutation : prénom, sinon raison sociale telle quelle, sinon nom', () => {
    expect(greetingName({ type: 'particulier', first_name: 'JEAN', last_name: 'DUPONT' })).toBe('Jean');
    expect(greetingName({ type: 'professionnel', company_name: 'MOTO SPRL' })).toBe('MOTO SPRL');
    expect(greetingName({ last_name: 'DUPONT' })).toBe('Dupont');
    expect(greetingName(null)).toBe('');
  });
  test('la copie des fonctions serveur suit la même règle', () => {
    expect(shared.titleCaseName('JEAN-PIERRE')).toBe('Jean-Pierre');
    expect(shared.greetingName({ first_name: 'ANNE MARIE', last_name: 'X' })).toBe('Anne Marie');
  });
  test('les modèles « Bonjour {client} / {name} » de l\'écran sont remplis avec le prénom (pas le nom complet en MAJUSCULES)', () => {
    const ready = readFileSync(new URL('../src/modules/workshop/or-base/ready-mail-dialog.tsx', import.meta.url), 'utf8');
    const matching = readFileSync(new URL('../src/modules/crm/matching-api.ts', import.meta.url), 'utf8');
    const orPage = readFileSync(new URL('../src/routes/_app.workshop.$orId.tsx', import.meta.url), 'utf8');
    const proposal = readFileSync(new URL('../supabase/functions/proposal-sign/index.ts', import.meta.url), 'utf8');
    expect(ready).toContain('client: greetingName(contact)');
    expect(matching).toContain('name: greetingName(contact)');
    expect(orPage).toContain('client: greetingName(contact)');
    expect(proposal).toContain('greetingName(p.contact)');
  });
});

describe('VP8 — champs obligatoires', () => {
  test('nouvel OR : opérateur, client et n° de série', () => {
    expect(orMissingFields({ isNew: true, contactId: null, vehicleId: null, hasOperator: false })).toEqual(['operator', 'contact', 'vehicle']);
    expect(orMissingFields({ isNew: true, contactId: 'c', vehicleId: 'v', hasOperator: true })).toEqual([]);
  });
  test('OR existant incomplet : modifiable ; on ne retire pas un client ou une moto posés', () => {
    expect(orMissingFields({ isNew: false, saved: { contactId: null, vehicleId: 'v', hasOperator: true }, contactId: null, vehicleId: 'v', hasOperator: true })).toEqual([]);
    expect(orMissingFields({ isNew: false, saved: { contactId: 'c', vehicleId: 'v', hasOperator: true }, contactId: null, vehicleId: null, hasOperator: true })).toEqual(['contact', 'vehicle']);
  });
  test('cession : type et opérateur ; moto pour 01 / 02 ou réglage du type', () => {
    expect(cessionMissingFields({ type: '', hasOperator: false, vehicleId: null, typeRequiresVehicle: false })).toEqual(['type', 'operator']);
    expect(cessionMissingFields({ type: '01', hasOperator: true, vehicleId: null, typeRequiresVehicle: cessionTypeRequiresVehicle('01', {}) })).toEqual(['vehicle']);
    expect(cessionTypeRequiresVehicle('03', {})).toBe(false);
    expect(cessionTypeRequiresVehicle('03', { requires_vehicle: true })).toBe(true);
    expect(cessionTypeRequiresVehicle('01', { requires_vehicle: false })).toBe(false);
  });
  test('messages FR clairs, erreur de la base traduite (hint repair_order_required / cession_required)', () => {
    expect(orRequiredMessage(['vehicle', 'operator', 'contact'])).toBe('OR : complétez Opérateur, Client, N° de série (moto) (obligatoire, comme dans G8).');
    expect(translateDbError({ hint: 'repair_order_required', details: 'contact' })).toBe('OR : complétez Client (obligatoire, comme dans G8).');
    expect(translateDbError({ hint: 'cession_required', details: 'type,vehicle' })).toBe('Cession : complétez Type de cession, N° de série (moto) (obligatoire, comme dans G8).');
  });
});

describe('VP9 — seuls les compagnons comptent dans la charge', () => {
  const mech = (id: string, extra: Partial<PlanningMechanic> = {}): PlanningMechanic =>
    ({ id, name: id, visible_in_planning: true, is_active: true, sort_order: 0, user_id: null, ...extra });
  const g8Hours = (id: string): MechanicHours[] => [2, 3, 4, 5, 6].map((weekday) =>
    ({ mechanic_id: id, weekday, am_start: '09:00', am_end: '12:30', pm_start: '13:30', pm_end: '18:00' }));
  const ids = ['john', 'livio', 'luis', 'domenico', 'simon'];
  const MECHS = [mech('john'), mech('livio'), mech('luis'), mech('domenico', { counts_in_load: false }), mech('simon', { counts_in_load: false })];
  const ctx = (blocks: CalendarBlock[] = []): DayContext => ({ hours: ids.flatMap(g8Hours), blocks, belgianHolidays: true });
  const day = new Date(2026, 10, 18);
  const at10 = new Date(2026, 10, 18, 10).toISOString();

  test('2 h sur 24 h = 8,33 % (3 compagnons), comme G8 — et non 2 h sur 40 h', () => {
    const load = dayLoad(day, MECHS, [{ id: 'r', starts_at: at10, planned_minutes: 120, status: 'prevu', mechanic_id: 'john' }], ctx(), 10);
    expect(load.capacity).toBe(24 * 60);
    expect(load.pct).toBe(8.33);
  });
  test('un RDV confié à quelqu\'un qui ne compte pas ne charge pas l\'atelier ; filtré sur lui : sa charge propre', () => {
    const appts = [{ id: 'r', starts_at: at10, planned_minutes: 120, status: 'prevu', mechanic_id: 'domenico' }];
    expect(dayLoad(day, MECHS, appts, ctx(), 10).planned).toBe(0);
    const own = dayLoad(day, MECHS, appts, ctx(), 10, 'domenico');
    expect(own.capacity).toBe(8 * 60);
    expect(own.planned).toBe(120);
  });
  test('base pas encore migrée (pas de réglage) : tout le monde compte', () => {
    expect(dayLoad(day, ids.map((i) => mech(i)), [], ctx(), 10).capacity).toBe(40 * 60);
  });
});

describe('Défauts du test écran', () => {
  test('libellé d\'entretien en français', () => {
    expect(serviceLabelDisplay('Annual Service / Service Temporel')).toBe('Entretien annuel');
    expect(serviceLabelDisplay('Annual Service / Service Temporel + Oil Service + Opération supplémentaire : huile de fourche avant'))
      .toBe('Entretien annuel + Entretien vidange + Opération supplémentaire : huile de fourche avant');
    expect(serviceLabelDisplay('Desmo Service / Valve Check')).toBe('Entretien Desmo (jeu aux soupapes)');
    expect(serviceLabelDisplay('1er entretien (First Service / Oil Service 1000)')).toBe('1er entretien (1 000 km)');
    expect(serviceLabelDisplay('Entretien annuel')).toBe('Entretien annuel');
    expect(serviceLabelDisplay('24000 km')).toBe('24000 km');
    expect(serviceLabelDisplay(null)).toBe('');
  });
  const base: OrProgressInput = {
    orStatus: 'en_cours', receptionOn: true, receptionStatus: 'complete', photosTaken: 6, photosTotal: 6, photosMissing: 0,
    pointageOn: true, workState: 'paused', mineRunning: false, minePaused: true, planTotal: 28, planResolved: 3, planMandatoryOpen: 25,
    hasService: true, workAllowed: true, warrantyPending: false,
  };
  test('frise : session en pause → « Travail : en pause », jamais « fait »', () => {
    const steps = orProgress(base).steps;
    expect(steps.find((s) => s.key === 'work')?.state).toBe('paused');
    expect(orProgress({ ...base, workState: 'stopped', minePaused: false }).steps.find((s) => s.key === 'work')?.state).toBe('done');
    expect(orProgress({ ...base, orStatus: 'pret' }).steps.find((s) => s.key === 'work')?.state).toBe('done');
  });
  test('frise compacte : un seul texte d\'état par étape (pas « étape actuelle · étape actuelle »)', () => {
    const src = readFileSync(new URL('../src/modules/workshop/or-base/or-steps-trail.tsx', import.meta.url), 'utf8');
    const compact = src.slice(src.lastIndexOf('return ('));
    expect(compact).toContain('sm:not-sr-only');
    expect(compact).not.toContain('<span className="hidden text-info sm:inline"> · {state}</span>');
    expect(compact).not.toContain('<span className="sr-only"> : {state}</span>');
  });
});
