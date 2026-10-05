/**
 * Mission 07 — carte 4 « Prochain entretien de chaque moto » et carte 6 (devis estimé).
 * Règles pures de src/modules/workshop/maintenance-due.ts.
 *
 * Les cas de référence sont tirés des VRAIS programmes des manuels d'atelier
 * chargés en production (mesurés le 05/10) :
 *  - DESERTX 2023 : Oil Service 15 000 km (17 UT), Desmo Service 30 000 km, Annual Service 12 mois (5 UT)
 *  - DESERTX V2 2027 : Oil Service 1000 (1 000 km / 6 mois, 10 UT), Oil Service (15 000 km / 24 mois, 13 UT),
 *                      Valve Check 45 000 km (30 UT)
 *  - MONSTER 2021 : grille kilométrique reconstruite — jalons 1 000 / 15 000 / 30 000 / 45 000 / 60 000 km
 *
 * Ces mêmes cas sont la référence des vues SQL `maintenance_vehicle_due` /
 * `maintenance_vehicle_next` (migration 20261005110000), qui tiennent la même règle.
 */
import { describe, expect, test } from 'bun:test';
import {
  dueForService, dueServices, nextDueService, estimateService,
  utToMinutes, utToHours, dueSeverity, fmtKm, fmtEur, fmtDate, fmtMinutes,
  type ProgramService,
} from '../src/modules/workshop/maintenance-due';

// --- programmes réels ------------------------------------------------------
const OIL: ProgramService = { code: 'oil_service', label: 'Oil Service', family: 'oil', isGrid: false, isFirst: false, intervalKm: 15000, intervalMonths: null, ut: 17, sort: 1 };
const DESMO: ProgramService = { code: 'desmo_service', label: 'Desmo Service', family: 'desmo', isGrid: false, isFirst: false, intervalKm: 30000, intervalMonths: null, ut: null, sort: 2 };
const ANNUAL: ProgramService = { code: 'annual_service', label: 'Annual Service', family: 'annual', isGrid: false, isFirst: false, intervalKm: null, intervalMonths: 12, ut: 5, sort: 3 };
const FIRST: ProgramService = { code: 'oil_service_1000', label: 'Oil Service 1000', family: 'premier_1000', isGrid: false, isFirst: true, intervalKm: 1000, intervalMonths: 6, ut: 10, sort: 0 };
// DESERTX V2 2027 : Oil Service avec DEUX bornes (15 000 km OU 24 mois)
const OIL_V2: ProgramService = { code: 'oil_service', label: 'Oil Service', family: 'oil', isGrid: false, isFirst: false, intervalKm: 15000, intervalMonths: 24, ut: 13, sort: 1 };
// MONSTER 2021 : grille kilométrique (jalons absolus au compteur)
const grid = (km: number): ProgramService => ({
  code: `${km}_km`, label: `${km} km`, family: `${km} km`, isGrid: true, isFirst: km === 1000,
  intervalKm: km, intervalMonths: null, ut: null, sort: km / 1000,
});

const TODAY = '2026-10-05';

describe('premier atteint (décision M-16)', () => {
  test('le km arrive avant la date : l’échéance est kilométrique', () => {
    // dernier Oil Service connu à 10 000 km il y a 6 mois, 60 km/jour → 15 000 km bien avant 24 mois
    const r = dueForService(OIL_V2, { km: 20900, date: TODAY }, { km: 10000, date: '2026-04-08' });
    expect(r.confidence).toBe('exact');
    expect(r.dueKm).toBe(25000);           // 10 000 + 15 000
    expect(r.dueDate).toBe('2028-04-08');  // 10 000 km + 24 mois
    expect(r.reached).toBe(false);
    expect(r.firstTrigger).toBe('km');     // le km tombe en premier
  });

  test('la date arrive avant le km : l’échéance est calendaire', () => {
    // dernier Oil Service à 10 000 km il y a 23 mois, très peu roulé
    const r = dueForService(OIL_V2, { km: 11200, date: TODAY }, { km: 10000, date: '2024-11-05' });
    expect(r.dueKm).toBe(25000);
    expect(r.dueDate).toBe('2026-11-05');
    expect(r.reached).toBe(false);
    expect(r.firstTrigger).toBe('mois');
    expect(r.daysLeft).toBe(31);
  });

  test('atteinte par le km : retard réel, reachedBy = km', () => {
    const r = dueForService(OIL, { km: 26000, date: TODAY }, { km: 10000, date: '2025-05-05' });
    expect(r.dueKm).toBe(25000);
    expect(r.reached).toBe(true);
    expect(r.reachedBy).toBe('km');
    expect(r.firstTrigger).toBe('km');
    expect(r.daysLeft).toBe(0);
  });

  test('atteinte par les mois : retard réel, reachedBy = mois', () => {
    const r = dueForService(ANNUAL, { km: 12000, date: TODAY }, { km: 10000, date: '2025-09-01' });
    expect(r.dueDate).toBe('2026-09-01');
    expect(r.reached).toBe(true);
    expect(r.reachedBy).toBe('mois');
  });

  test('fin de mois : + 1 mois depuis le 31 janvier tombe le 28 février', () => {
    const r = dueForService(
      { ...ANNUAL, intervalMonths: 1 }, { km: 0, date: '2026-02-20' }, { km: 0, date: '2026-01-31' },
    );
    expect(r.dueDate).toBe('2026-02-28');
  });
});

