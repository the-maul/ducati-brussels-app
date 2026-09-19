/**
 * Tests — « Commander les pièces dès l'acompte et ne laisser aucun solde impayé » (mission 05,
 * carte 10). Déclenchement APRÈS un acompte ENCAISSÉ (pas avant), anti-doublon des alertes
 * d'impayé (une par document et par échéance), une alerte par document dans la cloche.
 * Mêmes règles que les fonctions SQL _sales_deposit_alert / _sales_unpaid_alert (vérifiées en base
 * le 19/09 dans une transaction annulée : règlement « attendu » → 0 alerte ; passé « reçu » + second
 * règlement le même jour → 1 alerte ; tâche quotidienne relancée → 0 nouvelle alerte d'impayé ;
 * financement accepté couvrant le reste → alerte réglée ; nouvelle échéance → nouvelle alerte).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  depositReceived, needsOrderAfterDeposit, depositAlertKey, unpaidAlertKey, isUnpaidOverdueInvoice, newUnpaidAlerts,
  latestPerDocument, sortOpenBalances, totalOpenBalances, type DocumentAlert, type OpenBalance,
} from '../src/modules/sales/deposit-alerts';

const DEV = { doc_type: 'DEV', status: 'validee' };

test('pas d\'alerte avant l\'encaissement : un règlement « attendu » ne compte pas', () => {
  const attendu = [{ amount: 500, status: 'attendu' }];
  expect(depositReceived(attendu)).toBe(0);
  expect(needsOrderAfterDeposit(DEV, attendu, 3)).toBe(false);
  expect(needsOrderAfterDeposit(DEV, [], 3)).toBe(false);
});

test('acompte encaissé (même partiel) + pièces manquantes → alerte', () => {
  const recu = [{ amount: 50, status: 'recu' }, { amount: 500, status: 'attendu' }];
  expect(depositReceived(recu)).toBe(50);
  expect(needsOrderAfterDeposit(DEV, recu, 1)).toBe(true);
  expect(needsOrderAfterDeposit({ doc_type: 'BC', status: 'validee' }, recu, 2)).toBe(true);
  expect(needsOrderAfterDeposit({ doc_type: 'RES', status: 'payee' }, recu, 2)).toBe(true);
});

test('pièces toutes commandées, document fermé ou autre type → pas d\'alerte', () => {
  const recu = [{ amount: 50, status: 'recu' }];
  expect(needsOrderAfterDeposit(DEV, recu, 0)).toBe(false);
  expect(needsOrderAfterDeposit({ doc_type: 'DEV', status: 'converti' }, recu, 2)).toBe(false);
  expect(needsOrderAfterDeposit({ doc_type: 'DEV', status: 'annulee' }, recu, 2)).toBe(false);
  expect(needsOrderAfterDeposit({ doc_type: 'FAC', status: 'validee' }, recu, 2)).toBe(false);
});

test('le versement de l\'organisme de financement n\'est pas un acompte du client', () => {
  const org = [{ amount: 5000, status: 'recu', from_financing: true }];
  expect(depositReceived(org)).toBe(0);
  expect(needsOrderAfterDeposit(DEV, org, 2)).toBe(false);
});

test('rappel quotidien : une clé par document et par jour', () => {
  expect(depositAlertKey('doc1', '2026-09-19')).toBe('doc1:2026-09-19');
  expect(depositAlertKey('doc1', '2026-09-20')).not.toBe(depositAlertKey('doc1', '2026-09-19'));
});

const TODAY = '2026-09-19';
const fac = (p: Record<string, unknown> = {}) => ({ id: 'f1', doc_type: 'FAC', status: 'validee', total_ttc: 121, paid_amount: 0, due_date: '2026-09-09', ...p });

test('facture échue avec un reste à payer → impayé ; soldée, à échoir ou financée → non', () => {
  expect(isUnpaidOverdueInvoice(fac(), null, TODAY)).toBe(true);
  expect(isUnpaidOverdueInvoice(fac({ due_date: TODAY }), null, TODAY)).toBe(false);
  expect(isUnpaidOverdueInvoice(fac({ due_date: null }), null, TODAY)).toBe(false);
  expect(isUnpaidOverdueInvoice(fac(), [{ amount: 121, status: 'recu' }], TODAY)).toBe(false);
  expect(isUnpaidOverdueInvoice(fac({ financing_status: 'accepte', financing_amount: 121 }), null, TODAY)).toBe(false);
  expect(isUnpaidOverdueInvoice(fac({ financing_status: 'demande', financing_amount: 121 }), null, TODAY)).toBe(true);
  expect(isUnpaidOverdueInvoice(fac({ doc_type: 'BC' }), null, TODAY)).toBe(false);
  expect(isUnpaidOverdueInvoice(fac({ status: 'annulee' }), null, TODAY)).toBe(false);
});

test('anti-doublon : une seule alerte par document et par échéance', () => {
  const overdue = [{ id: 'f1', due_date: '2026-09-09' }, { id: 'f2', due_date: '2026-09-01' }];
  const first = newUnpaidAlerts(overdue, new Set());
  expect(first.map((d) => d.id)).toEqual(['f1', 'f2']);
  // lendemain : mêmes factures, alertes déjà en base → rien de nouveau
  const keys = new Set(first.map((d) => unpaidAlertKey(d.id, d.due_date!)));
  expect(newUnpaidAlerts(overdue, keys)).toEqual([]);
  // le même document deux fois dans le lot → une seule alerte
  expect(newUnpaidAlerts([overdue[0], overdue[0]], new Set()).length).toBe(1);
  // l'échéance est repoussée puis dépassée à nouveau → nouvelle alerte
  expect(newUnpaidAlerts([{ id: 'f1', due_date: '2026-09-17' }], keys).map((d) => d.id)).toEqual(['f1']);
});

const alert = (id: string, documentId: string, createdAt: string): DocumentAlert => ({
  id, kind: 'order_after_deposit', documentId, contactId: null, title: id, payload: {}, createdAt, read: false,
});

test('cloche : une ligne par document, la plus récente', () => {
  const out = latestPerDocument([
    alert('a1', 'doc1', '2026-09-17T06:00:00Z'), alert('a2', 'doc1', '2026-09-19T06:00:00Z'), alert('b1', 'doc2', '2026-09-18T06:00:00Z'),
  ]);
  expect(out.map((a) => a.id)).toEqual(['a2', 'b1']);
});

const bal = (p: Partial<OpenBalance>): OpenBalance => ({
  id: 'x', docType: 'FAC', number: 'FAC-1', status: 'validee', issueDate: '2026-09-01', dueDate: null, contactId: null,
  contactName: null, operatorUserId: null, operatorName: null, ttc: 100, paid: 0, toReceiveFromOrg: 0, financingPending: 0,
  clientDue: 100, overdue: false, daysOverdue: 0, ageDays: 18, ...p,
});

test('soldes à encaisser : échus d\'abord puis échéance la plus proche ; totaux', () => {
  const rows = [
    bal({ id: 'sans', dueDate: null, clientDue: 50 }),
    bal({ id: 'bientot', dueDate: '2026-09-25', clientDue: 30 }),
    bal({ id: 'echu', dueDate: '2026-09-09', overdue: true, clientDue: 121 }),
  ];
  expect(sortOpenBalances(rows, 'due').map((r) => r.id)).toEqual(['echu', 'bientot', 'sans']);
  expect(sortOpenBalances(rows, 'amount').map((r) => r.id)).toEqual(['echu', 'sans', 'bientot']);
  expect(totalOpenBalances(rows)).toEqual({ clientDue: 201, overdueDue: 121, count: 3, overdueCount: 1 });
});
