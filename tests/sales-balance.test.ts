/**
 * Tests M6 — reste à payer avec financement (mission 05, carte 9) : seul un financement accepté
 * est déduit de ce que doit le client, et reste « à recevoir de l'organisme » jusqu'à son versement.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { documentBalance, contactBalance, isOpenForBalance } from '../src/modules/sales/balance';

const TODAY = '2026-09-19';
const pay = (amount: number, from_financing = false, status = 'recu') => ({ amount, status, from_financing });

test('sans financement : reste à payer = TTC − réglé perçu', () => {
  const b = documentBalance({ total_ttc: 1000 }, [pay(300), pay(200, false, 'attendu')], TODAY);
  expect(b.clientDue).toBe(700);
  expect(b.toReceiveFromOrg).toBe(0);
});

test('financement accepté : déduit du client, visible à recevoir de l\'organisme', () => {
  const doc = { total_ttc: 10000, financing_amount: 8000, financing_status: 'accepte' };
  expect(documentBalance(doc, [], TODAY)).toMatchObject({ clientDue: 2000, toReceiveFromOrg: 8000, financed: 8000 });
  // le client verse son apport
  expect(documentBalance(doc, [pay(2000)], TODAY)).toMatchObject({ clientDue: 0, toReceiveFromOrg: 8000 });
  // l'organisme verse d'abord : le client doit toujours son apport
  expect(documentBalance(doc, [pay(8000, true)], TODAY)).toMatchObject({ clientDue: 2000, toReceiveFromOrg: 0 });
  // tout est versé
  expect(documentBalance(doc, [pay(2000), pay(8000, true)], TODAY)).toMatchObject({ clientDue: 0, toReceiveFromOrg: 0 });
});

test('financement demandé ou refusé : rien n\'est déduit du client', () => {
  expect(documentBalance({ total_ttc: 10000, financing_amount: 8000, financing_status: 'demande' }, [], TODAY))
    .toMatchObject({ clientDue: 10000, toReceiveFromOrg: 0, financingPending: 8000 });
  expect(documentBalance({ total_ttc: 10000, financing_amount: 8000, financing_status: 'refuse' }, [], TODAY))
    .toMatchObject({ clientDue: 10000, toReceiveFromOrg: 0, financingPending: 0 });
});

test('à recevoir de l\'organisme jamais plus que ce qui reste ouvert', () => {
  const b = documentBalance({ total_ttc: 10000, financing_amount: 8000, financing_status: 'accepte' }, [pay(9000)], TODAY);
  expect(b.toReceiveFromOrg).toBe(1000);
  expect(b.clientDue).toBe(0);
});

test('en retard seulement si le client doit encore et l\'échéance est passée', () => {
  expect(documentBalance({ total_ttc: 100, due_date: '2026-09-01' }, [], TODAY).overdue).toBe(true);
  expect(documentBalance({ total_ttc: 100, due_date: '2026-10-01' }, [], TODAY).overdue).toBe(false);
  expect(documentBalance({ total_ttc: 100, due_date: '2026-09-01' }, [pay(100)], TODAY).overdue).toBe(false);
  // financé à 100 % et accepté : le client ne doit rien, pas de retard
  expect(documentBalance({ total_ttc: 100, due_date: '2026-09-01', financing_amount: 100, financing_status: 'accepte' }, [], TODAY).overdue).toBe(false);
});

test('sans règlement enregistré (reprise G8) : le réglé du document fait foi', () => {
  expect(documentBalance({ total_ttc: 500, paid_amount: 500 }, null, TODAY).clientDue).toBe(0);
  expect(documentBalance({ total_ttc: 500, paid_amount: 200 }, [], TODAY).clientDue).toBe(300);
});

test('encours du client : documents ouverts seulement (pas de devis, brouillon, converti ni annulé)', () => {
  expect(isOpenForBalance({ doc_type: 'DEV', status: 'validee' })).toBe(false);
  expect(isOpenForBalance({ doc_type: 'BC', status: 'converti' })).toBe(false);
  const docs = [
    { id: 'fac', doc_type: 'FAC', status: 'validee', total_ttc: 500, due_date: '2026-09-01' },
    { id: 'bc', doc_type: 'BC', status: 'validee', total_ttc: 10000, financing_amount: 8000, financing_status: 'accepte' },
    { id: 'dev', doc_type: 'DEV', status: 'validee', total_ttc: 3000 },
    { id: 'old', doc_type: 'FAC', status: 'annulee', total_ttc: 900 },
  ];
  const payments = new Map([['bc', [pay(1000)]]]);
  expect(contactBalance(docs, payments, TODAY)).toEqual({
    clientDue: 1500, toReceiveFromOrg: 8000, financingPending: 0, openDocs: 2, overdue: true,
  });
});