describe('sans historique : une estimation, jamais un retard', () => {
  test('moto de 2007 à 24 538 km : l’Oil Service des 15 000 km n’est pas réclamé', () => {
    // cas réel mesuré en production (1098, mise en service 2007-04-25)
    const r = dueForService(OIL, { km: 24538, date: TODAY }, null, { date: '2007-04-25' });
    expect(r.confidence).toBe('estime');
    expect(r.dueKm).toBe(30000);   // la prochaine occurrence AU-DESSUS du compteur
    expect(r.reached).toBe(false); // on ne crie jamais au retard sur une estimation
  });

  test('l’entretien annuel est reporté à la prochaine occurrence à venir', () => {
    const r = dueForService(ANNUAL, { km: 24538, date: TODAY }, null, { date: '2007-04-25' });
    expect(r.confidence).toBe('estime');
    expect(r.dueDate).toBe('2027-04-25');  // et non 2008-04-25
    expect(r.reached).toBe(false);
    expect(r.daysLeft).toBe(202);
  });

  test('moto neuve sans historique : la première occurrence part de 0 km', () => {
    const r = dueForService(OIL, { km: 300, date: TODAY }, null, { date: '2026-09-01' });
    expect(r.dueKm).toBe(15000);
    expect(r.confidence).toBe('estime');
  });

  test('le premier entretien reste dû tant que le jalon n’est pas dépassé', () => {
    const r = dueForService(FIRST, { km: 800, date: TODAY }, null, { date: '2026-04-01' });
    expect(r.settled).toBe(false);
    expect(r.dueKm).toBe(1000);
    expect(r.dueDate).toBe('2026-10-01');  // 6 mois après la mise en service
    expect(r.reached).toBe(true);          // la date est dépassée
    expect(r.reachedBy).toBe('mois');
  });

  test('le premier entretien est réputé fait quand le jalon est largement dépassé', () => {
    const r = dueForService(FIRST, { km: 24538, date: TODAY }, null, { date: '2007-04-25' });
    expect(r.settled).toBe(true);
  });

  test('le premier entretien ne revient jamais une fois enregistré', () => {
    const r = dueForService(FIRST, { km: 5000, date: TODAY }, { km: 1050, date: '2026-01-10' });
    expect(r.settled).toBe(true);
  });
});

