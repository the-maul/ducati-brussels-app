/**
 * Tests M8 — lot E du parcours mecanicien (19/11/2026) : vues eclatees depuis l'OR.
 *  - retrouver la piece d'une ligne d'OR dans les vues du modele-annee (reference compacte, ou
 *    reference remplacee), une entree par vue, ordre du catalogue ;
 *  - reperes d'une vue sans image (tri naturel, sans doublon) ;
 *  - « Ajouter a l'OR » : la ligne passe par LA fonction de prix des lignes d'OR (priceOrLine) ;
 *  - « Reserver » (regle critique « reservations », regle 7) : piece stockee A seulement, OR
 *    enregistre et ni facture ni annule ; message selon la reponse de la base (reservee / panier /
 *    bloquee / deja reservee par le kit).
 * Memes regles que supabase/migrations/20261119280000_m8_vues_eclatees_or.sql (essai a blanc
 * supabase/tests/m8_vues_eclatees_or.sql). Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  locateInDrawings, positionsOf, comparePositions, linesAtPosition, canAddLine, canReserveLine, freeQty, stepQty,
  orReadOnly, baseSaleHt, catalogPickToOrLine, reserveOutcome, type LineHit, type DrawingOrder, type ActionContext,
} from '../src/modules/workshop/exploded/rules';
import type { OrLinePricer } from '../src/modules/workshop/or-line-pricing';

const order: DrawingOrder[] = [
  { drawing_id: 'D1', group_sort: 1, sort: 1 },
  { drawing_id: 'D2', group_sort: 1, sort: 2 },
  { drawing_id: 'D3', group_sort: 2, sort: 1 },
];
const hit = (drawing_id: string, line_no: number, position: string | null, reference_norm: string | null, replaced_part: string | null = null): LineHit =>
  ({ drawing_id, line_no, position, reference_norm, replaced_part });

describe('retrouver la piece dans les vues de la moto', () => {
  test('reference saisie avec espaces / tirets : meme forme compacte que la base', () => {
    const r = locateInDrawings('445-1031 2b', [hit('D2', 4, '7', '44510312B')], order);
    expect(r).toEqual([{ drawingId: 'D2', position: '7', lineNo: 4, viaReplacement: false }]);
  });
  test('une entree par vue (premier repere), ordre du catalogue', () => {
    const r = locateInDrawings('X1', [hit('D3', 2, '5', 'X1'), hit('D1', 9, '12', 'X1'), hit('D1', 3, '4', 'X1')], order);
    expect(r.map((l) => `${l.drawingId}:${l.position}`)).toEqual(['D1:4', 'D3:5']);
  });
  test('piece remplacee : retrouvee par l ancienne reference de la vue, apres les correspondances directes', () => {
    const r = locateInDrawings('NEW9', [hit('D1', 1, '2', 'OLD1', 'new-9'), hit('D3', 1, '8', 'NEW9')], order);
    expect(r.map((l) => [l.drawingId, l.viaReplacement])).toEqual([['D3', false], ['D1', true]]);
  });
  test('correspondance directe preferee a la remplacee dans une meme vue', () => {
    const r = locateInDrawings('NEW9', [hit('D1', 1, '2', 'OLD1', 'NEW9'), hit('D1', 5, '6', 'NEW9')], order);
    expect(r).toEqual([{ drawingId: 'D1', position: '6', lineNo: 5, viaReplacement: false }]);
  });
  test('vue d un autre modele-annee ignoree ; reference vide : rien', () => {
    expect(locateInDrawings('X1', [hit('D9', 1, '1', 'X1')], order)).toEqual([]);
    expect(locateInDrawings('', [hit('D1', 1, '1', '')], order)).toEqual([]);
    expect(locateInDrawings(null, [], order)).toEqual([]);
  });
});

describe('reperes sans image', () => {
  test('zones et lignes reunies, sans doublon, tri naturel', () => {
    expect(positionsOf([{ pos: 10 }, { pos: '2' }, { pos: '10A' }], [{ position: '1' }, { position: '2' }, { position: null }, { position: ' ' }]))
      .toEqual(['1', '2', '10', '10A']);
    expect(['B', '3', '11', 'A'].sort(comparePositions)).toEqual(['3', '11', 'A', 'B']);
  });
  test('lignes d un repere', () => {
    const ls = [{ position: '3', n: 1 }, { position: '4', n: 2 }, { position: '3', n: 3 }];
    expect(linesAtPosition(ls, '3').map((l) => l.n)).toEqual([1, 3]);
    expect(linesAtPosition(ls, null)).toEqual([]);
  });
});

describe('actions sur une ligne de vue', () => {
  const stocked = { article_id: 'a1', article_mgmt_type: 'A', real_qty: 3, reserved_qty: 1, on_order_qty: 0 };
  const open: ActionContext = { orId: 'or1', readOnly: false, canAdd: true };
  test('ajouter : article du DMS et OR modifiable', () => {
    expect(canAddLine(stocked, open)).toBe(true);
    expect(canAddLine({ ...stocked, article_id: null }, open)).toBe(false);
    expect(canAddLine(stocked, { ...open, readOnly: true })).toBe(false);
    expect(canAddLine(stocked, { ...open, canAdd: false })).toBe(false);
    // nouvel OR (pas encore enregistre) : on peut ajouter la ligne
    expect(canAddLine(stocked, { ...open, orId: null })).toBe(true);
  });
  test('reserver : piece stockee A, OR enregistre, ni facture ni annule (meme regle que la base)', () => {
    expect(canReserveLine(stocked, open)).toBe(true);
    expect(canReserveLine({ ...stocked, article_mgmt_type: 'M' }, open)).toBe(false);
    expect(canReserveLine({ ...stocked, article_mgmt_type: 'T' }, open)).toBe(false);
    expect(canReserveLine(stocked, { ...open, orId: null })).toBe(false);
    expect(canReserveLine(stocked, { ...open, readOnly: true })).toBe(false);
    expect(canReserveLine({ ...stocked, article_id: null }, open)).toBe(false);
  });
  test('OR en lecture : facture ou annule', () => {
    expect(orReadOnly('facture')).toBe(true);
    expect(orReadOnly('annule')).toBe(true);
    expect(orReadOnly('en_cours')).toBe(false);
    expect(orReadOnly(null)).toBe(false);
  });
  test('stock libre et pave de quantite', () => {
    expect(freeQty(stocked)).toBe(2);
    expect(freeQty({ real_qty: 1, reserved_qty: 4 })).toBe(0);
    expect(stepQty(1, -1)).toBe(1);
    expect(stepQty(1, 1)).toBe(2);
    expect(stepQty(999, 1)).toBe(999);
  });
});

describe('ajouter a l OR : LA fonction de prix des lignes d OR', () => {
  const article = { id: 'a1', reference: '44440312B', designation: 'Filtre a huile', sale_price_ht: null, sale_price_ttc: 24.2, vat_rate: 21 };
  const calls: { kind: string; id?: string; base: number; qty?: number }[] = [];
  const vip: OrLinePricer = {
    price: async (id, baseHt, qty) => { calls.push({ kind: 'article', id, base: baseHt, qty }); return { baseHt, netHt: baseHt * 0.9, unitPriceHt: baseHt, discountPct: 10, rule: { kind: 'discount_pct' }, listCode: 'VIP' } as never; },
    priceLabour: async (baseHt) => ({ baseHt, netHt: baseHt, unitPriceHt: baseHt, discountPct: 0, rule: null, listCode: null }) as never,
  };
  test('PV HT deduit du TTC quand le HT manque', () => {
    expect(baseSaleHt(article)).toBe(20);
    expect(baseSaleHt({ sale_price_ht: 15, sale_price_ttc: 99, vat_rate: 21 })).toBe(15);
    expect(baseSaleHt({ sale_price_ht: null, sale_price_ttc: null, vat_rate: 21 })).toBe(0);
  });
  test('ligne piece chiffree par le pricer (tarif du client), arrondi de la societe avant', async () => {
    const line = await catalogPickToOrLine(article, 2, vip, (ht) => ht + 0.5);
    expect(calls.at(-1)).toEqual({ kind: 'article', id: 'a1', base: 20.5, qty: 2 });
    expect(line).toEqual({ kind: 'piece', article_id: 'a1', designation: 'Filtre a huile', quantity: 2, unit_price_ht: 20.5, vat_rate: 21, discount_pct: 10, is_warranty: false });
  });
  test('pricer en erreur ou article sans prix : la ligne garde le prix catalogue', async () => {
    const broken: OrLinePricer = { price: async () => { throw new Error('x'); }, priceLabour: async () => { throw new Error('x'); } };
    expect((await catalogPickToOrLine(article, 1, broken)).unit_price_ht).toBe(20);
    const free = await catalogPickToOrLine({ ...article, sale_price_ttc: null }, 0, vip);
    expect(free.unit_price_ht).toBe(0);
    expect(free.quantity).toBe(1);
  });
});

describe('reponse de « Reserver »', () => {
  const r = (p: Partial<Parameters<typeof reserveOutcome>[0]>) => reserveOutcome({ already: false, qtyNeeded: 2, qtyReserved: 2, qtyToOrder: 0, basketKind: null, orderBlocked: false, ...p });
  test('tout en stock : reservee', () => expect(r({})).toEqual({ kind: 'reserved', reserved: 2 }));
  test('manque : panier urgente / standard', () => {
    expect(r({ qtyReserved: 1, qtyToOrder: 1, basketKind: 'urgente' })).toEqual({ kind: 'basket', reserved: 1, missing: 1, basket: 'urgente' });
    expect(r({ qtyReserved: 0, qtyToOrder: 2, basketKind: 'standard' })).toEqual({ kind: 'basket', reserved: 0, missing: 2, basket: 'standard' });
  });
  test('piece remplacee / fin de serie sans stock : jamais au panier', () =>
    expect(r({ qtyReserved: 0, orderBlocked: true })).toEqual({ kind: 'blocked', reserved: 0, missing: 2 }));
  test('piece du kit deja reservee par l OR : pas deux fois', () => expect(r({ already: true })).toEqual({ kind: 'already' }));
});
