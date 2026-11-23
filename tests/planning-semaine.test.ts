import { describe, expect, test } from 'bun:test';
import { nextFreeStart, sumLoads, type DayLoad } from '../src/modules/workshop/planning/rules';

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
