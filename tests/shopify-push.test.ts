/**
 * Mission 03 — le DMS écrit sur Shopify (W-4, W-7, W-8) : prix TTC et arrondi, stock disponible,
 * mode Arrêtée / Essai / Tous, file d'attente dédoublonnée, plan des écritures et texte des mutations.
 * Aucune requête réseau : tout est testé en simulation. Exécution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import {
  shopifyTtc, money, roundUpEuro, availableQty, isStockManaged, writeAllowed, filterByMode, normalizeMode, enqueue,
  planPush, parseVariantStates, pickLocation, buildPriceMutation, buildInventoryMutation, buildActivateMutation,
  buildProductSetInput, buildStatusMutation, buildContentUpdateMutation, canPublish, publishTitle, photosToPush,
  chunk, throttleWaitMs, skuSearch, SHOPIFY_LOCATION_NAME, type PushTarget, type VariantState, type QueueItem,
} from '../supabase/functions/_shared/shopify-push';
import { roundUpEuro as appRoundUpEuro, effectiveSaleTtc } from '../src/lib/pricing';

const LOC = 'gid://shopify/Location/1';

describe('prix TTC envoyé à Shopify (W-7)', () => {
  test('prend le PV TTC du DMS, arrondi à l’euro supérieur si la société l’a choisi', () => {
    expect(shopifyTtc({ sale_price_ttc: 12.3, sale_price_ht: null, vat_rate: 21, round_up: true })).toBe(13);
    expect(shopifyTtc({ sale_price_ttc: 12.3, sale_price_ht: null, vat_rate: 21, round_up: false })).toBe(12.3);
  });
  test('plancher de 2 € de l’arrondi existant', () => {
    expect(shopifyTtc({ sale_price_ttc: 0.8, sale_price_ht: null, vat_rate: 21, round_up: true })).toBe(2);
  });
  test('prix rond : pas d’euro de plus', () => {
    expect(shopifyTtc({ sale_price_ttc: 45, sale_price_ht: 37.19, vat_rate: 21, round_up: true })).toBe(45);
  });
  test('sans TTC : HT × (1 + taux de TVA de l’article)', () => {
    expect(shopifyTtc({ sale_price_ttc: null, sale_price_ht: 100, vat_rate: 21, round_up: false })).toBe(121);
    expect(shopifyTtc({ sale_price_ttc: 0, sale_price_ht: 100, vat_rate: 6, round_up: false })).toBe(106);
    expect(shopifyTtc({ sale_price_ttc: null, sale_price_ht: 8.26, vat_rate: 21, round_up: true })).toBe(10);
  });
  test('taux absent : 21 % par défaut ; valeurs texte (numeric Postgres) acceptées', () => {
    expect(shopifyTtc({ sale_price_ttc: null, sale_price_ht: '10.00', vat_rate: null, round_up: false })).toBe(12.1);
    expect(shopifyTtc({ sale_price_ttc: '19.99', sale_price_ht: null, vat_rate: '21', round_up: false })).toBe(19.99);
  });
  test('aucun prix dans le DMS → null (jamais 0 € sur le site)', () => {
    expect(shopifyTtc({ sale_price_ttc: null, sale_price_ht: null, vat_rate: 21, round_up: true })).toBeNull();
    expect(shopifyTtc({ sale_price_ttc: 0, sale_price_ht: 0, vat_rate: 21, round_up: true })).toBeNull();
  });
  test('même arrondi que l’application (src/lib/pricing.ts)', () => {
    for (const p of [0.5, 1.99, 2, 9.2, 10, 10.01, 149.5, 1234.56]) {
      expect(roundUpEuro(p)).toBe(appRoundUpEuro(p));
      expect(shopifyTtc({ sale_price_ttc: p, sale_price_ht: null, vat_rate: 21, round_up: true })).toBe(effectiveSaleTtc(p, true));
    }
  });
  test('format Money Shopify', () => {
    expect(money(13)).toBe('13.00');
    expect(money(19.999)).toBe('20.00');
    expect(money(1.005)).toBe('1.01');
  });
});

describe('stock disponible (B4)', () => {
  test('réel − réservé, entier, jamais négatif', () => {
    expect(availableQty(5, 2)).toBe(3);
    expect(availableQty('5.000', '0')).toBe(5);
    expect(availableQty(2, 3)).toBe(0);
    expect(availableQty(2.5, 0)).toBe(2);
    expect(availableQty(null, null)).toBe(0);
  });
  test('types dont le stock est suivi', () => {
    expect(isStockManaged('A')).toBe(true);
    expect(isStockManaged('V')).toBe(true);
    expect(isStockManaged('M')).toBe(false);
    expect(isStockManaged('T')).toBe(false);
  });
});

describe('mode Arrêtée / Essai / Tous', () => {
  const items = [{ article_id: 'a' }, { article_id: 'b' }, { article_id: 'c' }];
  test('Arrêtée (défaut) : rien ne part, même un article d’essai', () => {
    expect(normalizeMode(undefined)).toBe('arrete');
    expect(normalizeMode('n’importe quoi')).toBe('arrete');
    expect(writeAllowed('arrete', true)).toBe(false);
    expect(filterByMode(items, 'arrete', ['a', 'b'])).toEqual([]);
  });
  test('Essai : seulement la liste choisie', () => {
    expect(filterByMode(items, 'essai', ['b'])).toEqual([{ article_id: 'b' }]);
    expect(filterByMode(items, 'essai', [])).toEqual([]);
  });
  test('Tous : tous les articles reliés', () => {
    expect(filterByMode(items, 'tous', [])).toEqual(items);
  });
  test('publication soumise au même mode', () => {
    const base = { in_trial: true, publishable: true, is_active: true, has_link: false, ttc: 10 };
    expect(canPublish({ ...base, mode: 'arrete' })).toEqual({ ok: false, reason: 'sync_stopped' });
    expect(canPublish({ ...base, mode: 'essai', in_trial: false })).toEqual({ ok: false, reason: 'not_in_trial' });
    expect(canPublish({ ...base, mode: 'essai' })).toEqual({ ok: true });
    expect(canPublish({ ...base, mode: 'tous', in_trial: false })).toEqual({ ok: true });
  });
  test('publication : case « Publiable », prix, pas de doublon de liaison', () => {
    const base = { mode: 'tous' as const, in_trial: false, publishable: true, is_active: true, has_link: false, ttc: 10 };
    expect(canPublish({ ...base, publishable: false })).toEqual({ ok: false, reason: 'not_publishable' });
    expect(canPublish({ ...base, ttc: null })).toEqual({ ok: false, reason: 'no_price' });
    expect(canPublish({ ...base, has_link: true })).toEqual({ ok: false, reason: 'already_linked' });
    expect(canPublish({ ...base, is_active: false })).toEqual({ ok: false, reason: 'inactive' });
  });
});

describe('file d’attente (dédoublonnage)', () => {
  test('une seule ligne par article, motifs cumulés, demande la plus récente', () => {
    let q: QueueItem[] = [];
    q = enqueue(q, 'c1', 'a1', 'stock', '2026-09-21T10:00:00Z');
    q = enqueue(q, 'c1', 'a1', 'stock', '2026-09-21T10:01:00Z');
    q = enqueue(q, 'c1', 'a1', 'prix', '2026-09-21T10:02:00Z');
    expect(q).toHaveLength(1);
    expect(q[0].reasons).toEqual(['prix', 'stock']);
    expect(q[0].requested_at).toBe('2026-09-21T10:02:00Z');
  });
  test('articles et sociétés distincts : lignes distinctes', () => {
    let q: QueueItem[] = [];
    q = enqueue(q, 'c1', 'a1', 'stock', 't1');
    q = enqueue(q, 'c1', 'a2', 'stock', 't1');
    q = enqueue(q, 'c2', 'a1', 'stock', 't1');
    expect(q).toHaveLength(3);
  });
  test('1 000 mouvements du même article = 1 envoi', () => {
    let q: QueueItem[] = [];
    for (let i = 0; i < 1000; i++) q = enqueue(q, 'c1', 'a1', i % 2 ? 'stock' : 'prix', `t${String(i).padStart(4, '0')}`);
    expect(q).toHaveLength(1);
  });
});

const target = (over: Partial<PushTarget> = {}): PushTarget => ({
  queue_id: 1, article_id: 'art-1', reference: '82411461A', mgmt_type: 'A',
  shopify_product_id: 'gid://shopify/Product/10', shopify_variant_id: 'gid://shopify/ProductVariant/100',
  sale_price_ttc: 12.3, sale_price_ht: null, vat_rate: 21, round_up: true, real_qty: 5, reserved_qty: 1,
  requested_at: '2026-09-21T10:00:00Z', ...over,
});
const state = (over: Partial<VariantState> = {}): VariantState => ({
  variant_id: 'gid://shopify/ProductVariant/100', product_id: 'gid://shopify/Product/10', price: '10.00',
  inventory_item_id: 'gid://shopify/InventoryItem/1000', tracked: true, available: 2, ...over,
});
const states = (...s: VariantState[]) => new Map(s.map((x) => [x.variant_id, x]));

describe('plan des écritures stock + prix', () => {
  test('prix et stock différents : les deux partent', () => {
    const p = planPush([target()], states(state()), LOC);
    expect(p.priceUpdates).toEqual([{ productId: 'gid://shopify/Product/10', variants: [{ id: 'gid://shopify/ProductVariant/100', price: '13.00' }] }]);
    expect(p.quantities).toEqual([{ inventoryItemId: 'gid://shopify/InventoryItem/1000', locationId: LOC, quantity: 4, changeFromQuantity: null }]);
    expect(p.results[0]).toMatchObject({ status: 'a_envoyer', price_before: 10, price_sent: 13, qty_before: 2, qty_sent: 4 });
  });
  test('Shopify déjà à jour : rien n’est écrit', () => {
    const p = planPush([target()], states(state({ price: '13.00', available: 4 })), LOC);
    expect(p.priceUpdates).toEqual([]);
    expect(p.quantities).toEqual([]);
    expect(p.results[0].status).toBe('deja_a_jour');
  });
  test('seul le stock change', () => {
    const p = planPush([target({ reserved_qty: 5 })], states(state({ price: '13.00', available: 3 })), LOC);
    expect(p.priceUpdates).toEqual([]);
    expect(p.quantities[0].quantity).toBe(0);
  });
  test('sans prix dans le DMS : prix du site inchangé, stock envoyé', () => {
    const p = planPush([target({ sale_price_ttc: null })], states(state()), LOC);
    expect(p.priceUpdates).toEqual([]);
    expect(p.quantities).toHaveLength(1);
    expect(p.results[0].detail).toContain('pas de prix');
  });
  test('article pas suivi en stock sur Shopify : suivi activé + quantité posée', () => {
    const p = planPush([target()], states(state({ tracked: false, available: 4, price: '13.00' })), LOC);
    expect(p.priceUpdates[0].variants[0]).toEqual({ id: 'gid://shopify/ProductVariant/100', inventoryItem: { tracked: true } });
    expect(p.quantities).toHaveLength(1);
  });
  test('article pas stocké à l’emplacement : activation avec la quantité', () => {
    const p = planPush([target()], states(state({ available: null })), LOC);
    expect(p.activations).toEqual([{ inventoryItemId: 'gid://shopify/InventoryItem/1000', locationId: LOC, available: 4 }]);
    expect(p.quantities).toEqual([]);
  });
  test('type non stocké (M) : prix seulement', () => {
    const p = planPush([target({ mgmt_type: 'M' })], states(state()), LOC);
    expect(p.quantities).toEqual([]);
    expect(p.results[0].qty_sent).toBeNull();
    expect(p.priceUpdates).toHaveLength(1);
  });
  test('variante disparue de Shopify : erreur, rien n’est écrit', () => {
    const p = planPush([target()], states(), LOC);
    expect(p.results[0].status).toBe('erreur');
    expect(p.priceUpdates).toEqual([]);
  });
  test('prix exact du DMS = prix du site : l’écart restant est signalé comme dû à l’arrondi société', () => {
    const t = target({ sale_price_ttc: 118.29, sale_price_ht: 97.76, round_up: true });
    const p = planPush([t], states(state({ price: '118.29', available: 4 })), LOC);
    expect(p.results[0]).toMatchObject({ price_before: 118.29, price_sent: 119, write_price: true });
    expect(p.results[0].detail).toContain('arrondi');
    const sans = planPush([{ ...t, round_up: false }], states(state({ price: '118.29', available: 4 })), LOC);
    expect(sans.results[0].status).toBe('deja_a_jour');
    expect(sans.results[0].detail).toBeNull();
  });
  test('reprise du 21/09 : PV G8 hors TVA rangé en TTC → le site aurait baissé ; PV corrigé → site inchangé', () => {
    // avant correction : 92,22 (HT G8 lu comme TTC) contre 118,29 sur le site
    const avant = planPush([target({ sale_price_ttc: 92.22, round_up: false, real_qty: 1, reserved_qty: 0 })],
      states(state({ price: '118.29', available: 1 })), LOC);
    expect(avant.results[0].price_sent).toBe(92.22);
    const apres = planPush([target({ sale_price_ttc: 118.29, sale_price_ht: 97.76, round_up: false, real_qty: 1, reserved_qty: 0 })],
      states(state({ price: '118.29', available: 1 })), LOC);
    expect(apres.results[0].status).toBe('deja_a_jour');
  });
  test('deux variantes du même produit : une seule mutation pour le produit', () => {
    const t2 = target({ article_id: 'art-2', queue_id: 2, shopify_variant_id: 'gid://shopify/ProductVariant/101' });
    const s2 = state({ variant_id: 'gid://shopify/ProductVariant/101', inventory_item_id: 'gid://shopify/InventoryItem/1001' });
    const p = planPush([target(), t2], states(state(), s2), LOC);
    expect(p.priceUpdates).toHaveLength(1);
    expect(p.priceUpdates[0].variants).toHaveLength(2);
    expect(p.quantities).toHaveLength(2);
  });
});

describe('construction des mutations Admin GraphQL 2026-07', () => {
  test('prix : un alias productVariantsBulkUpdate par produit', () => {
    const m = buildPriceMutation([
      { productId: 'P1', variants: [{ id: 'V1', price: '13.00' }] },
      { productId: 'P2', variants: [{ id: 'V2', price: '20.00' }] },
    ]);
    expect(m.query).toContain('mutation PushPrices($p0: ID!, $v0: [ProductVariantsBulkInput!]!, $p1: ID!, $v1: [ProductVariantsBulkInput!]!)');
    expect(m.query).toContain('u0: productVariantsBulkUpdate(productId: $p0, variants: $v0, allowPartialUpdates: true)');
    expect(m.query).toContain('u1: productVariantsBulkUpdate(productId: $p1');
    expect(m.query).toContain('userErrors { field message }');
    expect(m.variables).toEqual({ p0: 'P1', v0: [{ id: 'V1', price: '13.00' }], p1: 'P2', v1: [{ id: 'V2', price: '20.00' }] });
  });
  test('stock : inventorySetQuantities « available », @idempotent, changeFromQuantity null', () => {
    const m = buildInventoryMutation([{ inventoryItemId: 'I1', locationId: LOC, quantity: 4, changeFromQuantity: null }], 'k-1');
    expect(m.query).toContain('inventorySetQuantities(input: $input) @idempotent(key: $key)');
    expect(m.variables.key).toBe('k-1');
    expect(m.variables.input).toMatchObject({ name: 'available', reason: 'correction' });
    expect(m.variables.input.quantities[0]).toHaveProperty('changeFromQuantity', null);
    expect(JSON.stringify(m.variables)).not.toContain('compareQuantity');
  });
  test('activation : inventoryActivate @idempotent', () => {
    const m = buildActivateMutation({ inventoryItemId: 'I1', locationId: LOC, available: 3 }, 'k-2');
    expect(m.query).toContain('inventoryActivate(inventoryItemId: $item, locationId: $location, available: $available) @idempotent(key: $key)');
    expect(m.variables).toEqual({ item: 'I1', location: LOC, available: 3, key: 'k-2' });
  });
  test('lecture de l’état des variantes', () => {
    const m = parseVariantStates([
      { id: 'V1', price: '13.00', product: { id: 'P1', status: 'ACTIVE' },
        inventoryItem: { id: 'I1', tracked: true, inventoryLevel: { quantities: [{ name: 'available', quantity: 7 }] } } },
      { id: 'V2', price: '5.00', product: { id: 'P2' }, inventoryItem: { id: 'I2', tracked: false, inventoryLevel: null } },
      null,
    ]);
    expect(m.get('V1')).toEqual({ variant_id: 'V1', product_id: 'P1', price: '13.00', inventory_item_id: 'I1', tracked: true, available: 7 });
    expect(m.get('V2')?.available).toBeNull();
    expect(m.size).toBe(2);
  });
  test('emplacement « Chaussée de Bruxelles 688 »', () => {
    expect(pickLocation([{ id: 'L1', name: 'Entrepôt' }, { id: 'L2', name: ' chaussée de  Bruxelles 688 ' }])).toBe('L2');
    expect(pickLocation([{ id: 'L9', name: 'Autre nom', isActive: true }])).toBe('L9');   // emplacement unique
    expect(pickLocation([{ id: 'L1', name: 'A' }, { id: 'L2', name: 'B' }])).toBeNull();
    expect(SHOPIFY_LOCATION_NAME).toBe('Chaussée de Bruxelles 688');
  });
  test('regroupement et pauses selon le coût Shopify', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(throttleWaitMs({ throttleStatus: { currentlyAvailable: 1000, restoreRate: 50 } }, 100)).toBe(0);
    expect(throttleWaitMs({ throttleStatus: { currentlyAvailable: 20, restoreRate: 50 } }, 100)).toBe(2000);
    expect(throttleWaitMs(undefined, 100)).toBe(0);
  });
});

describe('publication d’un article', () => {
  const art = {
    reference: '82411461A', designation: 'Rétroviseur gauche', web_title: 'Rétroviseur Ducati Performance',
    web_description: '<p>Aluminium</p>', mgmt_type: 'A', sale_price_ttc: 89.5, sale_price_ht: null, vat_rate: 21,
    round_up: true, real_qty: 3, reserved_qty: 1,
  };
  test('titre : web, sinon désignation, sinon référence', () => {
    expect(publishTitle(art)).toBe('Rétroviseur Ducati Performance');
    expect(publishTitle({ ...art, web_title: ' ' })).toBe('Rétroviseur gauche');
    expect(publishTitle({ ...art, web_title: null, designation: null })).toBe('82411461A');
  });
  test('productSet : SKU = référence, prix TTC arrondi, stock disponible, photos du DMS', () => {
    const input = buildProductSetInput(art, [{ attachment_id: 'at1', url: 'https://x/signed', alt: null }], LOC) as any;
    expect(input.title).toBe('Rétroviseur Ducati Performance');
    expect(input.descriptionHtml).toBe('<p>Aluminium</p>');
    expect(input.status).toBe('ACTIVE');
    expect(input.variants[0].sku).toBe('82411461A');
    expect(input.variants[0].price).toBe('90.00');
    expect(input.variants[0].inventoryItem).toEqual({ tracked: true });
    expect(input.variants[0].inventoryQuantities).toEqual([{ locationId: LOC, name: 'available', quantity: 2 }]);
    expect(input.files).toEqual([{ originalSource: 'https://x/signed', alt: 'Rétroviseur Ducati Performance', contentType: 'IMAGE' }]);
  });
  test('retrait = brouillon, jamais de suppression', () => {
    const m = buildStatusMutation('P1', 'DRAFT');
    expect(m.variables).toEqual({ product: { id: 'P1', status: 'DRAFT' } });
    expect(m.query).toContain('productUpdate(product: $product)');
    expect(m.query.toLowerCase()).not.toContain('delete');
  });
  test('mise à jour : titre, description et nouvelles photos', () => {
    const m = buildContentUpdateMutation('P1', 'Titre', '<p>x</p>', [{ attachment_id: 'a', url: 'https://u', alt: 'alt' }]);
    expect(m.variables.product).toEqual({ id: 'P1', title: 'Titre', descriptionHtml: '<p>x</p>' });
    expect(m.variables.media).toEqual([{ originalSource: 'https://u', alt: 'alt', mediaContentType: 'IMAGE' }]);
  });
  test('photos à envoyer : pas celles reprises de Shopify ni déjà envoyées', () => {
    const photos = [
      { attachment_id: 'dms', external_id: null, pushed_to: [] as string[] },
      { attachment_id: 'reprise', external_id: 'gid://shopify/MediaImage/1', pushed_to: [] as string[] },
      { attachment_id: 'envoyee', external_id: null, pushed_to: ['P1'] },
    ];
    expect(photosToPush(photos, 'P1').map((p) => p.attachment_id)).toEqual(['dms']);
    expect(photosToPush(photos, null).map((p) => p.attachment_id)).toEqual(['dms', 'reprise', 'envoyee']);
  });
  test('recherche de doublon par SKU (guillemets neutralisés)', () => {
    expect(skuSearch(' 82411461A ')).toBe('sku:"82411461A"');
    expect(skuSearch('A"B')).toBe('sku:"AB"');
  });
});
