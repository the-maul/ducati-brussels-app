/**
 * Tests M4 / M5 — Réassort minimax immédiat (décisions de Simon du 18/11/2026) :
 *  - quel mouvement baisse / remonte le stock du minimax (sortie, réservation BL / entrée, libération) ;
 *  - quantité de la ligne minimax du panier : portée au besoin à la baisse, ramenée au besoin à la
 *    hausse, jamais de doublon ; facture d'un BL (sortie puis libération) = pas de double commande ;
 *  - remplacement de référence : minimum / maximum / conditionnement passent sur la nouvelle ;
 *  - réglage par société et fenêtre de proposition (mode manuel) : lignes ajoutées / ignorées.
 * Même logique que _minimax_immediate / _article_minimax_transfer / minimax_proposal_apply
 * (migration 20261119130000, essai à blanc supabase/tests/m4_minimax_immediat.sql). `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  defaultChoices, ignoredArticleIds, mapProposalRow, minimaxImmediateQty, minimaxTransfer, movementLowersMinimax,
  parseMinimaxMode, parseQty, proposalLinesToApply, uniqueArticleIds, type MinimaxProposalRow,
} from '../src/modules/purchases/minimax-immediate';
import { minimaxQty } from '../src/modules/purchases/basket';

describe('mouvements de stock', () => {
  test('sortie du réel et réservation (BL) baissent ; entrée et libération remontent', () => {
    expect(movementLowersMinimax(-2, false)).toBe(true);   // vente, ticket, facture, cession, réajustement -
    expect(movementLowersMinimax(3, true)).toBe(true);     // réservation BL / RES
    expect(movementLowersMinimax(5, false)).toBe(false);   // entrée, réception, avoir
    expect(movementLowersMinimax(-3, true)).toBe(false);   // libération de réservation
    expect(movementLowersMinimax(0, false)).toBeNull();
  });
});

describe('ligne minimax du panier', () => {
  // besoin (_basket_minimax_need) : 0 tant que le stock du minimax tient le minimum (3), sinon
  // max(maximum, minimum) − stock du minimax − déjà en commande (règle de la tâche de nuit)
  const need = (stock: number, onOrder = 0) =>
    (stock >= 3 ? 0 : minimaxQty({ stockMin: 3, stockMax: 8, realQty: stock, onOrderQty: onOrder }));

  test('vente sous le minimum : ligne créée au besoin (8 − 2 = 6)', () => {
    expect(minimaxImmediateQty({ lowering: true, current: 0, need: need(2) })).toBe(6);
  });
  test('deuxième vente : la même ligne est portée au besoin (7), pas de doublon', () => {
    expect(minimaxImmediateQty({ lowering: true, current: 6, need: need(1) })).toBe(7);
  });
  test('baisse sans besoin plus haut : rien ne change (quantité augmentée à la main gardée)', () => {
    expect(minimaxImmediateQty({ lowering: true, current: 9, need: need(1) })).toBeNull();
    expect(minimaxImmediateQty({ lowering: true, current: 0, need: need(5) })).toBeNull();
  });
  test('entrée au-dessus du minimum : ligne retirée (besoin 0)', () => {
    expect(minimaxImmediateQty({ lowering: false, current: 7, need: 0 })).toBe(0);
  });
  test('facture d\'un BL : sortie puis libération -> la ligne revient au besoin réel', () => {
    // stock réel 6 ; BL réserve 4 -> stock du minimax 2 -> ligne 6
    let line = minimaxImmediateQty({ lowering: true, current: 0, need: need(2) }) ?? 0;
    expect(line).toBe(6);
    // facture : sortie 4 (réel 2, encore réservé 4) -> stock du minimax -2 -> ligne 10 (passager)
    line = minimaxImmediateQty({ lowering: true, current: line, need: need(-2) }) ?? line;
    expect(line).toBe(10);
    // libération 4 -> stock du minimax 2 -> ligne ramenée à 6 : pas commandée deux fois
    line = minimaxImmediateQty({ lowering: false, current: line, need: need(2) }) ?? line;
    expect(line).toBe(6);
  });
  test('ce qui est déjà en commande est déduit', () => {
    expect(minimaxImmediateQty({ lowering: true, current: 0, need: need(2, 4) })).toBe(2);
    expect(minimaxImmediateQty({ lowering: true, current: 0, need: need(2, 10) })).toBeNull();
  });
});

describe('remplacement de référence', () => {
  test('minimum / maximum et conditionnement passent sur la nouvelle, l\'ancienne à 0', () => {
    const r = minimaxTransfer({ stockMin: 2, stockMax: 5, packQty: 4 }, { stockMin: 0, stockMax: 0, packQty: 1 });
    expect(r.changed).toBe(true);
    expect(r.target).toEqual({ stockMin: 2, stockMax: 5, packQty: 4 });
    expect(r.source).toEqual({ stockMin: 0, stockMax: 0, packQty: 4 });
  });
  test('la nouvelle garde son propre minimax et son conditionnement', () => {
    const r = minimaxTransfer({ stockMin: 3, stockMax: 6, packQty: 5 }, { stockMin: 1, stockMax: 2, packQty: 2 });
    expect(r.target).toEqual({ stockMin: 1, stockMax: 2, packQty: 2 });
    expect(r.source.stockMin).toBe(0);
  });
  test('rien à reporter : aucun changement (rattrapage idempotent)', () => {
    const r = minimaxTransfer({ stockMin: 0, stockMax: 0, packQty: 1 }, { stockMin: 0, stockMax: 0, packQty: 1 });
    expect(r.changed).toBe(false);
  });
  test('conditionnement seul (cas du rattrapage en production)', () => {
    const r = minimaxTransfer({ stockMin: 0, stockMax: 0, packQty: 10 }, { stockMin: 0, stockMax: 0, packQty: 1 });
    expect(r.changed).toBe(true);
    expect(r.target.packQty).toBe(10);
    expect(r.target.stockMin).toBe(0);
  });
});

describe('réglage et fenêtre de proposition (mode manuel)', () => {
  test('réglage : défaut automatique', () => {
    expect(parseMinimaxMode('manuel')).toBe('manuel');
    expect(parseMinimaxMode('auto')).toBe('auto');
    expect(parseMinimaxMode(null)).toBe('auto');
    expect(parseMinimaxMode('n importe quoi')).toBe('auto');
  });
  test('articles de la vente : sans doublon ni vide', () => {
    expect(uniqueArticleIds(['a', null, 'b', 'a', undefined, ''])).toEqual(['a', 'b']);
  });
  const rows: MinimaxProposalRow[] = [
    mapProposalRow({ article_id: 'a', reference: 'R1', designation: 'Filtre', stock_min: '3', stock_max: '8', minimax_stock: '2', on_order: '0', in_basket: '0', qty: '6' }),
    mapProposalRow({ article_id: 'b', reference: 'R2', designation: 'Joint', stock_min: '2', stock_max: '2', minimax_stock: '1', on_order: '0', in_basket: '0', qty: '1.5' }),
  ];
  test('lecture d\'une ligne proposée', () => {
    expect(rows[0]).toMatchObject({ articleId: 'a', stockMin: 3, stockMax: 8, minimaxStock: 2, qty: 6 });
  });
  test('par défaut tout est coché à la quantité proposée', () => {
    const c = defaultChoices(rows);
    expect(proposalLinesToApply(rows, c)).toEqual([{ article_id: 'a', qty: 6 }, { article_id: 'b', qty: 1.5 }]);
    expect(ignoredArticleIds(rows, c)).toEqual([]);
  });
  test('décochée ou à 0 : ignorée ; quantité saisie avec virgule', () => {
    const c = defaultChoices(rows);
    c.a = { selected: true, qty: '4,5' };
    c.b = { selected: false, qty: '1' };
    expect(proposalLinesToApply(rows, c)).toEqual([{ article_id: 'a', qty: 4.5 }]);
    expect(ignoredArticleIds(rows, c)).toEqual(['b']);
    c.a = { selected: true, qty: '0' };
    expect(proposalLinesToApply(rows, c)).toEqual([]);
    expect(parseQty('abc')).toBe(0);
  });
});