describe('rythme de roulage', () => {
  test('roulage rapide : le km est atteint avant la date', () => {
    // 12 000 km en 365 jours ≈ 32,88 km/jour ; il reste 3 000 km → ~92 jours
    const r = dueForService(OIL_V2, { km: 12000, date: TODAY }, { km: 0, date: '2025-10-05' });
    expect(r.kmPerDay).toBe(32.88);
    expect(r.dueKm).toBe(15000);
    expect(r.kmReachedOn).toBe('2027-01-05');   // 3 000 km / 32,88 → 92 jours
    expect(r.firstTrigger).toBe('km');
  });

  test('roulage lent : la date tombe avant le km', () => {
    // 1 500 km en 365 jours ≈ 4,11 km/jour ; 13 500 km restants → plus de 8 ans
    const r = dueForService(OIL_V2, { km: 1500, date: TODAY }, { km: 0, date: '2025-10-05' });
    expect(r.kmPerDay).toBe(4.11);
    expect(r.dueDate).toBe('2027-10-05');
    expect(r.firstTrigger).toBe('mois');
    expect(r.daysLeft).toBe(365);
  });

  test('rythme inconnu (aucun km parcouru depuis le départ) : pas de projection', () => {
    const r = dueForService(OIL, { km: 10000, date: TODAY }, { km: 10000, date: '2025-10-05' });
    expect(r.kmPerDay).toBeNull();
    expect(r.kmReachedOn).toBeNull();
  });

  test('kilométrage inconnu : pas de rythme, mais l’échéance en mois reste calculable', () => {
    const r = dueForService(ANNUAL, { km: null, date: TODAY }, { km: null, date: '2026-03-01' });
    expect(r.kmPerDay).toBeNull();
    expect(r.dueDate).toBe('2027-03-01');
    expect(r.reached).toBe(false);
  });

  test('le rythme se mesure depuis la mise en service quand il n’y a pas d’historique', () => {
    // cas réel : 1098 de 2007 à 24 538 km → ~3,45 km/jour
    const r = dueForService(OIL, { km: 24538, date: TODAY }, null, { date: '2007-04-25' });
    expect(r.kmPerDay).toBeCloseTo(3.45, 2);
  });
});

describe('grille kilométrique reconstruite (MONSTER 2021, M-30)', () => {
  const program = [grid(1000), grid(15000), grid(30000), grid(45000), grid(60000)];

  test('seul le prochain jalon est annoncé : les jalons passés sont réputés faits', () => {
    const list = dueServices(program, { km: 32000, date: TODAY }, null, { date: '2021-06-01' });
    expect(list.map((d) => d.service.code)).toEqual(['45000_km', '60000_km']);
    expect(list[0].dueKm).toBe(45000);
    expect(list[0].confidence).toBe('estime');
  });

  test('un jalon enregistré comme fait ne revient pas', () => {
    const last = { '30000 km': { km: 30100, date: '2025-04-01' } };
    const list = dueServices(program, { km: 32000, date: TODAY }, last, { date: '2021-06-01' });
    expect(list.map((d) => d.service.code)).not.toContain('30000_km');
  });

  test('moto neuve : le jalon des 1 000 km est le prochain', () => {
    const list = dueServices(program, { km: 400, date: TODAY }, null, { date: '2026-08-01' });
    expect(list[0].service.code).toBe('1000_km');
    expect(list[0].dueKm).toBe(1000);
  });
});

describe('l’entretien dû : le plus urgent d’abord', () => {
  const program = [FIRST, OIL, DESMO, ANNUAL];

  test('un retard réel passe devant tout', () => {
    const last = {
      oil: { km: 10000, date: '2025-05-05' },      // dû à 25 000 km, compteur 26 000 → retard
      annual: { km: 10000, date: '2026-06-01' },   // dû le 01/06/2027
    };
    const d = nextDueService(program, { km: 26000, date: TODAY }, last, { date: '2024-03-01' });
    expect(d?.service.code).toBe('oil_service');
    expect(d?.reached).toBe(true);
    expect(d?.confidence).toBe('exact');
  });

  test('sans retard, c’est l’échéance la plus proche qui sort', () => {
    const d = nextDueService(program, { km: 24538, date: TODAY }, null, { date: '2007-04-25' });
    expect(d?.service.code).toBe('annual_service');   // 202 jours, contre des milliers de km
    expect(d?.daysLeft).toBe(202);
  });

  test('aucune échéance calculable : rien plutôt qu’une invention', () => {
    const vide: ProgramService[] = [{ ...OIL, intervalKm: null, intervalMonths: null }];
    expect(nextDueService(vide, { km: 1000, date: TODAY }, null, { date: '2020-01-01' })).toBeNull();
  });

  test('sans mise en service ni historique, une échéance en mois seule n’est pas datable', () => {
    const d = dueServices([ANNUAL], { km: 5000, date: TODAY }, null, null);
    expect(d).toHaveLength(0);
  });
});

