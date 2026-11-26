/**
 * Historique des financements (VEH001) : en cours / anciens, ordre, période affichée.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  splitFinancings, orderBankFinancings, financingPeriod, financingStatus, type FinancingRow,
} from '../src/modules/vehicles/financing-history';

const row = (p: Partial<FinancingRow> & { id: string }): FinancingRow => ({
  financing_contact_id: 'bank', contract: null, client_contact_id: null, source_invoice: null,
  started_on: null, ended_on: null, is_current: false, created_at: '2026-11-26T10:00:00Z', ...p,
});

test('splitFinancings : la ligne en cours à part, les anciennes du plus récent au plus ancien', () => {
  const rows = [
    row({ id: 'a', started_on: '2015-02-04', ended_on: '2018-04-28' }),
    row({ id: 'c', started_on: '2018-04-28', is_current: true }),
    row({ id: 'b', started_on: '2016-05-10', ended_on: '2017-05-17' }),
    row({ id: 'z' }),
  ];
  const { current, previous } = splitFinancings(rows);
  expect(current?.id).toBe('c');
  expect(previous.map((r) => r.id)).toEqual(['b', 'a', 'z']);
});

test('splitFinancings : sans ligne en cours (moto revendue), tout est ancien', () => {
  const { current, previous } = splitFinancings([row({ id: 'a', started_on: '2014-01-23', ended_on: '2016-07-14' })]);
  expect(current).toBeNull();
  expect(previous).toHaveLength(1);
});

test('splitFinancings : une banque remplacée le même jour passe derrière la nouvelle (date d\'enregistrement)', () => {
  const rows = [
    row({ id: 'old', started_on: '2026-11-26', ended_on: '2026-11-26', created_at: '2026-11-26T09:00:00Z' }),
    row({ id: 'older', started_on: '2026-11-26', ended_on: '2026-11-26', created_at: '2026-11-26T08:00:00Z' }),
    row({ id: 'new', started_on: '2026-11-26', is_current: true, created_at: '2026-11-26T11:00:00Z' }),
  ];
  const { current, previous } = splitFinancings(rows);
  expect(current?.id).toBe('new');
  expect(previous.map((r) => r.id)).toEqual(['old', 'older']);
});

test('orderBankFinancings : en cours d\'abord, puis terminés', () => {
  const rows = [
    row({ id: 'e1', started_on: '2024-05-01' }),
    row({ id: 'c1', started_on: '2016-01-01', is_current: true }),
    row({ id: 'e2', started_on: '2025-01-01' }),
    row({ id: 'c2', started_on: '2025-06-01', is_current: true }),
  ];
  expect(orderBankFinancings(rows).map((r) => r.id)).toEqual(['c2', 'c1', 'e2', 'e1']);
  expect(orderBankFinancings(rows).map(financingStatus)).toEqual(['current', 'current', 'ended', 'ended']);
});

test('financingPeriod : début et fin, début seul, fin seule, rien', () => {
  expect(financingPeriod({ started_on: '2014-01-23', ended_on: '2016-07-14' })).toEqual({ kind: 'fromTo', from: '2014-01-23', to: '2016-07-14' });
  expect(financingPeriod({ started_on: '2013-03-07', ended_on: null })).toEqual({ kind: 'from', from: '2013-03-07' });
  expect(financingPeriod({ started_on: null, ended_on: '2026-11-26' })).toEqual({ kind: 'until', to: '2026-11-26' });
  expect(financingPeriod({ started_on: null, ended_on: null })).toEqual({ kind: 'none' });
});
