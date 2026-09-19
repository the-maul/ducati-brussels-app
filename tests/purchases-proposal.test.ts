/**
 * Tests M4 — Proposition de commande des commandes de pièces (mission 02, carte 4) :
 * regroupement par fournisseur et filtre par type, montant au prix d'achat, minimum de
 * commande et franco de port, fichiers DCS STANDARD / URGENTE, pré-sélection, et
 * NON-DOUBLE COMPTAGE « en commande » quand une commande de pièces devient une commande
 * fournisseur (même règle que la fonction SQL article_on_order_for, vérifiée en base le
 * 19/09 dans une transaction annulée : client 1 = 3, client 2 = 2, stock = 1 avant ET après
 * la création des CMD ; après réception de la CMD standard : 0 / 1 / 0).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  groupBySupplier, thresholdState, totalsOf, splitDcs, dcsKindOf, defaultSelected, countByKind,
  lineAmount, purchaseLineStockQty, aggregateForSupplier, buildSupplierCsv, NO_SUPPLIER, type ProposalRow,
} from '../src/modules/purchases/proposal';
import { onOrderForClient, type OpenOrderLine } from '../src/modules/sales/on-order';

const row = (p: Partial<ProposalRow> = {}): ProposalRow => ({
  line_id: 'l', order_id: 'o', order_number: 'CDP-1', order_kind: 'standard', dispatch_status: 'payee', paid: true,
  validated_at: null, contact_id: 'c1', contact_name: 'Client', source_document_id: null, source_document_number: null,
  source_document_type: null, article_id: 'a1', reference: 'REF1', supplier_ref: null, designation: 'Pièce',
  supplier_id: 'ducati', supplier_name: 'DUCATI WEST EUROPE', supplier_email: 'cmd@ducati.test',
  supplier_order_min: 250, supplier_franco_min: 1000, supplier_is_dcs: true,
  qty_client: 1, qty_shop: 0, purchase_price: 100, sale_price_ht: 150, vat_rate: 21, ...p,
});

const rows: ProposalRow[] = [
  row({ line_id: 'd1', order_kind: 'standard', qty_client: 2, qty_shop: 1 }),             // 300
  row({ line_id: 'd2', order_kind: 'urgente', article_id: 'a2', purchase_price: 50 }),    // 50
  row({ line_id: 'd3', order_kind: 'accident', article_id: 'a3', purchase_price: null }), // PA inconnu
  row({ line_id: 'm1', supplier_id: 'motul', supplier_name: 'MOTUL', supplier_is_dcs: false, supplier_order_min: null, supplier_franco_min: 150, purchase_price: 40, qty_client: 2 }), // 80
  row({ line_id: 'x1', supplier_id: null, supplier_name: null, supplier_is_dcs: false }),
  row({ line_id: 'e1', order_kind: 'excel', article_id: 'a4' }),
];

test('regroupement par fournisseur : un groupe par fournisseur, « sans fournisseur » en dernier', () => {
  const g = groupBySupplier(rows);
  expect(g.map((x) => x.key)).toEqual(['ducati', 'motul', NO_SUPPLIER]);
  const ducati = g[0];
  expect(ducati.lines.map((l) => l.line_id)).toEqual(['d1', 'd2', 'd3', 'e1']);
  expect(ducati.isDcs).toBe(true);
  expect(ducati.totalHt).toBe(450);           // 300 + 50 + 0 (PA inconnu) + 100 (excel)
  expect(ducati.missingPa).toBe(1);
  expect(ducati.byKind).toEqual({ standard: 300, urgente: 50, excel: 100 });
  expect(g[2].isDcs).toBe(false);
});

test('filtre par type : seules les lignes du type, groupes vides absents', () => {
  const urg = groupBySupplier(rows, 'urgente');
  expect(urg.map((x) => x.key)).toEqual(['ducati']);
  expect(urg[0].lines.map((l) => l.line_id)).toEqual(['d2']);
  expect(groupBySupplier(rows, 'all').length).toBe(3);
  expect(countByKind(rows)).toEqual({ all: 6, standard: 3, urgente: 1, accident: 1, excel: 1 });
});

test('montant au prix d\'achat, (qté client + qté magasin) × PA ; PA inconnu = null', () => {
  expect(lineAmount(row({ qty_client: 2, qty_shop: 1, purchase_price: 12.345 }))).toBe(37.04);
  expect(lineAmount(row({ purchase_price: 0 }))).toBeNull();
  expect(lineAmount(row({ purchase_price: null }))).toBeNull();
});

test('minimum de commande et franco : non réglé, atteint, reste à commander', () => {
  expect(thresholdState(100, null)).toEqual({ state: 'unset', min: null, rest: 0 });
  expect(thresholdState(100, 0)).toEqual({ state: 'unset', min: null, rest: 0 });
  expect(thresholdState(250, 250)).toEqual({ state: 'met', min: 250, rest: 0 });
  expect(thresholdState(180.4, 250)).toEqual({ state: 'missing', min: 250, rest: 69.6 });
  const sel = totalsOf(rows.filter((r) => r.supplier_id === 'motul'));
  expect(thresholdState(sel.totalHt, 150)).toEqual({ state: 'missing', min: 150, rest: 70 });
});

test('DCS : urgente → fichier URGENTE, standard et accident → STANDARD', () => {
  expect(dcsKindOf('urgente')).toBe('URGENTE');
  expect(dcsKindOf('standard')).toBe('STANDARD');
  expect(dcsKindOf('accident')).toBe('STANDARD');
  const s = splitDcs(rows.filter((r) => ['d1', 'd2', 'd3'].includes(r.line_id)));
  expect(s.STANDARD.map((l) => l.line_id)).toEqual(['d1', 'd3']);
  expect(s.URGENTE.map((l) => l.line_id)).toEqual(['d2']);
});

test('pré-sélection : payée ou à envoyer, hors Excel, avec fournisseur', () => {
  expect(defaultSelected(row({ dispatch_status: 'payee' }))).toBe(true);
  expect(defaultSelected(row({ dispatch_status: 'a_envoyer' }))).toBe(true);
  expect(defaultSelected(row({ dispatch_status: 'en_attente_paiement' }))).toBe(false);
  expect(defaultSelected(row({ order_kind: 'excel' }))).toBe(false);
  expect(defaultSelected(row({ supplier_id: null }))).toBe(false);
});

test('fichier fournisseur : une ligne par article, clients cumulés ; demande de prix sans prix', () => {
  const lines = aggregateForSupplier([
    row({ line_id: '1', article_id: 'a1', reference: 'B', qty_client: 1 }),
    row({ line_id: '2', article_id: 'a1', reference: 'B', qty_client: 2, qty_shop: 1 }),
    row({ line_id: '3', article_id: 'a2', reference: 'A', supplier_ref: 'SUP-A', purchase_price: null }),
  ]);
  expect(lines).toEqual([
    { reference: 'A', supplierRef: 'SUP-A', designation: 'Pièce', qty: 1, unitPrice: null },
    { reference: 'B', supplierRef: 'B', designation: 'Pièce', qty: 4, unitPrice: 100 },
  ]);
  const heads = ['Réf. frs', 'Réf.', 'Désignation', 'Qté', 'PA HT', 'Montant HT'];
  const price = buildSupplierCsv(lines, false, heads).split('\r\n');
  expect(price[0]).toBe('﻿Réf. frs;Réf.;Désignation;Qté');
  expect(price[2]).toBe('B;B;Pièce;4');
  const order = buildSupplierCsv(lines, true, heads).split('\r\n');
  expect(order[2]).toBe('B;B;Pièce;4;100,00;400,00');
  expect(order[1]).toBe('SUP-A;A;Pièce;1;;');
});

// ---------------------------------------------------------------- non-double comptage « en commande »

const open = (p: Partial<OpenOrderLine>): OpenOrderLine => ({
  line_id: 'l', order_id: 'o', order_number: 'CDP-1', dispatch_status: 'envoyee', order_kind: 'standard',
  order_contact_id: null, order_contact_name: null, source_document_id: null,
  qty_client: 0, qty_shop: 0, allocated_qty: 0, allocated_here: 0, validated_at: null, ...p,
});

test('commande de pièces devenue commande fournisseur : comptée une seule fois', () => {
  // Client 1 : 2 pièces + 1 pour le stock ; client 2 : 1 pièce. Une CMD de 3 + une CMD de 1 les reprend.
  const c1 = open({ line_id: 'p1', order_contact_id: 'c1', qty_client: 2, qty_shop: 1 });
  const c2 = open({ line_id: 'p2', order_contact_id: 'c2', qty_client: 1 });
  const cmdStock = purchaseLineStockQty({ quantity: 3, linkedPartQty: 3, received: false })
    + purchaseLineStockQty({ quantity: 1, linkedPartQty: 1, received: false });
  expect(cmdStock).toBe(0); // la CMD ne recompte pas ce que la commande de pièces compte déjà
  const who = (contactId: string | null) => ({ contactId, documentId: null });
  expect(onOrderForClient([c1, c2], cmdStock, who('c1'))).toBe(3);
  expect(onOrderForClient([c1, c2], cmdStock, who('c2'))).toBe(2);
  expect(onOrderForClient([c1, c2], cmdStock, who(null))).toBe(1);
  // Ce qu'aurait donné un double comptage : 3 + 4 pour le client 1.
  const doubleCounted = purchaseLineStockQty({ quantity: 3, linkedPartQty: 0, received: false })
    + purchaseLineStockQty({ quantity: 1, linkedPartQty: 0, received: false });
  expect(onOrderForClient([c1, c2], doubleCounted, who('c1'))).toBe(7);
});

test('CMD plus grande que les commandes de pièces : le surplus compte pour le stock', () => {
  expect(purchaseLineStockQty({ quantity: 5, linkedPartQty: 3, received: false })).toBe(2);
  expect(purchaseLineStockQty({ quantity: 2, linkedPartQty: 3, received: false })).toBe(0);
});

test('CMD reçue : plus rien en commande (la pièce est dans le stock réel)', () => {
  expect(purchaseLineStockQty({ quantity: 5, linkedPartQty: 3, received: true })).toBe(0);
});
