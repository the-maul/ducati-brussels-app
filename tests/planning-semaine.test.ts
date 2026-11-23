import { describe, expect, test } from 'bun:test';
import { appointmentTypeForReason, nextFreeStart, sumLoads, type DayLoad } from '../src/modules/workshop/planning/rules';
import { withReturnedVehicle, type AppointmentDraft } from '../src/modules/workshop/planning/appointment-draft';

const load = (planned: number, capacity: number): DayLoad => ({
  planned, capacity, pct: capacity > 0 ? Math.round((planned / capacity) * 10000) / 100 : null, closed: null,
});

describe('Remplissage de la semaine', () => {
  test('additionne le prévu et la capacité', () => {
    const w = sumLoads([load(240, 480), load(480, 480), load(0, 0)]);
    expect(w.planned).toBe(720);
    expect(w.capacity).toBe(960);
    expect(w.pct).toBe(75);
  });
  test('personne de présent : pas de pourcentage', () => {
    expect(sumLoads([load(0, 0), load(0, 0)]).pct).toBeNull();
  });
});

describe('Premier créneau libre d\'un compagnon', () => {
  const day: [number, number][] = [[540, 720], [780, 1020]];
  test('journée vide : début de la présence', () => {
    expect(nextFreeStart(day, [])).toBe(540);
  });
  test('après les RDV déjà placés', () => {
    expect(nextFreeStart(day, [[540, 600], [600, 660]])).toBe(660);
  });
  test('matin plein : reprend après la pause', () => {
    expect(nextFreeStart(day, [[540, 720]])).toBe(780);
  });
  test('un trou entre deux RDV est utilisé', () => {
    expect(nextFreeStart(day, [[540, 600], [660, 720]])).toBe(600);
  });
  test('journée pleine ou absent : rien', () => {
    expect(nextFreeStart(day, [[540, 720], [780, 1020]])).toBeNull();
    expect(nextFreeStart([], [])).toBeNull();
  });
});

describe('RDV retrouvé après un aller-retour', () => {
  const draft = { contactId: 'c1', vehicleId: null, date: '2026-12-02' } as unknown as AppointmentDraft;
  test('la moto créée prend place, le client reste', () => {
    expect(withReturnedVehicle(draft, 'v1')).toMatchObject({ contactId: 'c1', vehicleId: 'v1', date: '2026-12-02' });
  });
  test('retour sans moto : la saisie ne change pas', () => {
    expect(withReturnedVehicle(draft, null)).toBe(draft);
  });
});

describe('Le motif du RDV donne son type', () => {
  test('entretiens et vidange', () => {
    for (const r of ['entretien_annuel', 'entretien_annuel_huile', 'entretien_1000', 'vidange']) {
      expect(appointmentTypeForReason(r)).toBe('entretien');
    }
  });
  test('réparation', () => {
    for (const r of ['freins', 'diagnostic', 'accident']) expect(appointmentTypeForReason(r)).toBe('reparation');
  });
  test('motifs qui portent le même nom que le type', () => {
    for (const r of ['pneus', 'garantie', 'preparation', 'carrosserie']) expect(appointmentTypeForReason(r)).toBe(r);
  });
  test('autre ou sans motif : pas de type', () => {
    expect(appointmentTypeForReason('autre')).toBeNull();
    expect(appointmentTypeForReason('')).toBeNull();
    expect(appointmentTypeForReason(null)).toBeNull();
  });
});
