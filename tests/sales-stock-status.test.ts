/**
 * Tests M6 — disponibilité d'un article dans la recherche d'une ligne de vente
 * (mission 05, carte 2) : disponible / en commande / à commander sur le triple stock B4.
 */
import { test, expect } from 'bun:test';
import { saleStockStatus } from '../src/modules/sales/availability';

const art = (p: Partial<Parameters<typeof saleStockStatus>[0]> = {}) => ({
  mgmt_type: 'A', real_qty: 0, reserved_qty: 0, on_order_qty: 0, ...p,
});

test('disponible quand le libre (réel − réservé) couvre la quantité', () => {
  expect(saleStockStatus(art({ real_qty: 3 }))).toBe('disponible');
  expect(saleStockStatus(art({ real_qty: 3, reserved_qty: 1 }), 2)).toBe('disponible');
});

test('le stock réservé pour un autre document n\'est pas disponible', () => {
  expect(saleStockStatus(art({ real_qty: 1, reserved_qty: 1 }))).toBe('a_commander');
});

test('en commande quand une commande fournisseur couvre le manque', () => {
  expect(saleStockStatus(art({ real_qty: 0, on_order_qty: 2 }))).toBe('en_commande');
  expect(saleStockStatus(art({ real_qty: 1, on_order_qty: 1 }), 2)).toBe('en_commande');
});

test('à commander quand ni le stock ni les commandes ne suffisent', () => {
  expect(saleStockStatus(art())).toBe('a_commander');
  expect(saleStockStatus(art({ real_qty: 1, on_order_qty: 1 }), 5)).toBe('a_commander');
});

test('pas de statut pour les articles non stockés, texte et main-d\'œuvre', () => {
  for (const mgmt_type of ['M', 'F', 'T']) expect(saleStockStatus(art({ mgmt_type, real_qty: 5 }))).toBe('na');
});

test('une moto (V) se lit comme une pièce stockée', () => {
  expect(saleStockStatus(art({ mgmt_type: 'V', real_qty: 1 }))).toBe('disponible');
});
