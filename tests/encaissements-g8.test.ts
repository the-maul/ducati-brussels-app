/**
 * Rattrapage G8 « Encaissements » (18/11/2026) — règles critiques (CLAUDE.md règle 7 : encours).
 *   - échéancier en N fois : montants (reliquat sur la 1re), dates (fin de mois), n° de chèque ;
 *   - répartition d'un montant sur plusieurs factures, compensation avoirs / factures ;
 *   - relances : frais, variables, regroupement par client, minimum, ENVOI EN TEST UNIQUEMENT ;
 *   - remise SEPA : un bloc PmtInf par type de séquence, ICS obligatoire.
 * Exécution : `bun test tests/encaissements-g8.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import {
  addMonthsClamped, allocateAmount, buildSchedule, compensationPairs, installmentAmount, installmentCheque, installmentDue, validateSchedule,
} from '../src/modules/receivables/schedule';
import {
  dunningFees, fillDunningText, groupLetters, meetsMinimum, normalizeDunningMode, resolveDunningDelivery,
} from '../src/modules/receivables/dunning';
import { buildPain008Batch } from '../src/modules/accounting/sepa';

describe('échéancier en N fois (G8 « 12 échéances automatique »)', () => {
  test('1 000 € en 12 : 83,33 × 11 et 83,37 en premier, somme exacte', () => {
    const lines = buildSchedule({ total: 1000, count: 12, firstDue: '2026-12-05' });
    expect(lines).toHaveLength(12);
    expect(lines[0].amount).toBe(83.37);
    expect(lines.slice(1).every((l) => l.amount === 83.33)).toBe(true);
    expect(Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100)).toBe(100000);
  });
  test('montant divisible : échéances égales', () => {
    expect(installmentAmount(120, 12, 1)).toBe(10);
    expect(installmentAmount(120, 12, 12)).toBe(10);
  });
  test('reliquat en cents jamais négatif ni perdu (0,05 € en 3)', () => {
    const l = buildSchedule({ total: 0.05, count: 3, firstDue: '2026-01-01' });
    expect(l.map((x) => x.amount)).toEqual([0.03, 0.01, 0.01]);
  });
  test('dates : même jour chaque mois, fin de mois ramenée (comme PostgreSQL)', () => {
    expect(installmentDue('2026-01-31', 1, 2)).toBe('2026-02-28');
    expect(installmentDue('2026-01-31', 1, 3)).toBe('2026-03-31');
    expect(installmentDue('2027-12-15', 1, 3)).toBe('2028-02-15');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(installmentDue('2026-11-18', 3, 2)).toBe('2027-02-18');
  });
  test('n° de chèque : numérique incrémenté avec zéros de tête ; texte sur la 1re seulement', () => {
    expect(installmentCheque('0001234', 1)).toBe('0001234');
    expect(installmentCheque('0001234', 3)).toBe('0001236');
    expect(installmentCheque('A12', 1)).toBe('A12');
    expect(installmentCheque('A12', 2)).toBeNull();
    expect(installmentCheque('', 1)).toBeNull();
  });
  test('refus : nombre, montant, dépassement du reste à payer', () => {
    expect(validateSchedule({ total: 100, count: 0, firstDue: '2026-12-01' }, 100)).toBe('count');
    expect(validateSchedule({ total: 100, count: 61, firstDue: '2026-12-01' }, 100)).toBe('count');
    expect(validateSchedule({ total: 0, count: 2, firstDue: '2026-12-01' }, 100)).toBe('total');
    expect(validateSchedule({ total: 0.02, count: 3, firstDue: '2026-12-01' }, 100)).toBe('tooSmall');
    expect(validateSchedule({ total: 100.01, count: 2, firstDue: '2026-12-01' }, 100)).toBe('exceedsDue');
    expect(validateSchedule({ total: 100, count: 2, firstDue: '' }, 100)).toBe('firstDue');
    expect(validateSchedule({ total: 100, count: 2, firstDue: '2026-12-01', intervalMonths: 13 }, 100)).toBe('interval');
    expect(validateSchedule({ total: 100, count: 2, firstDue: '2026-12-01' }, 100)).toBeNull();
  });
});

describe('régulariser : un montant sur plusieurs factures, compensation', () => {
  const targets = [
    { id: 'b', due: 50, dueDate: '2026-10-01' },
    { id: 'a', due: 100, dueDate: '2026-09-01' },
    { id: 'c', due: 30, dueDate: '2026-11-01' },
  ];
  test('les plus anciennes d abord, jamais plus que le dû', () => {
    expect(allocateAmount(120, targets)).toEqual({ allocations: [{ id: 'a', amount: 100 }, { id: 'b', amount: 20 }], left: 0 });
  });
  test('surplus renvoyé', () => {
    const r = allocateAmount(200, targets);
    expect(r.allocations.reduce((s, a) => s + a.amount, 0)).toBe(180);
    expect(r.left).toBe(20);
  });
  test('compensation avoir 130 € : facture a soldée, b pour 30', () => {
    const pairs = compensationPairs(targets, [{ id: 'avo', due: -130, dueDate: '2026-11-10' }]);
    expect(pairs).toEqual([{ debitId: 'a', creditId: 'avo', amount: 100 }, { debitId: 'b', creditId: 'avo', amount: 30 }]);
  });
  test('compensation : deux avoirs, centimes exacts', () => {
    const pairs = compensationPairs([{ id: 'f', due: 10.1, dueDate: null }], [{ id: 'x', due: -0.05, dueDate: '2026-01-01' }, { id: 'y', due: -20, dueDate: '2026-02-01' }]);
    expect(pairs).toEqual([{ debitId: 'f', creditId: 'x', amount: 0.05 }, { debitId: 'f', creditId: 'y', amount: 10.05 }]);
  });
});

describe('relances d impayés', () => {
  test('frais = fixes + majoration % du dû, arrondis', () => {
    expect(dunningFees(1000, 15, 1.5)).toBe(30);
    expect(dunningFees(333.33, 0, 10)).toBe(33.33);
    expect(dunningFees(-50, 5, 10)).toBe(5);
  });
  test('variables remplacées, inconnues vidées', () => {
    expect(fillDunningText('Bonjour {client}, total {total_du}{x}', { client: 'M. Rossi', total_du: '10,00 €' })).toBe('Bonjour M. Rossi, total 10,00 €');
  });
  test('une lettre par client et par modèle, total cumulé', () => {
    const rows = [
      { document_id: '1', number: 'F1', issue_date: '2026-01-01', due_date: '2026-01-31', amount_due: 10, contact_id: 'c1', contact_name: 'B', email: null, next_code: '02' },
      { document_id: '2', number: 'F2', issue_date: '2026-02-01', due_date: '2026-02-28', amount_due: 20.5, contact_id: 'c1', contact_name: 'B', email: null, next_code: '02' },
      { document_id: '3', number: 'F3', issue_date: '2026-02-01', due_date: '2026-02-28', amount_due: 5, contact_id: 'c1', contact_name: 'B', email: null, next_code: '03' },
      { document_id: '4', number: 'F4', issue_date: '2026-02-01', due_date: '2026-02-28', amount_due: 7, contact_id: 'c2', contact_name: 'A', email: null, next_code: null },
    ];
    const auto = groupLetters(rows, null, '01');
    expect(auto.map((l) => `${l.contactName}:${l.templateCode}:${l.totalDue}`)).toEqual(['A:01:7', 'B:02:30.5', 'B:03:5']);
    const forced = groupLetters(rows, '04', '01');
    expect(forced.map((l) => `${l.contactName}:${l.templateCode}:${l.rows.length}`)).toEqual(['A:04:1', 'B:04:3']);
    expect(meetsMinimum(forced[0], { min_amount: 10 })).toBe(false);
    expect(meetsMinimum(forced[1], { min_amount: 35.5 })).toBe(true);
  });
  test('mode test : jamais l adresse du client ; actif (mise en production) : le client', () => {
    const d = resolveDunningDelivery('test', 'Simon@TheMaul.be', 'Rappel', 'Marco Rossi', 'marco@example.invalid');
    expect(d).toEqual({ send: true, to: 'simon@themaul.be', subject: '[TEST relance pour Marco Rossi] Rappel', isTest: true });
    // « actif » n'est posable que par Parametres → Mise en production (19/11/2026).
    expect(normalizeDunningMode('actif')).toBe('actif');
    expect(normalizeDunningMode('inconnu')).toBe('test');
    expect(resolveDunningDelivery('actif', 'simon@themaul.be', 'R', 'X', 'Marco@Example.invalid')).toEqual({ send: true, to: 'marco@example.invalid', subject: 'R', isTest: false });
    expect(resolveDunningDelivery('actif', 'simon@themaul.be', 'R', 'X', null)).toEqual({ send: false, reason: 'no_email' });
    expect(resolveDunningDelivery('arrete', 'simon@themaul.be', 'R', 'X')).toEqual({ send: false, reason: 'arrete' });
    expect(resolveDunningDelivery('test', '', 'R', 'X')).toEqual({ send: false, reason: 'no_test_recipient' });
    expect(resolveDunningDelivery('test', 'pas une adresse', 'R', 'X')).toEqual({ send: false, reason: 'no_test_recipient' });
  });
});

describe('remise SEPA (pain.008)', () => {
  const base = {
    msgId: 'SDD-20261118-abc', creationDateTime: '2026-11-18T10:00:00', collectionDate: '2026-11-25',
    creditorName: 'ITALBIKE STORE', creditorIban: 'BE68 5390 0754 7034', creditorBic: 'GKCCBEBB', creditorId: 'BE12ZZZ0123456789',
  };
  const tx = (e: string, amount: number, seq: string) => ({
    endToEndId: e, amount, mandateRef: `RUM-${e}`, signatureDate: '2026-01-01', iban: 'BE62 5100 0754 7061', bic: null, debtorName: 'Client', remittance: e, seqType: seq,
  });
  test('un bloc PmtInf par type de séquence, totaux exacts', () => {
    const xml = buildPain008Batch({ ...base, txs: [tx('A', 10, 'FRST'), tx('B', 20.5, 'RCUR'), tx('C', 1.25, 'RCUR')] });
    expect((xml.match(/<PmtInf>/g) ?? []).length).toBe(2);
    expect(xml).toContain('<SeqTp>FRST</SeqTp>');
    expect(xml).toContain('<SeqTp>RCUR</SeqTp>');
    expect(xml).toContain('<NbOfTxs>3</NbOfTxs>');
    expect(xml).toContain('<CtrlSum>31.75</CtrlSum>');
    expect(xml).toContain('<CtrlSum>21.75</CtrlSum>');
    expect(xml).toContain('<IBAN>BE68539007547034</IBAN>');
    expect(xml).toContain('<Id>BE12ZZZ0123456789</Id>');
  });
  test('sans ICS : refus (plus jamais d identifiant factice)', () => {
    expect(() => buildPain008Batch({ ...base, creditorId: ' ', txs: [tx('A', 10, 'RCUR')] })).toThrow('missing_creditor_id');
    expect(() => buildPain008Batch({ ...base, creditorIban: '', txs: [tx('A', 10, 'RCUR')] })).toThrow('missing_creditor_iban');
  });
});
