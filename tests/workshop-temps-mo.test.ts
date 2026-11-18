/**
 * Tests M8 — Temps de main-d'oeuvre (rattrapage G8 du 18/11/2026, B11) :
 * fenetre « Gestion du temps atelier », controle du temps avant facture, quantite facturee de la MO,
 * rapprochement temps passe / facture, productivite atelier, pointeuse (code mecano, scan d'OR).
 * La facture unique d'un OR est verifiee en base : supabase/tests/m8_temps_mo.sql.
 */
import { test, expect, describe } from 'bun:test';
import {
  applyTimeWindow, invoiceQuantity, lineHours, controlRows, normalizeControlRow, controlLineHt, reconcile,
  summarizeProductivity, productivityTotal, productivitySheet, isoWeek, periodKey, mechanicBoard,
  findMechanicByCode, findOrByScan, hoursOrNull, PRODUCTIVITY_COLUMNS, type ProductivityRow,
} from '../src/modules/workshop/labour-time/rules';

describe('Gestion du temps atelier (fenetre G8 par ligne MO)', () => {
  test('heures facturees et passees gardees, virgule acceptee', () => {
    expect(applyTimeWindow({ billed: '1,5', worked: '2', internal: '', warranty: null }))
      .toEqual({ billed: 1.5, worked: 2, internal: 0, warranty: 0, billedReset: false });
  });
  test('heures internes → heures facturees remises a zero (message G8)', () => {
    const r = applyTimeWindow({ billed: 1.5, worked: 2, internal: 1, warranty: 0 });
    expect(r.billed).toBe(0);
    expect(r.billedReset).toBe(true);
    expect(r.internal).toBe(1);
  });
  test('heures garanties → heures facturees remises a zero', () => {
    expect(applyTimeWindow({ billed: 2, worked: null, internal: 0, warranty: 2 }).billed).toBe(0);
  });
  test('valeurs negatives ou invalides : 0 / vide', () => {
    expect(hoursOrNull(-3)).toBe(0);
    expect(hoursOrNull('abc')).toBeNull();
    expect(hoursOrNull('')).toBeNull();
    expect(applyTimeWindow({ billed: -1, worked: 'x', internal: 0, warranty: 0 })).toEqual({ billed: 0, worked: null, internal: 0, warranty: 0, billedReset: false });
  });
});

describe('Quantite facturee de la main-d\'oeuvre = heures facturees', () => {
  test('ligne MO avec temps saisi : heures facturees', () => {
    expect(invoiceQuantity({ kind: 'mo', quantity: 2, billed_hours: 1.5 })).toBe(1.5);
  });
  test('ligne MO sans temps saisi : la quantite de la ligne (G8 tombait a 0 €)', () => {
    expect(invoiceQuantity({ kind: 'mo', quantity: 1.25, billed_hours: null })).toBe(1.25);
  });
  test('piece : la quantite, jamais les heures', () => {
    expect(invoiceQuantity({ kind: 'piece', quantity: 3, billed_hours: 9 })).toBe(3);
  });
});

