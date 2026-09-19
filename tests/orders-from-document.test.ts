/**
 * Tests — Commande de pièces depuis un document de vente (mission 02, carte 3) : sélection des
 * pièces MANQUANTES pour le client du document. Même formule que la fonction SQL
 * _document_order_needs (vérifiée en base le 19/09 dans une transaction annulée : devis avec 3 pièces
 * sans stock + 1 pièce en stock → seule la première proposée, manquant 3 ; après création de la
 * commande en brouillon, manquant 0 ; article hors document refusé).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  missingQty, freeForDocument, missingNeeds, defaultProposal, selectedLines, proposalTotalHt, proposalPayload,
  canOrderFromDocument, type OrderNeed, type NeedInput,
} from '../src/modules/orders/from-document';

const need = (p: Partial<NeedInput> = {}): NeedInput => ({
  mgmtType: 'A', qtyNeeded: 1, realQty: 0, reservedQty: 0, onOrderQty: 0, draftQty: 0, ...p,
});

test('pièce sans stock : tout le besoin manque', () => {
  expect(missingQty(need({ qtyNeeded: 3 }))).toBe(3);
});

test('le stock libre couvre : rien ne manque', () => {
  expect(missingQty(need({ qtyNeeded: 2, realQty: 5, reservedQty: 1 }))).toBe(0);
  expect(missingQty(need({ qtyNeeded: 5, realQty: 5, reservedQty: 2 }))).toBe(2);
});

test('« en commande » pour ce client et brouillons déjà lancés sont déduits', () => {
  expect(missingQty(need({ qtyNeeded: 4, onOrderQty: 1 }))).toBe(3);
  expect(missingQty(need({ qtyNeeded: 4, onOrderQty: 1, draftQty: 3 }))).toBe(0);
});

test('un stock négatif ne crée pas de besoin supplémentaire', () => {
  expect(missingQty(need({ qtyNeeded: 2, realQty: -3 }))).toBe(2);
});

test('la réservation du document lui est rendue (RES), comme la sortie d\'une facture', () => {
  // RES de 2 pièces sur un stock réel de 2 : réservé 2 (par ce document) → rien ne manque
  expect(freeForDocument({ realQty: 2, reservedQty: 2, ownReservedDelta: 2 })).toBe(2);
  expect(missingQty(need({ qtyNeeded: 2, realQty: 2, reservedQty: 2, ownReservedDelta: 2 }))).toBe(0);
  // FAC qui a sorti 1 pièce d'un stock de 1 : réel 0, sortie propre −1 → libre 1
  expect(missingQty(need({ qtyNeeded: 1, realQty: 0, ownRealDelta: -1 }))).toBe(0);
  // réservée par un AUTRE document : elle n'est pas libre
  expect(missingQty(need({ qtyNeeded: 2, realQty: 2, reservedQty: 2 }))).toBe(2);
});

test('motos, non stockés, texte et main-d\'œuvre ne se commandent pas ici', () => {
  for (const mt of ['V', 'O', 'P', 'D', 'R', 'M', 'F', 'T']) expect(missingQty(need({ mgmtType: mt, qtyNeeded: 1 }))).toBe(0);
  expect(missingQty(need({ mgmtType: 'N', qtyNeeded: 1 }))).toBe(1);
});

const orderNeed = (p: Partial<OrderNeed>): OrderNeed => ({
  articleId: 'a', reference: 'R', designation: 'D', mgmtType: 'A', lineIds: [], qtyNeeded: 1, realQty: 0,
  reservedQty: 0, freeQty: 0, onOrderQty: 0, draftQty: 0, missingQty: 1, supplierId: 'sup', supplierName: 'Ducati',
  unitPriceHt: 90, vatRate: 21, bin: null, ...p,
});

const NEEDS = [
  orderNeed({ articleId: 'valise', missingQty: 2, unitPriceHt: 250 }),
  orderNeed({ articleId: 'echappement', missingQty: 1, unitPriceHt: 1200 }),
  orderNeed({ articleId: 'filtre', missingQty: 0 }),
];

test('seules les pièces manquantes sont proposées', () => {
  expect(missingNeeds(NEEDS).map((n) => n.articleId)).toEqual(['valise', 'echappement']);
});

test('proposition par défaut : qté client = manquant, qté magasin = 0, fournisseur principal, tout coché', () => {
  const p = defaultProposal(NEEDS);
  expect(p).toEqual([
    { articleId: 'valise', selected: true, qtyClient: 2, qtyShop: 0, supplierId: 'sup', unitPriceHt: 250, vatRate: 21 },
    { articleId: 'echappement', selected: true, qtyClient: 1, qtyShop: 0, supplierId: 'sup', unitPriceHt: 1200, vatRate: 21 },
  ]);
  expect(proposalTotalHt(p)).toBe(1700);
});

test('bouton d\'une ligne : seule cette pièce est cochée', () => {
  const p = defaultProposal(NEEDS, ['echappement']);
  expect(selectedLines(p).map((l) => l.articleId)).toEqual(['echappement']);
  expect(proposalTotalHt(p)).toBe(1200);
});

test('pièce décochée ou à zéro : pas envoyée ; la quantité magasin compte dans le total', () => {
  const p = defaultProposal(NEEDS).map((l) => (l.articleId === 'valise' ? { ...l, qtyClient: 0 } : { ...l, qtyShop: 1 }));
  expect(proposalPayload(p)).toEqual([
    { article_id: 'echappement', qty_client: 1, qty_shop: 1, supplier_id: 'sup', unit_price_ht: 1200 },
  ]);
  expect(proposalTotalHt(p)).toBe(2400);
});

test('documents depuis lesquels on commande', () => {
  expect(canOrderFromDocument({ doc_type: 'DEV', status: 'validee' })).toBe(true);
  expect(canOrderFromDocument({ doc_type: 'BC', status: 'payee' })).toBe(true);
  expect(canOrderFromDocument({ doc_type: 'FAC', status: 'validee' })).toBe(true);
  expect(canOrderFromDocument({ doc_type: 'DEV', status: 'brouillon' })).toBe(false);
  expect(canOrderFromDocument({ doc_type: 'DEV', status: 'converti' })).toBe(false);
  expect(canOrderFromDocument({ doc_type: 'AVO', status: 'validee' })).toBe(false);
  expect(canOrderFromDocument({ doc_type: 'TIK', status: 'validee' })).toBe(false);
});
