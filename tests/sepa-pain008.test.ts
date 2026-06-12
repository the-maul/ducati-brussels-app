/**
 * Tests M12 — Générateur SEPA pain.008.001.02 (CLAUDE.md règle 7).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { buildPain008, type CollectableRow } from '../src/modules/accounting/sepa';

const rows: CollectableRow[] = [
  { document_id: 'd1', number: 'FAC-2026-0001', due_date: '2026-06-01', contact_id: 'c1', contact_name: 'Client A', amount_due: 121.0, mandate_ref: 'RUM-1', iban: 'BE68 5390 0754 7034', bic: 'GKCCBEBB', signature_date: '2026-01-01', seq_type: 'RCUR' },
  { document_id: 'd2', number: 'FAC-2026-0002', due_date: '2026-06-01', contact_id: 'c2', contact_name: 'Client B', amount_due: 50.5, mandate_ref: 'RUM-2', iban: 'BE62510007547061', bic: null, signature_date: '2026-02-01', seq_type: 'RCUR' },
];

const xml = buildPain008({
  msgId: 'SDD-20260612-abc', creationDateTime: '2026-06-12T10:00:00', collectionDate: '2026-06-19',
  creditorName: 'ITALBIKE STORE', creditorIban: 'BE0000000000', creditorBic: 'BBRUBEBB', creditorId: 'BE00ZZZ123', rows,
});

test('namespace pain.008.001.02', () => {
  expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.008.001.02');
});

test('nombre de transactions et somme de contrôle exacts', () => {
  expect(xml).toContain('<NbOfTxs>2</NbOfTxs>');
  expect(xml).toContain('<CtrlSum>171.50</CtrlSum>'); // 121.00 + 50.50
});

test('IBAN débiteur nettoyé (sans espaces) + EndToEndId = n° facture', () => {
  expect(xml).toContain('<IBAN>BE68539007547034</IBAN>');
  expect(xml).toContain('<EndToEndId>FAC-2026-0001</EndToEndId>');
});

test('BIC absent → Othr NOTPROVIDED', () => {
  expect(xml).toContain('<Othr><Id>NOTPROVIDED</Id></Othr>');
});

test('mandat (RUM + date de signature) présent', () => {
  expect(xml).toContain('<MndtId>RUM-1</MndtId>');
  expect(xml).toContain('<DtOfSgntr>2026-01-01</DtOfSgntr>');
});
