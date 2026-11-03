/**
 * M3 — Registre des vehicules a moteur (AR n° 1 art. 28, circulaire 2018/C/47), VEH010.
 * Regles pures de src/modules/vehicles/register.ts, miroir de la migration 20261103190000 :
 * numerotation continue par annee, entree a l'ouverture d'un OR, sortie a la facturation,
 * date limite = fin du mois suivant, append-only (rectification), reprise d'historique idempotente.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  registerDueBy, registerNumber, nextSeq, registerEntry, applyExit, rectifyLine, registerState, orEntryNature,
  backfillPlan, applyBackfill, buildRegisterCsv, REGISTER_CSV_HEADER, normalizeVin, isInStock, type RegisterLine, type BackfillEvent,
} from '../src/modules/vehicles/register';

const base = (over: Partial<RegisterLine> = {}): RegisterLine => ({
  id: 'l1', year: 2026, seq: 1, entered_at: '2026-03-02', vehicle_id: 'v1', vin: 'ZDMAA00AAXB000001', plate: '1-ABC-123',
  contact_id: 'c1', principal_vat: null, nature_code: '1', source: 'or', source_id: 'or1', left_at: null,
  invoice_document_id: null, invoice_ref: null, no_document_reason: null, invoice_due_by: null, is_backfill: false,
  is_void: false, rectifies_id: null, rectified_by_id: null, note: null, ...over,
});

describe('numero d\'ordre continu par annee (art. 28 : au moins 4 positions, 0001 → 9999)', () => {
  test('affichage AAAA-0001', () => {
    expect(registerNumber(2026, 1)).toBe('2026-0001');
    expect(registerNumber(2026, 123)).toBe('2026-0123');
    expect(registerNumber(2027, 10000)).toBe('2027-10000');
  });
  test('le numero suit sans trou et repart a 1 chaque annee', () => {
    const lines = [base({ year: 2026, seq: 1 }), base({ id: 'l2', year: 2026, seq: 2 }), base({ id: 'l3', year: 2025, seq: 40 })];
    expect(nextSeq(lines, 2026)).toBe(3);
    expect(nextSeq(lines, 2025)).toBe(41);
    expect(nextSeq(lines, 2027)).toBe(1);
    expect(nextSeq([], 2026)).toBe(1);
  });
  test('trois entrees successives → 1, 2, 3 ; une ligne rectifiee garde son numero, la rectification prend le suivant', () => {
    let lines: RegisterLine[] = [];
    for (const [id, src] of [['a', 'or1'], ['b', 'or2'], ['c', 'or3']] as const) {
      const { line } = registerEntry({ id, entered_at: '2026-05-10', vin: 'ZDM1', nature_code: '1', source: 'or', source_id: src }, lines);
      lines.push(line);
    }
    expect(lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    const r = rectifyLine(lines, 'b', 'b2', { plate: '2-XYZ-999' });
    expect(r.line.seq).toBe(4);
    expect(r.lines.find((l) => l.id === 'b')?.seq).toBe(2);
  });
});

describe('entree a l\'ouverture d\'un OR', () => {
  test('nature 1 par defaut, 2 si la garantie est acceptee', () => {
    expect(orEntryNature('aucune')).toBe('1');
    expect(orEntryNature('en_attente')).toBe('1');
    expect(orEntryNature('accepte')).toBe('2');
  });
  test('l\'OR inscrit la moto a sa date d\'ouverture, VIN normalise, pas de sortie', () => {
    const { line, created } = registerEntry({ id: 'x', entered_at: '2026-03-02', vin: 'zdm-aa00aa xb000001', plate: null, nature_code: orEntryNature('aucune'), source: 'or', source_id: 'or1' }, []);
    expect(created).toBe(true);
    expect(line.year).toBe(2026);
    expect(line.seq).toBe(1);
    expect(line.vin).toBe('ZDMAA00AAXB000001');
    expect(line.left_at).toBeNull();
    expect(registerState(line, '2026-06-01')).toBe('en_cours');
  });
  test('idempotence : le meme OR ne s\'inscrit pas deux fois', () => {
    const first = registerEntry({ id: 'x', entered_at: '2026-03-02', vin: 'ZDM1', nature_code: '1', source: 'or', source_id: 'or1' }, []);
    const again = registerEntry({ id: 'y', entered_at: '2026-03-03', vin: 'ZDM1', nature_code: '1', source: 'or', source_id: 'or1' }, [first.line]);
    expect(again.created).toBe(false);
    expect(again.line.id).toBe('x');
  });
  test('sans plaque ni chassis : refus (moto du site a completer)', () => {
    expect(() => registerEntry({ id: 'x', entered_at: '2026-03-02', vin: '', plate: ' ', nature_code: 'VN', source: 'reception', source_id: 'v9' }, [])).toThrow();
    expect(normalizeVin(' ')).toBeNull();
  });
});

describe('OR interne sur une moto du stock : pas de seconde entree', () => {
  test("moto en stock (reception VN) a la date de l'OR → deja inscrite ; vendue avant → nouvelle entree", () => {
    const stock = base({ id: 's1', source: 'reception', source_id: 'v1', nature_code: 'VN', entered_at: '2026-02-01' });
    expect(isInStock([stock], 'v1', '2026-03-02')).toBe(true);
    expect(isInStock([stock], 'v1', '2026-01-15')).toBe(false);
    const sold = { ...stock, left_at: '2026-02-20' };
    expect(isInStock([sold], 'v1', '2026-03-02')).toBe(false);
    expect(isInStock([base()], 'v1', '2026-03-02')).toBe(false); // une ligne d'OR ne compte pas
    expect(isInStock([{ ...stock, is_void: true }], 'v1', '2026-03-02')).toBe(false);
  });
});

describe('sortie a la facturation et date limite (fin du mois suivant)', () => {
  test('registerDueBy : 15/03 → 30/04 ; 31/01 → 28/02 ; 31/12 → 31/01 de l\'annee suivante ; 29/02/2028 → 31/03/2028', () => {
    expect(registerDueBy('2026-03-15')).toBe('2026-04-30');
    expect(registerDueBy('2026-01-31')).toBe('2026-02-28');
    expect(registerDueBy('2026-12-31')).toBe('2027-01-31');
    expect(registerDueBy('2028-02-29')).toBe('2028-03-31');
    expect(registerDueBy(null)).toBeNull();
  });
  test('la facture de l\'OR inscrit la sortie, la reference et la date limite', () => {
    const out = applyExit(base(), { left_at: '2026-03-15', invoice_document_id: 'd1', invoice_ref: 'FAC-2026-00042' });
    expect(out.left_at).toBe('2026-03-15');
    expect(out.invoice_ref).toBe('FAC-2026-00042');
    expect(out.invoice_due_by).toBe('2026-04-30');
    expect(out.no_document_reason).toBeNull();
    expect(registerState(out, '2026-05-15')).toBe('close');
  });
  test('sortie sans document : motif obligatoire pour clore ; sans motif la ligne est « a facturer » puis « en retard »', () => {
    const noRef = applyExit(base(), { left_at: '2026-03-15' });
    expect(registerState(noRef, '2026-04-30')).toBe('a_facturer');
    expect(registerState(noRef, '2026-05-01')).toBe('en_retard');
    const restit = applyExit(base({ source: 'depot', source_id: 'dep1' }), { left_at: '2026-03-15', reason: 'Restitution au deposant' });
    expect(restit.no_document_reason).toBe('Restitution au deposant');
    expect(registerState(restit, '2026-09-01')).toBe('close');
  });
  test('la sortie ne precede jamais l\'entree', () => {
    expect(applyExit(base({ entered_at: '2026-03-10' }), { left_at: '2026-03-01' }).left_at).toBe('2026-03-10');
  });
});

describe('append-only (B7) : rien ne s\'efface, on rectifie', () => {
  test('une sortie inscrite ne se deplace pas par une nouvelle sortie ; la reference se complete si vide', () => {
    const first = applyExit(base(), { left_at: '2026-03-15' });
    const second = applyExit(first, { left_at: '2026-03-20', invoice_ref: 'FAC-1' });
    expect(second.left_at).toBe('2026-03-15');
    expect(second.invoice_ref).toBe('FAC-1');
    const third = applyExit(second, { left_at: '2026-03-25', invoice_ref: 'FAC-2' });
    expect(third.invoice_ref).toBe('FAC-1');
  });
  test('rectification : nouvelle ligne, nouveau numero, ancienne marquee et conservee', () => {
    const old = applyExit(base(), { left_at: '2026-03-15', invoice_ref: 'FAC-1' });
    const r = rectifyLine([old], 'l1', 'l2', { plate: '9-ZZZ-999', invoice_ref: 'FAC-2', note: 'Erreur de plaque' });
    expect(r.lines).toHaveLength(2);
    const kept = r.lines.find((l) => l.id === 'l1')!;
    expect(kept.plate).toBe('1-ABC-123');
    expect(kept.rectified_by_id).toBe('l2');
    expect(registerState(kept, '2026-04-01')).toBe('rectifiee');
    expect(r.line.seq).toBe(2);
    expect(r.line.rectifies_id).toBe('l1');
    expect(r.line.plate).toBe('9-ZZZ-999');
    expect(r.line.invoice_ref).toBe('FAC-2');
    expect(r.line.invoice_due_by).toBe('2026-04-30');
    expect(r.line.note).toBe('Erreur de plaque');
  });
  test('une ligne ne se rectifie qu\'une fois ; une annulation reste lisible', () => {
    const r = rectifyLine([base()], 'l1', 'l2', { void: true, note: 'Inscrite par erreur' });
    expect(r.line.is_void).toBe(true);
    expect(registerState(r.line, '2026-04-01')).toBe('annulee');
    expect(() => rectifyLine(r.lines, 'l1', 'l3', { plate: 'X' })).toThrow();
    expect(() => applyExit(r.lines.find((l) => l.id === 'l1')!, { left_at: '2026-04-01' })).toThrow();
  });
  test('la date d\'entree rectifiee change d\'annee → numero dans la nouvelle annee', () => {
    const r = rectifyLine([base({ entered_at: '2026-01-02' }), base({ id: 'z', year: 2025, seq: 7, entered_at: '2025-12-20' })], 'l1', 'n', { entered_at: '2025-12-30' });
    expect(r.line.year).toBe(2025);
    expect(r.line.seq).toBe(8);
  });
});

describe('reprise d\'historique idempotente et chronologique', () => {
  const events: BackfillEvent[] = [
    { source: 'or', source_id: 'or2', entered_at: '2026-02-10', sort_at: '2026-02-10T09:00:00Z', vehicle_id: 'v2', vin: 'ZDM2', nature_code: '1', note: 'OR 2', left_at: '2026-02-12', invoice_ref: 'FAC-2' },
    { source: 'reception', source_id: 'v1', entered_at: '2026-01-05', sort_at: '2026-01-05T08:00:00Z', vehicle_id: 'v1', vin: 'ZDM1', nature_code: 'VN', note: 'Reception' },
    { source: 'or', source_id: 'or1', entered_at: '2026-01-20', sort_at: '2026-01-20T10:00:00Z', vehicle_id: 'v1', vin: 'ZDM1', nature_code: '2', note: 'OR 1', left_at: '2026-01-25', reason: 'Garantie constructeur' },
    { source: 'depot', source_id: 'old', entered_at: '2025-11-03', sort_at: '2025-11-03T10:00:00Z', vehicle_id: 'v3', plate: '3-DEP-003', nature_code: '4', note: 'Depot' },
  ];
  test('le plan ordonne par date et ignore ce qui precede la date de depart', () => {
    const plan = backfillPlan(events, [], '2026-01-01');
    expect(plan.map((e) => e.source_id)).toEqual(['v1', 'or1', 'or2']);
  });
  test('les lignes sont numerotees dans l\'ordre chronologique, marquees reprise, sorties completees', () => {
    const lines = applyBackfill(events, [], '2026-01-01', (e) => `bf-${e.source_id}`);
    expect(lines.map((l) => [l.seq, l.source_id])).toEqual([[1, 'v1'], [2, 'or1'], [3, 'or2']]);
    expect(lines.every((l) => l.is_backfill)).toBe(true);
    expect(lines[1].no_document_reason).toBe('Garantie constructeur');
    expect(lines[2].invoice_ref).toBe('FAC-2');
    expect(lines[2].invoice_due_by).toBe('2026-03-31');
    expect(lines[0].left_at).toBeNull();
  });
  test('rejouer la reprise n\'ajoute rien (idempotence) ; un nouvel evenement s\'ajoute a la suite', () => {
    const first = applyBackfill(events, [], '2026-01-01', (e) => `bf-${e.source_id}`);
    const again = applyBackfill(events, first, '2026-01-01', (e) => `bf2-${e.source_id}`);
    expect(again).toHaveLength(first.length);
    expect(backfillPlan(events, first, '2026-01-01')).toEqual([]);
    const more = [...events, { source: 'or' as const, source_id: 'or3', entered_at: '2026-03-01', sort_at: '2026-03-01T08:00:00Z', vehicle_id: 'v1', vin: 'ZDM1', nature_code: '1' }];
    const third = applyBackfill(more, first, '2026-01-01', (e) => `bf3-${e.source_id}`);
    expect(third).toHaveLength(4);
    expect(third[3].seq).toBe(4);
  });
});

describe('export CSV (ce que le controleur veut voir)', () => {
  test('en-tete art. 28 et une ligne par inscription, separateur point-virgule, BOM', () => {
    const l = applyExit(base({ principal_vat: 'FR12345678901' }), { left_at: '2026-03-15', invoice_ref: 'FAC-1' });
    const csv = buildRegisterCsv([{ ...l, contact_name: 'Dupont; Jean', nature_label: 'Reparation', vehicle_label: 'Ducati Monster' }]);
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('﻿' + REGISTER_CSV_HEADER.join(';'));
    expect(rows[1]).toBe('2026-0001;2026-03-02;1-ABC-123;ZDMAA00AAXB000001;"Dupont; Jean";FR12345678901;1;Reparation;2026-03-15;FAC-1;;2026-04-30;or;Ducati Monster;;;;');
  });
  test('les rectifications se referencent par numero d\'ordre', () => {
    const r = rectifyLine([base()], 'l1', 'l2', { plate: 'X-1' });
    const csv = buildRegisterCsv(r.lines);
    expect(csv.split('\r\n')[1]).toContain(';;2026-0002;;');
    expect(csv.split('\r\n')[2]).toContain(';2026-0001;;;Rectification de 2026-0001');
  });
});