describe('Controle du temps atelier (avant facture)', () => {
  const today = '2026-11-18';
  const mo = (p: Record<string, unknown> = {}) => ({ id: 'l1', kind: 'mo', designation: 'MO_ATELIER', quantity: 1, unit_price_ht: 63.47, ...p });
  test('une seule ligne MO : le temps pointe de l\'OR devient son temps passe, le mecanicien est repris', () => {
    const rows = controlRows([mo()], [{ mechanic_key: '13', mechanic_code: '13', mechanic_name: 'Jeremy', pointed_h: 2 }], today);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ billed: 1, worked: 2, mechanic_code: '13', mechanic_name: 'Jeremy', work_date: today });
  });
  test('valeurs deja saisies : gardees telles quelles', () => {
    const rows = controlRows([mo({ billed_hours: 1.5, worked_hours: 2.5, mechanic_code: '3', mechanic_name: 'John', work_date: '2026-11-17' })],
      [{ mechanic_key: '13', mechanic_code: '13', mechanic_name: 'Jeremy', pointed_h: 4 }], today);
    expect(rows[0]).toMatchObject({ billed: 1.5, worked: 2.5, mechanic_code: '3', work_date: '2026-11-17' });
  });
  test('plusieurs lignes MO : pas de temps passe invente', () => {
    const rows = controlRows([mo(), mo({ id: 'l2' })], [{ mechanic_key: '13', mechanic_code: '13', mechanic_name: 'Jeremy', pointed_h: 3 }], today);
    expect(rows.map((r) => r.worked)).toEqual([null, null]);
  });
  test('ni les pieces ni les actions du check-up OK / reportees', () => {
    const rows = controlRows([
      mo(), { id: 'p', kind: 'piece', designation: 'Filtre', quantity: 1, unit_price_ht: 10 },
      mo({ id: 'ok', checkup_state: 'ok' }), mo({ id: 'rep', checkup_state: 'reporte' }), mo({ id: 'af', checkup_state: 'a_faire' }),
    ], [], today);
    expect(rows.map((r) => r.id)).toEqual(['l1', 'af']);
  });
  test('ligne en garantie : 0 heure facturee, ses heures sont garanties', () => {
    const rows = controlRows([mo({ quantity: 2, is_warranty: true })], [], today);
    expect(rows[0]).toMatchObject({ billed: 0, warranty: 2 });
  });
  test('montant HT de la ligne a la facture = heures facturees x PU (parcours G8 : 1,5 h x 63,47)', () => {
    expect(controlLineHt({ billed: 1.5, unit_price_ht: 63.47, discount_pct: 0, is_warranty: false })).toBe(95.21);
    expect(controlLineHt({ billed: 1.5, unit_price_ht: 63.47, discount_pct: 0, is_warranty: true })).toBe(0);
  });
  test('saisie d\'heures internes dans le controle : facturees remises a zero', () => {
    const r = normalizeControlRow({ id: 'l1', designation: 'x', unit_price_ht: 50, discount_pct: 0, is_warranty: false, mechanic_code: null, mechanic_name: null, work_date: today, billed: 2, worked: 2, internal: 2, warranty: 0 });
    expect(r.billed).toBe(0);
    expect(r.billedReset).toBe(true);
  });
});

describe('Rapprochement temps passe / temps facture (B11)', () => {
  test('parcours G8 : 1,5 h facturee pour 2 h passees → 0,5 h non facturee, 75 %', () => {
    const r = reconcile([{ billed: 1.5, worked: 2, internal: 0, warranty: 0 }], 2);
    expect(r).toEqual({ billed: 1.5, worked: 2, internal: 0, warranty: 0, pointed: 2, notBilled: 0.5, gapPointed: 0, billedPct: 75 });
  });
  test('sans heures passees saisies : le temps pointe sert de temps passe', () => {
    const r = reconcile([{ billed: 1, worked: null, internal: 0, warranty: 0 }], 1.25);
    expect(r.worked).toBe(1.25);
    expect(r.notBilled).toBe(0.25);
  });
  test('heures internes et garanties ne sont pas du temps non facture', () => {
    const r = reconcile([{ billed: 1, worked: 3, internal: 1, warranty: 1 }], 0);
    expect(r.notBilled).toBe(0);
    expect(r.gapPointed).toBe(3);
  });
  test('plus facture que passe : non facture a 0, pourcentage > 100', () => {
    const r = reconcile([{ billed: 3, worked: 2, internal: 0, warranty: 0 }], 2);
    expect(r.notBilled).toBe(0);
    expect(r.billedPct).toBe(150);
  });
  test('rien de passe : pas de pourcentage', () => {
    expect(reconcile([{ billed: 1, worked: null, internal: 0, warranty: 0 }], 0).billedPct).toBeNull();
  });
});

