/**
 * Plaque lue au DCS, sur la carte grise ou dans un import G8 (Simon, 26/11/2026) :
 * « M-ACN-057 » est la même plaque que « MACN057 » ; elle n'est jamais réécrite avec des tirets,
 * et une comparaison ne signale pas de faux écart.
 */
import { describe, expect, test } from 'bun:test';
import { plateFromSource, samePlate } from '../src/lib/plate';
import { planDcsImport, type DcsModelMatch, type DcsPayloadV2 } from '../src/lib/dcs-rules';
import { applyCgReading, type CgReading } from '../src/modules/vehicles/carte-grise-apply';
import { parseVehiclesCsv } from '../src/modules/migration/vehicles-import';

const VIN = 'ZDM1A02BGMB009261';
const noModel: DcsModelMatch = { status: 'conflict', reason: 'no_title', modelYearId: null, modelText: null, color: null, candidateIds: [] };
const dcs = (plate: string): DcsPayloadV2 => ({
  format: 2, vin: VIN, read_vin: VIN, requested_vin: VIN, read_error: null, issues: [], header: { plate }, vehicle: {}, contact: {},
} as unknown as DcsPayloadV2);
const plateStatus = (current: Record<string, unknown>, plate: string) => {
  const plan = planDcsImport({ current, payload: dcs(plate), model: noModel });
  return { plan, status: plan.statuses.find((s) => s.field === 'plate') };
};

describe('plaque venue d’une autre source', () => {
  test('même plaque avec ou sans tirets, espaces ou minuscules', () => {
    expect(samePlate('M-ACN-057', 'MACN057')).toBe(true);
    expect(samePlate('m acn.057', 'MACN057')).toBe(true);
    expect(samePlate('M-ACN-057', 'MACN058')).toBe(false);
    expect(samePlate('', '')).toBe(false);
  });
  test('6 à 8 caractères : enregistrée sans tirets ; sinon le texte reste tel quel', () => {
    expect(plateFromSource(' 1-abc-123 ')).toBe('1ABC123');
    expect(plateFromSource('MAI-202')).toBe('MAI202');
    expect(plateFromSource('378-NHR-75')).toBe('378NHR75');
    expect(plateFromSource('MH-900')).toBe('MH-900');
    expect(plateFromSource('MOTO PISTE')).toBe('MOTO PISTE');
    expect(plateFromSource('  ')).toBeNull();
  });
});

describe('DCS', () => {
  test('plaque identique aux tirets près : certifiée, rien n’est écrit', () => {
    const { plan, status } = plateStatus({ plate: 'MACN057' }, 'M-ACN-057');
    expect(plan.changes.find((c) => c.field === 'plate')).toBeUndefined();
    expect(status?.status).toBe('certifie');
    expect(plan.counts.conflicts).toBe(0);
  });
  test('plaque vide : remplie sans tirets', () => {
    const { plan, status } = plateStatus({ plate: null }, 'M-ACN-057');
    expect(plan.changes).toContainEqual({ field: 'plate', old: null, new: 'MACN057', action: 'filled' });
    expect(status?.dcs_value).toBe('MACN057');
  });
  test('vraie différence : écart montré sans tirets, rien n’est remplacé', () => {
    const { plan, status } = plateStatus({ plate: '1ABC123' }, 'M-ACN-057');
    expect(plan.changes).toEqual([]);
    expect(status).toMatchObject({ status: 'conflit', dcs_value: 'MACN057', previous_value: '1ABC123' });
  });
  test('plaque vide et plaque DCS qui ne fait pas 7 caractères : non écrite, signalée', () => {
    const { plan } = plateStatus({ plate: '' }, 'ACN-05');
    expect(plan.changes.find((c) => c.field === 'plate')).toBeUndefined();
    expect(plan.invalid).toContain('plate');
  });
});

describe('carte grise et import G8', () => {
  const reading = (plate: string): CgReading => ({
    is_registration_certificate: true, values: { plate }, confidence: { plate: 'high' }, unmapped: [], holder: null,
  });
  test('carte grise « 1-ABC-123 » face à « 1ABC123 » : pas de faux écart', () => {
    expect(applyCgReading({ plate: '1ABC123' }, reading('1-ABC-123')).conflicts).toEqual({});
  });
  test('carte grise sur plaque vide : remplie sans tirets', () => {
    expect(applyCgReading({ plate: '' }, reading('1-ABC-123')).next.plate).toBe('1ABC123');
  });
  test('import G8 : plaque à tirets enregistrée sans tirets', () => {
    const preview = parseVehiclesCsv('vin;plaque\nZDM1A02BGMB009261;1-ABC-123\nZDM1A02BGMB009262;MOTO PISTE\n');
    expect(preview.mapped[0].payload.plate).toBe('1ABC123');
    expect(preview.mapped[1].payload.plate).toBe('MOTO PISTE');
  });
});
