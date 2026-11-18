/**
 * Tests M4 — rattrapage G8 achats (18/11/2026) : coût d'entrée en stock (port et remise globale répartis),
 * PAMP (B5, règle 7), reste à recevoir / statut d'une commande (réception partielle), conditionnement
 * d'achat (INV009), remise dépannage, seuils fournisseur (regroupement), contrôle du regroupement.
 * Les mêmes formules sont dans purchase_doc_save (migration 20261118200000) ; l'essai à blanc
 * supabase/tests/m4_achats_g8.sql vérifie le serveur (PAMP 12,4 sur le même exemple).
 */
import { test, expect, describe } from 'bun:test';
import {
  landedUnitCosts, nextPamp, remainingQty, orderReceptionStatus, roundToPack, defaultLineDiscount,
  thresholdStatus, mergeProblem, purchaseStatusTone, periodBounds,
} from '../src/modules/purchases/g8-rules';

describe('coût d\'entrée en stock (base du PAMP)', () => {
  test('sans port ni remise globale : PA net de la ligne', () => {
    expect(landedUnitCosts([{ quantity: 3, unit_price_ht: 12, discount_pct: 10, stocked: true }], {})).toEqual([10.8]);
  });
  test('port réparti au prorata du HT net des lignes stockées (essai à blanc : 3 x 12 + 6 de port = 14)', () => {
    expect(landedUnitCosts([{ quantity: 3, unit_price_ht: 12, discount_pct: 0, stocked: true }], { shippingHt: 6 })).toEqual([14]);
  });
  test('deux lignes : 60 / 40 du port, la ligne texte ne prend rien', () => {
    const r = landedUnitCosts([
      { quantity: 1, unit_price_ht: 60, discount_pct: 0, stocked: true },
      { quantity: 2, unit_price_ht: 20, discount_pct: 0, stocked: true },
      { quantity: 1, unit_price_ht: 50, discount_pct: 0, stocked: false },
    ], { shippingHt: 10 });
    expect(r).toEqual([66, 22, null]);
  });
  test('remise globale appliquée au coût', () => {
    expect(landedUnitCosts([{ quantity: 2, unit_price_ht: 100, discount_pct: 0, stocked: true }], { globalDiscountPct: 5 })).toEqual([95]);
  });
  test('répartition désactivée : PA net seul', () => {
    expect(landedUnitCosts([{ quantity: 2, unit_price_ht: 100, discount_pct: 0, stocked: true }], { globalDiscountPct: 5, shippingHt: 20, spread: false })).toEqual([100]);
  });
  test('quantité nulle : pas d\'entrée', () => {
    expect(landedUnitCosts([{ quantity: 0, unit_price_ht: 100, discount_pct: 0, stocked: true }], { shippingHt: 20 })).toEqual([null]);
  });
});

describe('PAMP (B5)', () => {
  test('stock 2 à 10 + entrée 3 à 14 = 12,4', () => {
    expect(nextPamp(2, 10, 3, 14)).toBe(12.4);
  });
  test('stock nul ou négatif : repart du coût d\'entrée', () => {
    expect(nextPamp(0, 10, 3, 14)).toBe(14);
    expect(nextPamp(-1, 10, 3, 14)).toBe(14);
  });
});

describe('réception partielle : reste et statut de la commande', () => {
  test('reste jamais négatif', () => {
    expect(remainingQty(5, 3)).toBe(2);
    expect(remainingQty(5, 6)).toBe(0);
  });
  test('validee → partielle → recue', () => {
    expect(orderReceptionStatus([{ quantity: 5, received: 0 }, { quantity: 3, received: 0 }])).toBe('validee');
    expect(orderReceptionStatus([{ quantity: 5, received: 3 }, { quantity: 3, received: 0 }])).toBe('partielle');
    expect(orderReceptionStatus([{ quantity: 5, received: 5 }, { quantity: 3, received: 3 }])).toBe('recue');
  });
});

describe('conditionnement et remise dépannage', () => {
  test('arrondi au conditionnement supérieur (INV009)', () => {
    expect(roundToPack(3, 2)).toBe(4);
    expect(roundToPack(4, 2)).toBe(4);
    expect(roundToPack(1, 5)).toBe(5);
    expect(roundToPack(3, 1)).toBe(3);
    expect(roundToPack(0, 5)).toBe(0);
  });
  test('remise dépannage seulement sur une commande de type dépannage', () => {
    expect(defaultLineDiscount('depannage', 10)).toBe(10);
    expect(defaultLineDiscount('stock', 10)).toBe(0);
    expect(defaultLineDiscount(null, 10)).toBe(0);
  });
});

describe('regroupement de commandes', () => {
  const o = (p: Partial<{ supplier_id: string | null; doc_type: string; status: string; dcs_kind: string | null }> = {}) =>
    ({ supplier_id: 's1', doc_type: 'CMD', status: 'validee', dcs_kind: null, ...p });
  test('deux commandes du même fournisseur : ok', () => expect(mergeProblem([o(), o()])).toBeNull());
  test('une seule : refus', () => expect(mergeProblem([o()])).toBe('count'));
  test('fournisseurs différents : refus', () => expect(mergeProblem([o(), o({ supplier_id: 's2' })])).toBe('supplier'));
  test('STANDARD et URGENTE : refus', () => expect(mergeProblem([o({ dcs_kind: 'STANDARD' }), o({ dcs_kind: 'URGENTE' })])).toBe('mixed'));
  test('commande reçue en partie : refus', () => expect(mergeProblem([o({ status: 'partielle' }), o({ status: 'partielle' })])).toBe('status'));
  test('franco et minimum sur la sélection', () => {
    const r = thresholdStatus(180, 4, { franco: 250, minAmount: 100, minQty: 5 });
    expect(r.francoRest).toBe(70);
    expect(r.francoMet).toBe(false);
    expect(r.minMet).toBe(true);
    expect(r.minQtyRest).toBe(1);
    expect(thresholdStatus(10, 1, { franco: null, minAmount: 0, minQty: null }).francoMet).toBeNull();
  });
});

describe('affichage', () => {
  test('ton des statuts (couleur + icône + libellé)', () => {
    expect(purchaseStatusTone('recue')).toBe('success');
    expect(purchaseStatusTone('partielle')).toBe('warning');
    expect(purchaseStatusTone('brouillon')).toBe('info');
    expect(purchaseStatusTone('soldee')).toBe('neutral');
  });
  test('bornes de période', () => {
    const d = new Date(2026, 10, 18);
    expect(periodBounds('month', d)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodBounds('quarter', d)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodBounds('year', d)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodBounds('all', d)).toEqual({ from: null, to: null });
  });
});