describe('Ventilation d\'une ligne MO pour la productivite', () => {
  test('OR facture : facture ; OR ouvert : a facturer ; OR annule : rien', () => {
    expect(lineHours({ kind: 'mo', quantity: 1.5 }, 'facture')).toMatchObject({ billed: 1.5, toBill: 0 });
    expect(lineHours({ kind: 'mo', quantity: 1.5 }, 'en_cours')).toMatchObject({ billed: 0, toBill: 1.5 });
    expect(lineHours({ kind: 'mo', quantity: 1.5 }, 'annule')).toEqual({ billed: 0, toBill: 0, internal: 0, warranty: 0, worked: 0 });
  });
  test('ligne garantie : heures garanties, rien de facture', () => {
    expect(lineHours({ kind: 'mo', quantity: 2, is_warranty: true }, 'facture')).toMatchObject({ billed: 0, warranty: 2 });
  });
});

describe('Productivite atelier', () => {
  const row = (p: Partial<ProductivityRow>): ProductivityRow => ({
    day: '2026-11-18', mechanic_key: '13', mechanic_name: 'Jeremy', presence_h: 0, pointed_h: 0, improductive_h: 0,
    billed_h: 0, to_bill_h: 0, internal_h: 0, warranty_h: 0, line_worked_h: 0, ...p,
  });
  const rows: ProductivityRow[] = [
    row({ presence_h: 8, pointed_h: 6, improductive_h: 1, billed_h: 4, to_bill_h: 1 }),
    row({ day: '2026-11-19', presence_h: 8, pointed_h: 7, billed_h: 5, internal_h: 1, warranty_h: 0.5 }),
    row({ mechanic_key: '3', mechanic_name: 'John', presence_h: 7, line_worked_h: 5, billed_h: 5 }), // ne pointe pas : heures passees saisies
    row({ mechanic_key: '', mechanic_name: '', billed_h: 1 }), // ligne MO sans mecanicien
  ];
  const sum = summarizeProductivity(rows, { by: 'mechanic', includeToBill: false, unassignedLabel: 'Non pointé' });
  const jeremy = sum.find((s) => s.mechanicKey === '13')!;
  const john = sum.find((s) => s.mechanicKey === '3')!;
  test('par mecanicien : presence, passe, facture, a facturer, non facture', () => {
    expect(jeremy).toMatchObject({ presence: 16, worked: 13, billed: 9, toBill: 1, internal: 1, warranty: 0.5, improductive: 1, notBilled: 1.5 });
  });
  test('ratios : % facture, rendement production, rendement atelier, % improductif', () => {
    expect(jeremy.billedPct).toBe(69.23);       // 9 / 13
    expect(jeremy.productionPct).toBe(80.77);   // (9 + 1 + 0,5) / 13
    expect(jeremy.efficiencyPct).toBe(92.86);   // 13 / (13 + 1)
    expect(jeremy.improductivePct).toBe(6.25);  // 1 / 16
  });
  test('inclure le temps a facturer (case G8)', () => {
    const j = summarizeProductivity(rows, { by: 'mechanic', includeToBill: true, unassignedLabel: '-' }).find((s) => s.mechanicKey === '13')!;
    expect(j.billedPct).toBe(76.92); // (9 + 1) / 13
  });
  test('mecanicien qui ne pointe pas : ses heures passees saisies font son temps passe', () => {
    expect(john.worked).toBe(5);
    expect(john.billedPct).toBe(100);
  });
  test('ligne MO sans mecanicien : « Non pointé »', () => {
    expect(sum.find((s) => s.mechanicKey === '')?.label).toBe('Non pointé');
  });
  test('par jour, par semaine ISO, par mois', () => {
    const byDay = summarizeProductivity(rows, { by: 'day', includeToBill: false, unassignedLabel: '-' });
    expect(byDay.map((d) => d.period)).toEqual(['2026-11-18', '2026-11-19']);
    expect(byDay[0].worked).toBe(11); // Jeremy 6 pointe + John 5 saisi
    const byWeek = summarizeProductivity(rows, { by: 'week', includeToBill: false, unassignedLabel: '-' });
    expect(byWeek.map((w) => w.period)).toEqual(['2026-S47']);
    expect(summarizeProductivity(rows, { by: 'month', includeToBill: false, unassignedLabel: '-' })[0].period).toBe('2026-11');
  });
  test('detail par journee et par mecanicien', () => {
    const d = summarizeProductivity(rows, { by: 'mechanic_day', includeToBill: false, unassignedLabel: '-' });
    expect(d.filter((x) => x.mechanicKey === '13').map((x) => x.period)).toEqual(['2026-11-18', '2026-11-19']);
  });
  test('total : somme des mecaniciens, ratios sur les sommes', () => {
    const tot = productivityTotal(rows, false, 'Total');
    expect(tot).toMatchObject({ presence: 23, worked: 18, billed: 15, improductive: 1 });
    expect(tot.billedPct).toBe(83.33);
  });
  test('grille Excel : en-tete, une ligne par mecanicien, total', () => {
    const cols = Object.fromEntries(PRODUCTIVITY_COLUMNS.map((c) => [c, c])) as Record<(typeof PRODUCTIVITY_COLUMNS)[number], string>;
    const g = productivitySheet(sum, productivityTotal(rows, false, 'Total'), { label: 'Mécanicien', columns: cols });
    expect(g[0][0]).toBe('Mécanicien');
    expect(g[0]).toHaveLength(1 + PRODUCTIVITY_COLUMNS.length);
    expect(g).toHaveLength(1 + sum.length + 1);
    expect(g[g.length - 1][0]).toBe('Total');
  });
  test('semaine ISO', () => {
    expect(isoWeek('2026-11-18')).toBe('2026-S47');
    expect(isoWeek('2027-01-01')).toBe('2026-S53');
    expect(isoWeek('2026-01-01')).toBe('2026-S01');
    expect(periodKey('2026-11-18', 'mechanic')).toBeNull();
  });
});

