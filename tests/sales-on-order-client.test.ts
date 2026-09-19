/**
 * Tests M6 — « en commande » pour un client (mission 05, carte 7) : une pièce commandée pour un
 * autre client n'est jamais « en commande » pour celui-ci ; seules comptent ses commandes (contact
 * ou document) et la quantité commandée pour le stock ; une quantité stock associée à un client
 * sort du stock commun. Même règle que la fonction SQL article_on_order_for (vérifiée en base le
 * 19/09 dans une transaction annulée : Moreau 1, autre client 3, stock 1 ; après association 1 / 2 / 0).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { onOrderForClient, orderLineShare, isOrderForClient, type OpenOrderLine } from '../src/modules/sales/on-order';

const MOREAU = { contactId: 'moreau', documentId: 'dev-moreau' };
const AUTRE = { contactId: 'autre', documentId: 'dev-autre' };

const line = (p: Partial<OpenOrderLine> = {}): OpenOrderLine => ({
  line_id: 'l', order_id: 'o', order_number: 'CDP-1', dispatch_status: 'envoyee', order_kind: 'standard',
  order_contact_id: null, order_contact_name: null, source_document_id: null,
  qty_client: 0, qty_shop: 0, allocated_qty: 0, allocated_here: 0, validated_at: null, ...p,
});

// Les valises de la vidéo : 2 commandées pour un autre client, 1 pour le stock.
const valisesAutre = line({ line_id: 'a', order_contact_id: 'autre', qty_client: 2 });
const valisesStock = line({ line_id: 's', qty_shop: 1 });

test('la commande d\'un autre client est exclue ; le stock compte', () => {
  expect(onOrderForClient([valisesAutre, valisesStock], 0, MOREAU)).toBe(1);
  expect(orderLineShare(valisesAutre, MOREAU)).toEqual({ mine: 0, stock: 0, otherClient: 2, freeForAllocation: 0 });
});

test('le client pour qui la commande est passée la voit en commande (+ le stock)', () => {
  expect(onOrderForClient([valisesAutre, valisesStock], 0, AUTRE)).toBe(3);
});

test('une commande liée au document compte même sans contact identique', () => {
  const l = line({ order_contact_id: null, source_document_id: 'dev-moreau', qty_client: 1 });
  expect(isOrderForClient(l, MOREAU)).toBe(true);
  expect(onOrderForClient([l], 0, MOREAU)).toBe(1);
  expect(onOrderForClient([l], 0, AUTRE)).toBe(0);
});

test('sans client (recherche d\'article, caisse) : seulement ce qui est commandé pour le stock', () => {
  const none = { contactId: null, documentId: null };
  expect(onOrderForClient([valisesAutre, valisesStock], 4, none)).toBe(5); // 4 CMD fournisseur + 1 stock
});

test('stock associé à Moreau : compté pour lui, plus pour les autres', () => {
  const stockVueMoreau = line({ line_id: 's', qty_shop: 1, allocated_qty: 1, allocated_here: 1 });
  const stockVueAutre = line({ line_id: 's', qty_shop: 1, allocated_qty: 1, allocated_here: 0 });
  expect(onOrderForClient([valisesAutre, stockVueMoreau], 0, MOREAU)).toBe(1);
  expect(onOrderForClient([valisesAutre, stockVueAutre], 0, AUTRE)).toBe(2);
  expect(orderLineShare(stockVueAutre, AUTRE).otherClient).toBe(1);
  expect(orderLineShare(stockVueMoreau, MOREAU).freeForAllocation).toBe(0);
});

test('une association plus grande que la quantité stock est bornée', () => {
  const l = line({ qty_shop: 1, allocated_qty: 3, allocated_here: 3 });
  expect(orderLineShare(l, MOREAU)).toEqual({ mine: 1, stock: 0, otherClient: 0, freeForAllocation: 0 });
});