describe('devis estimé (carte 6) — 1 UT = 6 minutes, M-33', () => {
  test('temps officiel → minutes et heures', () => {
    expect(utToMinutes(17)).toBe(102);          // Oil Service DESERTX 2023
    expect(utToHours(17)).toBe(1.7);
    expect(utToMinutes(5)).toBe(30);            // Annual Service
    expect(utToHours(5)).toBe(0.5);
    expect(utToMinutes(30)).toBe(180);          // Valve Check DESERTX V2 2027
    expect(utToMinutes(null)).toBeNull();
    expect(utToMinutes(0)).toBeNull();
  });

  test('main-d’œuvre = heures × taux horaire HT (90 € HT, M-20)', () => {
    const e = estimateService(17, 90, []);
    expect(e.hours).toBe(1.7);
    expect(e.labourHt).toBe(153);               // 1,7 h × 90 €
    expect(e.totalHt).toBe(153);
    expect(e.complete).toBe(false);             // aucune pièce : l’estimation reste partielle
  });

  test('cas mesuré en production : DESERTX 2025 Annual Service, 5 UT à 90 € HT', () => {
    const e = estimateService(5, 90, []);
    expect(e.minutes).toBe(30);
    expect(e.labourHt).toBe(45);
  });

  test('pièces du kit : main-d’œuvre + pièces', () => {
    const e = estimateService(17, 90, [
      { designation: 'Filtre à huile', quantity: 1, unitPriceHt: 24.5 },
      { designation: 'Bouchon de vidange', quantity: 1, unitPriceHt: 6.2 },
      { designation: 'Huile moteur', quantity: 3.8, unitPriceHt: 18 },
    ]);
    expect(e.partsHt).toBe(99.1);               // 24,50 + 6,20 + 68,40
    expect(e.labourHt).toBe(153);
    expect(e.totalHt).toBe(252.1);
    expect(e.partsWithoutPrice).toBe(0);
    expect(e.complete).toBe(true);
  });

  test('une pièce sans prix compte pour 0 € et est signalée : pas de total faux', () => {
    const e = estimateService(17, 90, [
      { designation: 'Filtre à huile', quantity: 1, unitPriceHt: 24.5 },
      { designation: 'Huile moteur', quantity: 3.8, unitPriceHt: null },
    ]);
    expect(e.partsHt).toBe(24.5);
    expect(e.partsWithoutPrice).toBe(1);
    expect(e.complete).toBe(false);
  });

  test('taux horaire non saisi : pas de main-d’œuvre inventée', () => {
    const e = estimateService(17, null, []);
    expect(e.labourHt).toBeNull();
    expect(e.complete).toBe(false);
    const z = estimateService(17, 0, []);
    expect(z.hourlyRateHt).toBeNull();
    expect(z.labourHt).toBeNull();
  });

  test('temps officiel absent : pas de main-d’œuvre, mais les pièces restent chiffrées', () => {
    const e = estimateService(null, 90, [{ designation: 'Filtre à huile', quantity: 2, unitPriceHt: 24.5 }]);
    expect(e.minutes).toBeNull();
    expect(e.labourHt).toBeNull();
    expect(e.partsHt).toBe(49);
    expect(e.totalHt).toBe(49);
    expect(e.complete).toBe(false);
  });
});

describe('urgence et libellés', () => {
  test('un retard réel est « retard » ; une estimation dépassée ne l’est pas', () => {
    expect(dueSeverity({ reached: true, confidence: 'exact', daysLeft: 0 })).toBe('retard');
    expect(dueSeverity({ reached: true, confidence: 'estime', daysLeft: 0 })).toBe('imminent');
    expect(dueSeverity({ reached: false, confidence: 'exact', daysLeft: 20 })).toBe('imminent');
    expect(dueSeverity({ reached: false, confidence: 'estime', daysLeft: 60 })).toBe('bientot');
    expect(dueSeverity({ reached: false, confidence: 'estime', daysLeft: 400 })).toBe('calme');
    expect(dueSeverity({ reached: false, confidence: 'estime', daysLeft: null })).toBe('calme');
  });

  test('formats fr-BE', () => {
    expect(fmtKm(15000).replace(/ | /g, ' ')).toBe('15 000 km');
    expect(fmtEur(252.1).replace(/ | /g, ' ')).toContain('252,10');
    expect(fmtDate('2027-04-25')).toBe('25/04/2027');
    expect(fmtMinutes(102)).toBe('1 h 42');
    expect(fmtMinutes(30)).toBe('30 min');
    expect(fmtMinutes(120)).toBe('2 h');
    expect(fmtMinutes(null)).toBe('');
  });
});
