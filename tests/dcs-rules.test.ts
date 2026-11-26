/**
 * Règles de certification DCS validées par Simon (src/lib/dcs-rules.ts). Données fictives.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildDcsContactPatch, checkDcsPayload, pickDcsVehicle, cleanDcsEvents, dcsCompanyCheck, matchDcsModel, normalizeEngine,
  normalizePlate, parseDcsDate, parseDcsKm, planDcsImport, sameColor, type DcsEventRow, type DcsModelCandidate,
  type DcsModelMatch, type DcsPayloadV2,
} from '../src/lib/dcs-rules';

const VIN = 'ZDM00000000000001';
const candidate = (id: string, model: string, year = 2016, family = 'MULTISTRADA', supermodel = '1200'): DcsModelCandidate =>
  ({ model_year_id: id, family, supermodel, model, name: model, year });
const CANDIDATES = [candidate('a', '1200 S'), candidate('b', '1200 S Touring'), candidate('c', '1200 S Touring', 2015)];
const noModel: DcsModelMatch = { status: 'conflict', reason: 'no_title', modelYearId: null, modelText: null, color: null, candidateIds: [] };
const payload = (vehicle: Record<string, unknown> = {}, plate: string | null = null): DcsPayloadV2 => ({
  format: 2, vin: VIN, read_vin: VIN, requested_vin: VIN, read_error: null, issues: [], header: { plate }, vehicle, contact: {},
});
const statusOf = (plan: ReturnType<typeof planDcsImport>, field: string) => plan.statuses.find((s) => s.field === field);

describe('modèle exact', () => {
  test('le titre départage les versions et donne la couleur', () => {
    const m = matchDcsModel('MULTISTRADA 1200 S TOURING DUCATI RED', 2016, CANDIDATES);
    expect(m).toMatchObject({ status: 'certified', modelYearId: 'b', modelText: 'MULTISTRADA 1200 S TOURING', color: 'DUCATI RED' });
  });

  test('l’année du titre choisit le bon millésime', () => {
    expect(matchDcsModel('MULTISTRADA 1200 S TOURING ICEBERG WHITE', 2015, CANDIDATES).modelYearId).toBe('c');
  });

  test('une version courte n’avale pas un mot de variante', () => {
    // Seul candidat « 1200 S » face à un titre Touring : ce n'est pas la bonne version.
    expect(matchDcsModel('MULTISTRADA 1200 S TOURING DUCATI RED', 2016, [candidate('a', '1200 S')]))
      .toMatchObject({ status: 'conflict', reason: 'ambiguous', modelYearId: null });
    // Seul candidat avec une couleur encore inconnue : cohérent.
    expect(matchDcsModel('MULTISTRADA 1200 S COULEUR NOUVELLE', 2016, [candidate('a', '1200 S')]))
      .toMatchObject({ status: 'certified', modelYearId: 'a', color: 'COULEUR NOUVELLE' });
    expect(matchDcsModel('MONSTER 821 DARK STEALTH', 2016, [
      candidate('x', '821', 2016, 'MONSTER', '821'), candidate('y', '821 DARK', 2016, 'MONSTER', '821'),
    ])).toMatchObject({ status: 'certified', modelYearId: 'x', color: 'DARK STEALTH' });
  });

  test('deux candidats identiques ou aucun : conflit, jamais de choix au hasard', () => {
    expect(matchDcsModel('MULTISTRADA 1200 S RED', 2016, [candidate('a', '1200 S'), candidate('z', '1200 S')]).status).toBe('conflict');
    expect(matchDcsModel('PANIGALE V4 RED', 2016, CANDIDATES)).toMatchObject({ status: 'conflict', reason: 'no_match' });
    expect(matchDcsModel('MULTISTRADA 1200 S RED', 2019, CANDIDATES)).toMatchObject({ status: 'conflict', reason: 'year_mismatch' });
    expect(matchDcsModel('MULTISTRADA 1200 S RED', 2016, [])).toMatchObject({ status: 'conflict', reason: 'no_candidate' });
  });
});

describe('normalisation', () => {
  test('n° moteur, plaque et couleur : pas de faux conflit', () => {
    expect(normalizeEngine('zdm 1198-a2.0001')).toBe(normalizeEngine('ZDM1198A20001'));
    expect(normalizePlate('1-abc-234')).toBe('1ABC234');
    expect(sameColor('ROUGE', 'DUCATI RED')).toBe(true);
    expect(sameColor('BLANCHE', 'ICEBERG WHITE')).toBe(true);
    expect(sameColor('NOIR MAT', 'MATT BLACK')).toBe(true);
    expect(sameColor('ROUGE', 'ICEBERG WHITE')).toBe(false);
  });

  test('dates et kilomètres', () => {
    expect(parseDcsDate('31/02/2025')).toBeNull();
    expect(parseDcsDate('6/07/2022')).toBe('2022-07-06');
    expect(parseDcsKm('23.436 km')).toBe(23436);
    expect(parseDcsKm('-')).toBeNull();
  });
});

describe('règles R1 / R2', () => {
  test('R1 usine : le DCS remplace, l’ancienne valeur est tracée', () => {
    const plan = planDcsImport({ current: { engine_number: 'ANCIEN01', warranty_end: '2018-01-01' }, payload: payload({ engine_number: 'NOUVEAU2', warranty_end: '31/07/2018' }), model: noModel });
    expect(plan.changes).toContainEqual({ field: 'engine_number', old: 'ANCIEN01', new: 'NOUVEAU2', action: 'replaced' });
    expect(plan.changes).toContainEqual({ field: 'warranty_end', old: '2018-01-01', new: '2018-07-31', action: 'replaced' });
    expect(statusOf(plan, 'engine_number')?.status).toBe('certifie');
  });

  test('R2 variable : rien n’est remplacé, les deux valeurs restent', () => {
    const plan = planDcsImport({ current: { plate: '1ABC234', mileage: 20000, color: 'ROUGE' }, payload: payload({ last_km: '23436 km' }, 'TST260'), model: { ...noModel, color: 'ICEBERG WHITE' } });
    expect(plan.changes).toEqual([]);
    expect(statusOf(plan, 'plate')).toMatchObject({ status: 'conflit', dcs_value: 'TST260', previous_value: '1ABC234' });
    expect(statusOf(plan, 'mileage')).toMatchObject({ status: 'conflit', dcs_value: '23436', previous_value: '20000' });
    expect(statusOf(plan, 'color')?.status).toBe('conflit');
    expect(plan.counts.conflicts).toBe(3);
  });

  test('valeurs identiques après normalisation : certifié sans écriture', () => {
    const plan = planDcsImport({ current: { engine_number: 'ZDM 1198-A2', plate: '1-ABC-234', color: 'ROUGE' }, payload: payload({ engine_number: 'ZDM1198A2' }, '1ABC234'), model: { ...noModel, color: 'DUCATI RED' } });
    expect(plan.changes).toEqual([]);
    expect(plan.counts.confirmed).toBe(3);
  });

  test('champ vide : rempli depuis le DCS et tracé', () => {
    const plan = planDcsImport({ current: { plate: null, mileage: null }, payload: payload({ last_km: '100 km' }, 'TST260'), model: noModel });
    expect(plan.changes).toContainEqual({ field: 'plate', old: null, new: 'TST260', action: 'filled' });
    expect(plan.changes).toContainEqual({ field: 'mileage', old: null, new: 100, action: 'filled' });
  });

  test('un kilométrage à 0 sur la fiche est une valeur, pas un vide', () => {
    const plan = planDcsImport({ current: { mileage: 0 }, payload: payload({ last_km: '100 km' }), model: noModel });
    expect(plan.changes).toEqual([]);
    expect(statusOf(plan, 'mileage')?.status).toBe('conflit');
  });

  test('CarGarantie déjà choisie : conservée', () => {
    const plan = planDcsImport({ current: { warranty_type: 'CarGarantie' }, payload: payload({ warranty_type: 'Conventionnelle (24 mois)' }), model: noModel });
    expect(plan.changes).toEqual([]);
    expect(statusOf(plan, 'warranty_type')).toMatchObject({ status: 'saisi', dcs_value: 'Conventionnelle (24 mois)' });
  });

  test('origine : activée par, sinon facturée à, seulement si vide', () => {
    const first = planDcsImport({ current: { origin: null }, payload: payload({ warranty_activated_by: 'ACTIVEE', invoiced_to: 'FACTUREE' }), model: noModel });
    expect(first.changes).toContainEqual({ field: 'origin', old: null, new: 'ACTIVEE', action: 'filled' });
    const second = planDcsImport({ current: { origin: null }, payload: payload({ warranty_activated_by: '-', invoiced_to: 'FACTUREE' }), model: noModel });
    expect(second.changes).toContainEqual({ field: 'origin', old: null, new: 'FACTUREE', action: 'filled' });
    const kept = planDcsImport({ current: { origin: 'DMS' }, payload: payload({ warranty_activated_by: 'ACTIVEE' }), model: noModel });
    expect(kept.changes.some((c) => c.field === 'origin')).toBe(false);
  });

  test('modèle certifié : remplacé avec son modèle catalogue', () => {
    const model = matchDcsModel('MULTISTRADA 1200 S TOURING DUCATI RED', 2016, CANDIDATES);
    const plan = planDcsImport({ current: { model: 'MTS 1200', ducati_model_year_id: 'a', color: 'ROUGE' }, payload: payload(), model });
    expect(plan.changes).toContainEqual({ field: 'model', old: 'MTS 1200', new: 'MULTISTRADA 1200 S TOURING', action: 'replaced' });
    expect(plan.changes).toContainEqual({ field: 'ducati_model_year_id', old: 'a', new: 'b', action: 'replaced' });
  });

  test('modèle non départagé : conflit, la fiche ne bouge pas', () => {
    const model = matchDcsModel('PANIGALE V4 RED', 2016, CANDIDATES);
    const plan = planDcsImport({ current: { model: 'MTS 1200', ducati_model_year_id: 'a' }, payload: payload(), model });
    expect(plan.changes.some((c) => c.field === 'model' || c.field === 'ducati_model_year_id')).toBe(false);
    expect(statusOf(plan, 'model')?.status).toBe('conflit');
    expect(statusOf(plan, 'ducati_model_year_id')?.dcs_value).toBe('a,b,c');
  });

  test('format invalide : ignoré et signalé', () => {
    const plan = planDcsImport({ current: { production_date: '2016-07-06' }, payload: payload({ production_date: '31/02/2016' }), model: noModel });
    expect(plan.changes).toEqual([]);
    expect(plan.invalid).toContain('production_date');
  });

  test('propriétaire différent : conflit, jamais écrit', () => {
    const plan = planDcsImport({ current: {}, payload: payload(), model: noModel, owner: { name: 'CAMILLE EXEMPLE', currentName: 'Alex Fictif', matches: false } });
    expect(plan.changes).toEqual([]);
    expect(statusOf(plan, 'owner')).toMatchObject({ status: 'conflit', dcs_value: 'CAMILLE EXEMPLE', previous_value: 'Alex Fictif' });
  });
});

describe('garde-fous', () => {
  test('ancienne extension, VIN différent, lecture incohérente : refus', () => {
    expect(checkDcsPayload({ vin: VIN } as DcsPayloadV2)).toBe('old_extension');
    expect(checkDcsPayload({ ...payload(), requested_vin: 'ZDM99999999999999' })).toBe('vin_mismatch');
    expect(checkDcsPayload({ ...payload(), read_error: 'vin_mismatch' })).toBe('vin_mismatch');
    expect(checkDcsPayload({ ...payload(), read_vin: null })).toBe('no_vin');
    expect(checkDcsPayload({ ...payload(), issues: ['label_as_value:ducati_state'] })).toBe('bad_read');
    expect(checkDcsPayload(payload())).toBeNull();
    expect(checkDcsPayload({ ...payload(), read_vin: null, read_error: 'not_connected' })).toBe('not_connected');
  });

  test('société : celle de la demande, sinon confirmation', () => {
    expect(dcsCompanyCheck('s1', 's1')).toBe('ok');
    expect(dcsCompanyCheck('s1', 's2')).toBe('mismatch');
    expect(dcsCompanyCheck(null, 's2')).toBe('confirm');
    expect(dcsCompanyCheck('s1', null)).toBe('mismatch');
  });

  test('client : uniquement my_ducati_*, jamais les coordonnées ni les consentements DMS', () => {
    const patch = buildDcsContactPatch({
      my_ducati_email: 'camille@example.test', my_ducati_phone: '+32000000000', my_ducati_marketing: true,
      my_ducati_profiling: null, my_ducati_score: 3, ducati_code: 'C-0001', address: '1 rue Fictive',
      email: 'ne-pas-ecrire@example.test', marketing_opt_out: true,
    }, 'CAMILLE', 'EXEMPLE');
    expect(Object.keys(patch).every((k) => k.startsWith('my_ducati_'))).toBe(true);
    expect(patch.my_ducati_marketing).toBe(true);
    expect('my_ducati_profiling' in patch).toBe(false);
    expect(patch.my_ducati_data).toEqual({ ducati_code: 'C-0001', address: '1 rue Fictive' });
  });

  test('e-mail sans @ : non repris', () => {
    expect('my_ducati_email' in buildDcsContactPatch({ my_ducati_email: 'pas-un-email' }, 'A', 'B')).toBe(false);
  });

  test('événements : une ligne par ID, l’état le plus avancé gagne', () => {
    const base: DcsEventRow = { kind: 'upcoming', event_category: 'Maintenance', service_type: 'Oil Service', reference: null, state: 'Prévu', symptom: null, cause: null, km: null, event_date: null, due_date: '2027-01-01', dealer: null, ducati_event_id: '1' };
    const rows = cleanDcsEvents([base, { ...base, kind: 'past', state: 'Fait', event_date: '2026-01-01', due_date: null }, { ...base, ducati_event_id: '-' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'past', state: 'Fait' });
  });
});

describe('fiche qui recoit la lecture DCS', () => {
  const a = { id: 'a' }; const b = { id: 'b' };
  test('une seule fiche : celle-la ; aucune : rien', () => {
    expect(pickDcsVehicle([a], null)).toBe(a);
    expect(pickDcsVehicle([], 'a')).toBeNull();
  });
  test('meme VIN sur deux fiches : celle d ou part la demande, sinon refus', () => {
    expect(pickDcsVehicle([a, b], 'b')).toBe(b);
    expect(pickDcsVehicle([a, b], null)).toBe('duplicate');
    expect(pickDcsVehicle([a, b], 'z')).toBe('duplicate');
  });
});
