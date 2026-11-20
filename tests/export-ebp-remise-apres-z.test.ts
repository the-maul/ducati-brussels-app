/**
 * Transfert EBP — remise en banque d'espèces faite APRÈS le Z (lot-verif-parcours, 20/11/2026, parcours G8 n° 23 / 25).
 *
 * Décision Q31 : remise en banque G8 et journal Z, sans blocage, dans les deux ordres. Caisse ouverte, la base
 * pose une sortie 01 dans la session (exportée comme mouvement de caisse) ; caisse fermée, aucune sortie :
 * la remise doit quand même partir au comptable, comme dans G8 (« REMISE EN BANQUE ESP »), une seule fois.
 * `loadEbpSources` est joué avec un faux client Supabase (tables en mémoire).
 */
import { test, expect, describe } from 'bun:test';
import { loadEbpSources, DEFAULT_EBP_SETTINGS, depositMovement, type EbpDbClient, type EbpSelection } from '../supabase/functions/_shared/ebp-sources';
import { buildEbpTransfer } from '../supabase/functions/_shared/ebp-format';

type Row = Record<string, unknown>;

/** Faux client : select / eq / in / gte / lte / gt / not / order / range / maybeSingle sur des tableaux. */
function fakeDb(tables: Record<string, Row[]>): EbpDbClient {
  const from = (name: string) => {
    let rows = [...(tables[name] ?? [])];
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
      in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; },
      gte: (c: string, v: string) => { rows = rows.filter((r) => String(r[c]) >= v); return b; },
      lte: (c: string, v: string) => { rows = rows.filter((r) => String(r[c]) <= v); return b; },
      gt: (c: string, v: number) => { rows = rows.filter((r) => Number(r[c]) > v); return b; },
      not: () => b,
      order: () => b,
      range: async () => ({ data: rows, error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (ok: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
    };
    return b;
  };
  return { from, rpc: async () => ({ data: [], error: null }) };
}

const SEL: EbpSelection = {
  from: '2026-11-20', to: '2026-11-20', selection: 'period',
  includeSales: false, includePayments: true, includePurchases: false, includeCessions: false, includeConsignments: false,
};
const CO = 'co-1';
const base = (extra: Record<string, Row[]>) => ({
  companies: [{ id: CO, accounting_start_date: '2026-01-01' }],
  accounting_transfer_items: [], accounting_third_accounts: [],
  ...extra,
});
// Remise n° 2 après le Z (aucune sortie 01) et remise n° 1 caisse ouverte (sortie 01 posée par la base).
const AFTER_Z = { id: 'dep-2', company_id: CO, number: 2, method: 'ESP', kind: 'remise', status: 'active', deposited_amount: 267.64, deposit_date: '2026-11-20', created_at: '2026-11-20T17:00:00+00:00' };
const OPEN = { id: 'dep-1', company_id: CO, number: 1, method: 'ESP', kind: 'remise', status: 'active', deposited_amount: 50, deposit_date: '2026-11-20', created_at: '2026-11-20T12:00:00+00:00' };
const MOVE_01 = { id: 'mv-1', company_id: CO, kind: 'out', method: 'ESP', amount: 50, reason: 'Remise en banque n° 1', occurred_at: '2026-11-20T12:00:00+00:00', type_code: '01', movement_no: 7, deposit_id: 'dep-1' };

describe('remise en banque après le Z', () => {
  test('la remise sans sortie 01 part au comptable : 530000 crédit, compte de la remise débit, journal RC', async () => {
    const db = fakeDb(base({ cash_movements: [MOVE_01], cash_deposits: [OPEN, AFTER_Z] }));
    const load = await loadEbpSources(db, CO, SEL, DEFAULT_EBP_SETTINGS, []);
    const ids = load.sources.map((s) => s.id);
    expect(ids).toEqual(['mv-1', 'dep-2']);   // la remise caisse ouverte une seule fois (par son mouvement)
    const res = buildEbpTransfer(load.sources);
    const lines = res.lines.filter((l) => l.sourceId === 'dep-2');
    expect(lines.map((l) => `${l.journal}:${l.account}:${l.side}:${l.amount}`)).toEqual(['RC:530000:C:267.64', 'RC:530000:D:267.64']);
    expect(lines[0].label).toBe('REMISE EN BANQUE               ESP');
    expect(lines[0].external).toBe('2');
    expect(res.unbalanced).toEqual([]);
    expect(res.items.find((i) => i.id === 'dep-2')?.kind).toBe('cash_movement');
  });

  test('déjà transférée, annulée, archivée sans remise ou à 0 € : rien', async () => {
    const db = fakeDb(base({
      accounting_transfer_items: [{ company_id: CO, source_kind: 'cash_movement', source_id: 'dep-2', cancelled: false }],
      cash_movements: [],
      cash_deposits: [AFTER_Z,
        { ...AFTER_Z, id: 'dep-3', status: 'annulee' }, { ...AFTER_Z, id: 'dep-4', kind: 'archive', deposited_amount: 0 },
        { ...AFTER_Z, id: 'dep-5', method: 'MAE' }],
    }));
    const load = await loadEbpSources(db, CO, SEL, DEFAULT_EBP_SETTINGS, []);
    expect(load.sources).toEqual([]);
  });

  test('option « transfert des remises » décochée : la remise ne part pas', async () => {
    const db = fakeDb(base({ cash_movements: [], cash_deposits: [AFTER_Z] }));
    const settings = { ...DEFAULT_EBP_SETTINGS, payments: { ...DEFAULT_EBP_SETTINGS.payments, includeBankDeposits: false } };
    const load = await loadEbpSources(db, CO, SEL, settings, []);
    expect(load.sources).toEqual([]);
  });

  test('compte banque paramétré sur le type 01 : 530000 → banque', async () => {
    const db = fakeDb(base({ cash_movements: [], cash_deposits: [AFTER_Z] }));
    const rules = [{ kind: 'cash_movement' as const, key: '01', family: null, vat_rate: 0, tax_exempt: null, demo: null, customer_category: null,
      account: '550000', account2: null, account3: null, country: null, journal: null, label: 'REMISE EN BANQUE', mode_label: 'bank', is_active: true }];
    const res = buildEbpTransfer((await loadEbpSources(db, CO, SEL, DEFAULT_EBP_SETTINGS, rules)).sources);
    expect(res.lines.map((l) => `${l.account}:${l.side}`)).toEqual(['530000:C', '550000:D']);
  });

  test('depositMovement : date de remise, n° de remise, sortie espèces 01', () => {
    expect(depositMovement(AFTER_Z)).toEqual({ id: 'dep-2', kind: 'out', method: 'ESP', amount: 267.64, reason: null, occurred_at: '2026-11-20', type_code: '01', movement_no: 2 });
  });
});
