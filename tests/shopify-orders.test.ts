/**
 * Mission 03 — « Une vente sur le site crée la vente et la sortie de stock dans le DMS ».
 * Règles pures de supabase/functions/_shared/shopify-order.ts : signature des webhooks,
 * TTC → HT par le taux de l'article (W-7), frais de port en ligne à part, produit non relié,
 * idempotence des remboursements, avoir. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  shopifyHmac, verifyShopifyHmac, normalizeGraphqlOrder, mapOrderToSale, mapRefundToCredit, importDecision,
  refundsToApply, zeroAmountRefunds, lineAmounts, paymentMethodFor, customerFromOrder,
  type ShopOrder, type LinkedArticle, type InvoiceLine,
} from '../supabase/functions/_shared/shopify-order.ts';

const m = (amount: number) => ({ shopMoney: { amount: String(amount) } });

/** Commande GraphQL réaliste (forme relevée sur la boutique le 21/09, données inventées). */
function gqlOrder(over: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/Order/1', name: '#1300', createdAt: '2026-09-21T10:00:00Z', updatedAt: '2026-09-21T10:00:05Z',
    cancelledAt: null, cancelReason: null, test: false, email: 'Client@Exemple.BE ', phone: null, taxesIncluded: true,
    displayFinancialStatus: 'PAID', currencyCode: 'EUR', totalPriceSet: m(178.53),
    customer: { id: 'gid://shopify/Customer/9', firstName: 'Anne', lastName: 'Martin', email: 'client@exemple.be', phone: '+32470000000' },
    billingAddress: { firstName: 'Anne', lastName: 'Martin', company: null, address1: 'Rue A 1', address2: null, zip: '1000', city: 'Bruxelles', countryCodeV2: 'BE', phone: null },
    shippingAddress: null,
    lineItems: { nodes: [
      { id: 'gid://shopify/LineItem/11', title: 'Filtre', variantTitle: 'Default Title', sku: '96881611AA', quantity: 1,
        variant: { id: 'gid://shopify/ProductVariant/111' }, originalUnitPriceSet: m(148.53), discountAllocations: [], taxLines: [{ rate: 0.21, ratePercentage: 21 }] },
    ] },
    shippingLines: { nodes: [{ title: 'Bpost', originalPriceSet: m(30), discountAllocations: [], taxLines: [{ rate: 0.21 }] }] },
    transactions: [{ kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments', amountSet: m(178.53) }],
    refunds: [],
    ...over,
  };
}

const link = (articleId: string, vatRate: number | null = 21): LinkedArticle => ({ articleId, reference: 'REF-' + articleId, designation: 'Article ' + articleId, vatRate });

// ---------------------------------------------------------------- HMAC

test('HMAC : même calcul que Shopify (base64 du HMAC-SHA256 du corps brut)', async () => {
  // Vecteur connu : HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
  const h = await shopifyHmac('The quick brown fox jumps over the lazy dog', 'key');
  expect(h).toBe(Buffer.from('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', 'hex').toString('base64'));
});

test('HMAC : signature valide acceptée, corps modifié / mauvais secret / en-tête absent refusés', async () => {
  const body = JSON.stringify({ id: 820982911946154500, admin_graphql_api_id: 'gid://shopify/Order/820982911946154508' });
  const sig = await shopifyHmac(body, 'secret-client');
  expect(await verifyShopifyHmac(body, sig, 'secret-client')).toBe(true);
  expect(await verifyShopifyHmac(new TextEncoder().encode(body), ` ${sig} `, 'secret-client')).toBe(true);
  expect(await verifyShopifyHmac(body + ' ', sig, 'secret-client')).toBe(false);
  expect(await verifyShopifyHmac(body, sig, 'autre-secret')).toBe(false);
  expect(await verifyShopifyHmac(body, null, 'secret-client')).toBe(false);
  expect(await verifyShopifyHmac(body, sig, '')).toBe(false);
});

// ---------------------------------------------------------------- Lecture de la commande

test('lecture GraphQL : e-mail en minuscules, montants, taux, remboursements', () => {
  const o = normalizeGraphqlOrder(gqlOrder());
  expect(o.email).toBe('client@exemple.be');
  expect(o.total).toBe(178.53);
  expect(o.lines[0]).toMatchObject({ variantId: 'gid://shopify/ProductVariant/111', unitPrice: 148.53, quantity: 1, taxRate: 21 });
  expect(o.shippingLines[0]).toMatchObject({ title: 'Bpost', price: 30, taxRate: 21 });
  expect(customerFromOrder(o)).toMatchObject({ email: 'client@exemple.be', firstName: 'Anne', lastName: 'Martin', city: 'Bruxelles', country: 'BE' });
});

test('décision : payée → import ; en attente ; annulée avant paiement ; commande de test', () => {
  expect(importDecision({ financialStatus: 'PAID', cancelledAt: null, test: false })).toBe('import');
  expect(importDecision({ financialStatus: 'PARTIALLY_REFUNDED', cancelledAt: null, test: false })).toBe('import');
  expect(importDecision({ financialStatus: 'REFUNDED', cancelledAt: '2026-09-21', test: false })).toBe('import');
  expect(importDecision({ financialStatus: 'PENDING', cancelledAt: null, test: false })).toBe('wait_payment');
  expect(importDecision({ financialStatus: 'AUTHORIZED', cancelledAt: null, test: false })).toBe('wait_payment');
  expect(importDecision({ financialStatus: 'VOIDED', cancelledAt: '2026-09-21', test: false })).toBe('cancelled_before_import');
  expect(importDecision({ financialStatus: 'PAID', cancelledAt: null, test: true })).toBe('test_order');
});

// ---------------------------------------------------------------- TTC → HT (W-7)

test('TTC → HT : 21 %, 6 % et 0 % (taux de l\'article), total TTC exact', () => {
  const o = normalizeGraphqlOrder(gqlOrder({
    totalPriceSet: m(121 + 2 * 10.6 + 50 + 30),
    lineItems: { nodes: [
      { id: 'L1', title: 'Pièce', sku: 'A1', quantity: 1, variant: { id: 'V1' }, originalUnitPriceSet: m(121), discountAllocations: [], taxLines: [] },
      { id: 'L2', title: 'Livre', sku: 'B2', quantity: 2, variant: { id: 'V2' }, originalUnitPriceSet: m(10.6), discountAllocations: [], taxLines: [] },
      { id: 'L3', title: 'Bon', sku: 'C3', quantity: 1, variant: { id: 'V3' }, originalUnitPriceSet: m(50), discountAllocations: [], taxLines: [] },
    ] },
  }));
  const s = mapOrderToSale(o, { V1: link('a1', 21), V2: link('a2', 6), V3: link('a3', 0) });
  const [l1, l2, l3] = s.lines;
  expect(l1).toMatchObject({ articleId: 'a1', vatRate: 21, unitPriceHt: 100, lineHt: 100, lineTtc: 121 });
  expect(l2).toMatchObject({ articleId: 'a2', vatRate: 6, unitPriceHt: 10, lineHt: 20, lineTtc: 21.2 });
  expect(l3).toMatchObject({ articleId: 'a3', vatRate: 0, lineHt: 50, lineTtc: 50 });
  expect(s.totalTtc).toBe(222.2);
  expect(s.totalHt).toBe(Math.round((100 + 20 + 50 + 30 / 1.21) * 100) / 100);
  expect(s.totalVat).toBe(Math.round((s.totalTtc - s.totalHt) * 100) / 100);
  expect(s.forcedTtc).toBeNull();
  expect(s.unlinked).toBe(0);
});

test('TTC → HT : le taux de l\'article prime sur celui de Shopify ; article sans taux = 21 %', () => {
  const o = normalizeGraphqlOrder(gqlOrder());
  expect(mapOrderToSale(o, { 'gid://shopify/ProductVariant/111': link('a', 6) }).lines[0].vatRate).toBe(6);
  expect(mapOrderToSale(o, { 'gid://shopify/ProductVariant/111': link('a', null) }).lines[0].vatRate).toBe(21);
});

test('remise Shopify en remise de ligne : TTC net exact, pourcentage affiché', () => {
  const a = lineAmounts(100, 2, 20, 21, true);
  expect(a).toEqual({ unitPriceHt: 82.645, lineHt: 148.76, lineTtc: 180, discountPct: 10 });
  const ht = lineAmounts(100, 1, 0, 21, false); // boutique « hors TVA » : le prix est HT
  expect(ht).toMatchObject({ unitPriceHt: 100, lineHt: 100, lineTtc: 121 });
});

// ---------------------------------------------------------------- Frais de port

test('frais de port : une ligne à part, sans article, jamais dans le pied de facture', () => {
  const s = mapOrderToSale(normalizeGraphqlOrder(gqlOrder()), { 'gid://shopify/ProductVariant/111': link('a') });
  const ship = s.lines.filter((l) => l.kind === 'shipping');
  expect(ship).toHaveLength(1);
  expect(ship[0]).toMatchObject({ articleId: null, designation: 'Frais de port — Bpost', quantity: 1, lineTtc: 30, lineHt: 24.79, vatRate: 21 });
  expect(s.lines).toHaveLength(2);
  expect(s.totalTtc).toBe(178.53);
});

test('frais de port offerts (remise totale) : pas de ligne', () => {
  const o = normalizeGraphqlOrder(gqlOrder({
    totalPriceSet: m(148.53),
    shippingLines: { nodes: [{ title: 'Bpost', originalPriceSet: m(30), discountAllocations: [{ allocatedAmountSet: m(30) }], taxLines: [] }] },
  }));
  expect(mapOrderToSale(o, {}).lines.filter((l) => l.kind === 'shipping')).toHaveLength(0);
});

// ---------------------------------------------------------------- Produit non relié

test('produit non relié : ligne libre avec son montant, sans article, comptée « à relier »', () => {
  const s = mapOrderToSale(normalizeGraphqlOrder(gqlOrder()), {});
  const item = s.lines.find((l) => l.kind === 'item')!;
  expect(item.articleId).toBeNull();
  expect(item.designation).toBe('Filtre');
  expect(item.reference).toBe('96881611AA');
  expect(item.lineTtc).toBe(148.53);
  expect(s.unlinked).toBe(1);
  expect(s.totalTtc).toBe(178.53);
});

// ---------------------------------------------------------------- Règlement

test('règlement : Shopify Payments / PayPal / virement ; somme = total TTC', () => {
  expect(paymentMethodFor('shopify_payments')).toBe('SHOP');
  expect(paymentMethodFor('paypal')).toBe('PPL');
  expect(paymentMethodFor('Bank Deposit')).toBe('VIR');
  expect(paymentMethodFor(null)).toBe('SHOP');
  const s = mapOrderToSale(normalizeGraphqlOrder(gqlOrder()), {});
  expect(s.payments).toEqual([{ method: 'SHOP', amount: 178.53, note: 'Commande site #1300 (shopify_payments)' }]);
});

test('total Shopify différent des lignes : net TTC forcé + avertissement', () => {
  const s = mapOrderToSale(normalizeGraphqlOrder(gqlOrder({ totalPriceSet: m(180), transactions: [] })), {});
  expect(s.forcedTtc).toBe(180);
  expect(s.totalTtc).toBe(180);
  expect(s.warnings[0]).toStartWith('total_mismatch');
  expect(s.payments[0].amount).toBe(180);
});

// ---------------------------------------------------------------- Idempotence et avoirs

const refund = (id: string, amount: number, lines: { lineItemId: string; quantity: number; restock: boolean }[] = []) =>
  ({ id, createdAt: '2026-09-22T10:00:00Z', amount, gateways: ['shopify_payments'], lines });

test('idempotence : un remboursement déjà passé en avoir n\'est jamais repris (ni en double dans la même lecture)', () => {
  const list = [refund('R1', 10), refund('R2', 20), refund('R2', 20), refund('R3', 0, [{ lineItemId: 'L', quantity: 1, restock: true }])];
  expect(refundsToApply(list, []).map((r) => r.id)).toEqual(['R1', 'R2']);
  expect(refundsToApply(list, ['R1', 'R2'])).toEqual([]);
  expect(zeroAmountRefunds(list).map((r) => r.id)).toEqual(['R3']);
});

test('avoir : lignes remboursées en négatif, stock réintégré si remis en stock, port remboursé en ajustement', () => {
  const inv: InvoiceLine[] = [
    { shopifyLineId: 'L1', articleId: 'a1', designation: 'Filtre', reference: 'F', quantity: 2, unitPriceHt: 50, vatRate: 21, discountPct: 0, lineHt: 100, lineTtc: 121 },
    { shopifyLineId: 'L2', articleId: null, designation: 'Libre', reference: null, quantity: 1, unitPriceHt: 10, vatRate: 21, discountPct: 0, lineHt: 10, lineTtc: 12.1 },
  ];
  const c = mapRefundToCredit(refund('R1', 60.5 + 12.1 + 30, [
    { lineItemId: 'L1', quantity: 1, restock: true }, { lineItemId: 'L2', quantity: 1, restock: true },
  ]), inv);
  expect(c.lines[0]).toMatchObject({ articleId: 'a1', quantity: -1, lineTtc: -60.5, lineHt: -50, restock: true });
  expect(c.lines[1]).toMatchObject({ articleId: null, quantity: -1, lineTtc: -12.1, restock: false }); // pas d'article : rien à réintégrer
  expect(c.lines[2]).toMatchObject({ kind: 'adjustment', lineTtc: -30, vatRate: 21 });
  expect(c.totalTtc).toBe(-102.6);
  expect(c.refundAmount).toBe(102.6);
  expect(c.method).toBe('SHOP');
});

test('avoir : remboursement sans remise en stock → aucune réintégration', () => {
  const inv: InvoiceLine[] = [{ shopifyLineId: 'L1', articleId: 'a1', designation: 'X', reference: null, quantity: 1, unitPriceHt: 100, vatRate: 21, discountPct: 0, lineHt: 100, lineTtc: 121 }];
  const c = mapRefundToCredit(refund('R1', 121, [{ lineItemId: 'L1', quantity: 1, restock: false }]), inv);
  expect(c.lines).toHaveLength(1);
  expect(c.lines[0].restock).toBe(false);
  expect(c.totalTtc).toBe(-121);
});

test('lecture d\'un remboursement GraphQL : montant = transactions de remboursement réussies, remise en stock', () => {
  const o: ShopOrder = normalizeGraphqlOrder(gqlOrder({
    displayFinancialStatus: 'REFUNDED',
    refunds: [{
      id: 'gid://shopify/Refund/5', createdAt: '2026-09-22T08:00:00Z',
      refundLineItems: { nodes: [{ lineItem: { id: 'gid://shopify/LineItem/11' }, quantity: 1, restockType: 'RETURN', restocked: true }] },
      transactions: { nodes: [
        { kind: 'REFUND', status: 'SUCCESS', gateway: 'paypal', amountSet: m(178.53) },
        { kind: 'REFUND', status: 'FAILURE', gateway: 'paypal', amountSet: m(178.53) },
      ] },
    }],
  }));
  expect(o.refunds[0]).toMatchObject({ amount: 178.53, gateways: ['paypal'], lines: [{ lineItemId: 'gid://shopify/LineItem/11', quantity: 1, restock: true }] });
});
