/**
 * Mission 07, cartes 4 et 5 — prochain entretien de chaque moto (src/modules/workshop/maintenance-due.ts) :
 * regle Ducati (+12 mois, premier entretien +6 mois / 1 000 km, premier atteint), detection d'un
 * entretien dans un libelle de facture (libelles reels G8, dont des negatifs), parseur de l'extract
 * DCS (feuille Export, dates en serie Excel, ligne « Applied filters » ignoree), dedoublonnage.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  addMonthsIso, daysBetween, isServiceLabel, dcsKind, excelSerialToIso, normalizeVin, parseDcsRows, dedupeDcsRows,
  nextFromLastService, firstServiceDue, plannedDue, dueFromDcs, dueStatus, pickLastService,
} from '../src/modules/workshop/maintenance-due';
import { parseDcsArrayBuffer } from '../src/modules/workshop/maintenance-due-api';

describe('regle Ducati : +12 mois, premier entretien +6 mois ou 1 000 km', () => {
  test('prochain entretien = dernier entretien + 12 mois', () => {
    const r = nextFromLastService({ date: '2025-05-14', km: 12000 }, 15000);
    expect(r.kind).toBe('annual');
    expect(r.dueDate).toBe('2026-05-14');
    expect(r.dueKm).toBe(27000);
  });
  test('sans intervalle km connu, pas de km invente', () => {
    expect(nextFromLastService({ date: '2025-05-14', km: 12000 }).dueKm).toBeNull();
    expect(nextFromLastService({ date: '2025-05-14', km: null }, 15000).dueKm).toBeNull();
  });
  test('premier entretien = debut de garantie + 6 mois ou 1 000 km', () => {
    const r = firstServiceDue('2026-10-23');
    expect(r).toEqual({ kind: 'first_1000', dueDate: '2027-04-23', dueKm: 1000 });
  });
  test('fin de mois : 31 aout + 6 mois = 28 fevrier', () => {
    expect(addMonthsIso('2025-08-31', 6)).toBe('2026-02-28');
    expect(addMonthsIso('2024-02-29', 12)).toBe('2025-02-28');
  });
  test('extract DCS : la date planifiee est l echeance, le dernier entretien s en deduit', () => {
    const annual = dueFromDcs({ plannedDate: '2026-05-15', maintenanceType: 'Annual Service' });
    expect(annual.kind).toBe('annual');
    expect(annual.dueDate).toBe('2026-05-15');
    expect(annual.lastServiceAt).toBe('2025-05-15');
    const first = dueFromDcs({ plannedDate: '2027-04-21', maintenanceType: 'Oil Service 1000km/600mi' });
    expect(first.kind).toBe('first_1000');
    expect(first.dueKm).toBe(1000);
    expect(first.lastServiceAt).toBe('2026-10-21');
    expect(dcsKind('Oil Service')).toBe('oil');
    expect(dcsKind(null)).toBe('annual');
  });
  test('plan seul : 6 mois puis tous les 12 mois, fenetre de retard de 180 jours', () => {
    // moto mise en circulation le 02/06/2026, aujourd hui 29/10/2026 : premier entretien le 02/12/2026
    expect(plannedDue('2026-06-02', '2026-10-29')).toEqual({ kind: 'first_1000', dueDate: '2026-12-02', dueKm: 1000 });
    // premier entretien depasse de moins de 180 j : toujours propose
    expect(plannedDue('2026-01-10', '2026-10-29').dueDate).toBe('2026-07-10');
    // vieille moto : la prochaine annuelle du calendrier (18 mois, 30 mois, ...) qui n est pas plus vieille que 180 j
    const old = plannedDue('2019-03-15', '2026-10-29');
    expect(old.kind).toBe('annual');
    expect(old.dueDate).toBe('2026-09-15');
    expect(daysBetween(old.dueDate!, '2026-10-29')).toBeLessThanOrEqual(180);
  });
});

describe('echeance au premier atteint (M-16)', () => {
  test('date depassee → depasse de n jours', () => {
    const s = dueStatus({ dueDate: '2026-05-14', dueKm: null }, { date: '2026-10-30', km: 5000 });
    expect(s.daysLeft).toBe(-169);
    expect(s.reached).toBe(true);
    expect(s.reachedBy).toBe('mois');
  });
  test('km atteint avant la date → atteint par le km', () => {
    const s = dueStatus({ dueDate: '2027-05-14', dueKm: 27000 }, { date: '2026-10-30', km: 27500 });
    expect(s.reached).toBe(true);
    expect(s.reachedBy).toBe('km');
    expect(s.kmLeft).toBe(-500);
  });
  test('ni l un ni l autre → jours et km restants', () => {
    const s = dueStatus({ dueDate: '2026-11-29', dueKm: 27000 }, { date: '2026-10-30', km: 20000 });
    expect(s.reached).toBe(false);
    expect(s.daysLeft).toBe(30);
    expect(s.kmLeft).toBe(7000);
  });
  test('le dernier entretien le plus recent gagne ; a date egale, l ordre de confiance', () => {
    const w = pickLastService([
      { source: 'invoice_g8', date: '2024-11-10' },
      { source: 'client', date: '2026-09-01', km: 12000 },
      { source: 'dcs_extract', date: '2025-05-14' },
    ]);
    expect(w?.source).toBe('client');
    const tie = pickLastService([{ source: 'client', date: '2025-05-14' }, { source: 'or_dms', date: '2025-05-14' }]);
    expect(tie?.source).toBe('or_dms');
    expect(pickLastService([])).toBeNull();
  });
});

describe('un entretien dans un libelle de facture (libelles reels G8)', () => {
  const yes = ['VIDANGE', 'ENTRETIEN SF V2 *002843', 'RODAGE 1000 KM', 'Oil Service', 'Annual Service',
    'ENTRETIEN 15000 KM', 'REVISION 30.000 KM', 'Forfait entretien annuel', 'MAIN D OEUVRE DESMO SERVICE'];
  const no = ['BOUCHON VIDANGE HUILE', 'KIT DE REVISION DE PIVOTS', 'SERVICE BOOKLET IT/GB/DE/ES/PT/FR/NL/GR',
    'T-SHIRT DESMO M', 'PLAQUETTES DE FREIN AV', 'PNEU PIRELLI DIABLO ROSSO IV 180/55', 'MANUEL D\'UTILISATION ET ENTRETIEN',
    'SERVICE 6 TASSES _ CAPPUCCINO', 'VIS POUR VIDANGE ETRIER', 'HUILE SHELL ADVANCE 15W50 1L', 'BOT. PUMA DESMO V2 NO/RO 46',
    'DESMOSEDICI GP MECCANO', 'FILTRE A HUILE', ''];
  for (const l of yes) test(`oui : ${l}`, () => expect(isServiceLabel(l)).toBe(true));
  for (const l of no) test(`non : ${l || '(vide)'}`, () => expect(isServiceLabel(l)).toBe(false));
  test('null → non', () => expect(isServiceLabel(null)).toBe(false));
});

describe('extract DCS : parseur de la feuille Export', () => {
  const header = ['VIN', 'Warranty Start Date', 'WA Dealer', 'WA Dealer Country', 'Maintenance Planned Date', 'Maintenance Type', 'Day(s) Before Maintenance'];
  const aoa: unknown[][] = [
    header,
    ['ZDM3F02BGPB005025', 44974, '0000100645 - ITALBIKE STORE', 'BELGIUM', 46156, 'Oil Service', -168],
    ['zdm1m00aanb003922', 44628, '0000100645 - ITALBIKE STORE', 'BELGIUM', 46157, 'Annual Service', -167],
    ['ZDM5000AAVB004031', 46323, '0000100645 - ITALBIKE STORE', 'BELGIUM', 46503, 'Oil Service 1000km/600mi', 179],
    ['ZDM3F02BGPB005025', 44974, '0000100645 - ITALBIKE STORE', 'BELGIUM', 46156, 'Oil Service', -168],
    ['ABC', '', '', '', 46200, 'Annual Service', 10],
    ['ZDM1D02BGMB000956', 44267, '', '', '', 'Oil Service', -144],
    [],
    ['Applied filters:\nFLAG_6_MONTHS is 1\nBIKE_STATUS_DES is Active (Bike in Use) or Used for Racing'],
  ];

  test('serie Excel → date', () => {
    expect(excelSerialToIso(45658)).toBe('2025-01-01');
    expect(excelSerialToIso(45659)).toBe('2025-01-02');
    expect(excelSerialToIso(46156)).toBe('2026-05-14');
    expect(excelSerialToIso('46156')).toBe('2026-05-14');
    expect(excelSerialToIso('14/05/2026')).toBe('2026-05-14');
    expect(excelSerialToIso('2026-05-14')).toBe('2026-05-14');
    expect(excelSerialToIso('')).toBeNull();
    expect(excelSerialToIso(12)).toBeNull();
  });

  test('lignes lues, VIN normalises, lignes ignorees avec motif', () => {
    const p = parseDcsRows(aoa);
    expect(p.header).toBe(0);
    expect(p.rows.map((r) => r.vin)).toEqual(['ZDM3F02BGPB005025', 'ZDM1M00AANB003922', 'ZDM5000AAVB004031', 'ZDM3F02BGPB005025']);
    expect(p.rows[0]).toEqual({
      row: 2, vin: 'ZDM3F02BGPB005025', warrantyStart: '2023-02-17', plannedDate: '2026-05-14',
      maintenanceType: 'Oil Service', daysBefore: -168, dealer: '0000100645 - ITALBIKE STORE',
    });
    expect(p.rows[1].row).toBe(3);
    expect(p.ignored.map((i) => i.reason).sort()).toEqual(['filters', 'planned_date', 'vin_length']);
  });

  test('pas d en-tete → rien', () => {
    expect(parseDcsRows([['a', 'b'], ['c', 'd']]).rows).toEqual([]);
    expect(parseDcsRows([]).ignored[0].reason).toBe('no_header');
  });

  test('dedoublonnage : meme VIN + date + type une seule fois', () => {
    const { kept, duplicates } = dedupeDcsRows(parseDcsRows(aoa).rows);
    expect(kept).toHaveLength(3);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].row).toBe(5);
    // le type compare sans la casse ni les espaces
    const d2 = dedupeDcsRows([
      { vin: 'A', plannedDate: '2026-01-01', maintenanceType: 'Annual Service' },
      { vin: 'A', plannedDate: '2026-01-01', maintenanceType: ' annual service ' },
      { vin: 'A', plannedDate: '2026-01-02', maintenanceType: 'Annual Service' },
    ]);
    expect(d2.kept).toHaveLength(2);
  });

  test('normalisation du VIN', () => {
    expect(normalizeVin(' zdm3f02b-gpb005025 ')).toBe('ZDM3F02BGPB005025');
  });

  test('un petit classeur xlsx en memoire se lit comme le vrai fichier', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa.slice(0, 4));
    XLSX.utils.book_append_sheet(wb, ws, 'Export');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const p = await parseDcsArrayBuffer(buf);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0].plannedDate).toBe('2026-05-14');
    expect(p.rows[2].maintenanceType).toBe('Oil Service 1000km/600mi');
  });
});
