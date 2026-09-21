/**
 * Mission 07, carte 1 — règles des plans d'entretien (src/modules/workshop/maintenance-plans.ts) :
 * premier atteint (km ou mois), valeur en vigueur (le plus récent fait foi), prix = heures × taux HT.
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  nextDue, pickCurrent, labourPriceHt, effectiveHourlyRate, parseYearsDoc, planForUsage,
} from '../src/modules/workshop/maintenance-plans';

describe('prochaine échéance : le premier atteint (km ou mois)', () => {
  const oil = { km_interval: 15000, months: 24 };

  test('km atteint avant la date → échéance atteinte par le km', () => {
    const r = nextDue(oil, { km: 15200, date: '2026-09-21' }, { km: 0, date: '2025-09-01' });
    expect(r.dueKm).toBe(15000);
    expect(r.dueDate).toBe('2027-09-01');
    expect(r.reached).toBe(true);
    expect(r.reachedBy).toBe('km');
  });

  test('date atteinte avant le km → échéance atteinte par les mois', () => {
    const r = nextDue(oil, { km: 21000, date: '2026-09-21' }, { km: 12000, date: '2024-09-01' });
    expect(r.dueKm).toBe(27000);
    expect(r.dueDate).toBe('2026-09-01');
    expect(r.reached).toBe(true);
    expect(r.reachedBy).toBe('mois');
  });

  test('ni km ni date atteints → pas encore dû ; le rythme de roulage dit ce qui arrivera d’abord', () => {
    // 5 000 km en ~1 an : 15 000 km dans ~2 ans → la date (24 mois) arrive d'abord
    const slow = nextDue(oil, { km: 5000, date: '2026-09-01' }, { km: 0, date: '2025-09-01' });
    expect(slow.reached).toBe(false);
    expect(slow.firstTrigger).toBe('mois');
    // 12 000 km en 1 an : les 15 000 km arrivent avant les 24 mois
    const fast = nextDue(oil, { km: 12000, date: '2026-09-01' }, { km: 0, date: '2025-09-01' });
    expect(fast.reached).toBe(false);
    expect(fast.firstTrigger).toBe('km');
    expect(fast.kmReachedOn! < fast.dueDate!).toBe(true);
  });

  test('premier entretien : km_first depuis la mise en service', () => {
    const first = { km_first: 1000, months: 6 };
    const r = nextDue(first, { km: 800, date: '2026-04-01' }, null, { date: '2025-09-15' });
    expect(r.dueKm).toBe(1000);
    expect(r.dueDate).toBe('2026-03-15');
    expect(r.reached).toBe(true);
    expect(r.reachedBy).toBe('mois');
  });

  test('échéance seulement calendaire (Annual 12 mois)', () => {
    const r = nextDue({ months: 12 }, { km: 3000, date: '2026-01-31' }, { km: 1000, date: '2025-01-31' });
    expect(r.dueKm).toBeNull();
    expect(r.dueDate).toBe('2026-01-31');
    expect(r.reached).toBe(true);
    expect(r.firstTrigger).toBe('mois');
  });

  test('fin de mois : 31 janvier + 1 mois = 28 février', () => {
    const r = nextDue({ months: 1 }, { km: 0, date: '2025-02-01' }, { km: 0, date: '2025-01-31' });
    expect(r.dueDate).toBe('2025-02-28');
  });
});

describe('valeur en vigueur (le document le plus récent fait foi)', () => {
  const times = [
    { id: 'a', status: 'historique', source_sort: '2022-10', years_doc: '17-21', hours: 1.5, sort: 0 },
    { id: 'b', status: 'en_vigueur', source_sort: '2021-02b', years_doc: '17-21', hours: 1.1, sort: 1 },
    { id: 'c', status: 'en_vigueur', source_sort: '2022-10', years_doc: '17-21', hours: 1.1, sort: 2 },
  ];

  test('ignore l’historique et prend la source la plus récente', () => {
    expect(pickCurrent(times)?.id).toBe('c');
  });

  test('aucune valeur en vigueur → null (jamais une valeur historique)', () => {
    expect(pickCurrent([{ status: 'historique', source_sort: '2025-03' }])).toBeNull();
    expect(pickCurrent([])).toBeNull();
    expect(pickCurrent(null)).toBeNull();
  });

  test('le millésime de la moto départage deux valeurs en vigueur', () => {
    const rows = [
      { id: 'old', status: 'en_vigueur', source_sort: '2025-03', years_doc: '15-18' },
      { id: 'new', status: 'en_vigueur', source_sort: '2020-01', years_doc: '19-20' },
    ];
    expect(pickCurrent(rows, 2019)?.id).toBe('new');
    expect(pickCurrent(rows, 2016)?.id).toBe('old');
    expect(pickCurrent(rows)?.id).toBe('old');
  });

  test('années citées par les documents', () => {
    expect(parseYearsDoc('17-21')).toEqual({ from: 2017, to: 2021 });
    expect(parseYearsDoc('MY 17')).toEqual({ from: 2017, to: 2017 });
    expect(parseYearsDoc('MY10-14')).toEqual({ from: 2010, to: 2014 });
    expect(parseYearsDoc('')).toBeNull();
  });
});

describe('prix main-d’œuvre = heures × taux horaire HT', () => {
  test('calcul arrondi au centime', () => {
    expect(labourPriceHt(1.1, 90)).toBe(99);
    expect(labourPriceHt(3.2, 87.5)).toBe(280);
    expect(labourPriceHt(1.7, 72.33)).toBe(122.96);
  });
  test('taux vide ou nul → pas de prix', () => {
    expect(labourPriceHt(1.1, null)).toBeNull();
    expect(labourPriceHt(1.1, 0)).toBeNull();
    expect(labourPriceHt(null, 90)).toBeNull();
    expect(effectiveHourlyRate(0)).toBeNull();
    expect(effectiveHourlyRate(90)).toBe(90);
  });
});

describe('usage de la moto', () => {
  const plans = [{ id: 'r', usage: 'route' }, { id: 'k', usage: 'racing' }];
  test('route par défaut, sinon l’usage choisi', () => {
    expect(planForUsage(plans, null)?.id).toBe('r');
    expect(planForUsage(plans, 'racing')?.id).toBe('k');
    expect(planForUsage(plans, 'piste_amateur')).toBeNull();
  });
});