describe('Pointeuse', () => {
  const mechanics = [{ code: '13', name: 'Jeremy' }, { code: '3', name: 'John' }, { code: 'LIV17', name: 'Livio' }];
  test('scan du code mecano (espaces, casse)', () => {
    expect(findMechanicByCode(mechanics, ' 13 ')?.name).toBe('Jeremy');
    expect(findMechanicByCode(mechanics, 'liv17')?.name).toBe('Livio');
    expect(findMechanicByCode(mechanics, '99')).toBeNull();
  });
  test('scan du n° d\'OR : complet, compteur seul, ambigu', () => {
    const ors = [{ number: 'OR-2026-00012' }, { number: 'OR-2026-00112' }];
    expect(findOrByScan(ors, 'or-2026-00012')?.number).toBe('OR-2026-00012');
    expect(findOrByScan(ors, '12')?.number).toBe('OR-2026-00012');
    expect(findOrByScan(ors, '112')?.number).toBe('OR-2026-00112');
    expect(findOrByScan(ors, '202600112')?.number).toBe('OR-2026-00112');
    expect(findOrByScan([{ number: 'OR-2025-00012' }, { number: 'OR-2026-00012' }], '12')).toBeNull();
  });
  test('tableau atelier : present depuis, travail ou tache en cours', () => {
    const board = mechanicBoard([
      { id: 'a', kind: 'presence', mechanic_code: '13', started_at: '2026-11-18T07:30:00Z' },
      { id: 'b', kind: 'travail', mechanic_code: '13', or_id: 'or1', started_at: '2026-11-18T08:00:00Z', ended_at: '2026-11-18T09:00:00Z' },
      { id: 'c', kind: 'improductif', mechanic_code: '13', task_code: 'nettoyage_atelier', started_at: '2026-11-18T09:00:00Z' },
      { id: 'd', kind: 'presence', mechanic_name: 'Ancien poste', started_at: '2026-11-18T08:00:00Z' },
    ], mechanics);
    const j = board.find((m) => m.code === '13')!;
    expect(j.presentSince).toBe('2026-11-18T07:30:00Z');
    expect(j.current).toEqual({ kind: 'improductif', orId: null, taskCode: 'nettoyage_atelier', since: '2026-11-18T09:00:00Z' });
    expect(board.find((m) => m.code === '3')?.presentSince).toBeNull();
    expect(board.find((m) => m.key === 'Ancien poste')?.presentSince).toBe('2026-11-18T08:00:00Z');
  });
});
