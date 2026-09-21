/**
 * Mission 03 — « Aligner le DMS sur le site (stock et prix) » (W-10, 21/09) : règles de la reprise
 * (miroir de la fonction SQL shopify_realign). Exécution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import { htFromTtc, planRealign, type RealignInput } from '../src/modules/articles/shopify-realign-rules';
import { shopifyTtc } from '../supabase/functions/_shared/shopify-push';

const art = (over: Partial<RealignInput> = {}): RealignInput => ({
  mgmt_type: 'A', real_qty: 0, reserved_qty: 0, shop_qty: 2, shop_price: 118.29, vat_rate: 21,
  sale_price_ht: null, sale_price_ttc: 92.22, price_sale_locked: false, links_of_article: 1, ...over,
});

describe('PV HT tiré du prix du site (TVA comprise)', () => {
  test('TTC ÷ (1 + TVA de l’article), au centime', () => {
    expect(htFromTtc(118.29, 21)).toBe(97.76);
    expect(htFromTtc(121, 21)).toBe(100);
    expect(htFromTtc(106, 6)).toBe(100);
    expect(htFromTtc(2169.04, 21)).toBe(1792.6);
  });
  test('taux absent : 21 %', () => {
    expect(htFromTtc(12.1, null)).toBe(10);
  });
  test('aller-retour : le HT repris redonne le prix du site (TTC gardé tel quel)', () => {
    for (const p of [118.29, 129.31, 1100.92, 151.65, 52.05, 2169.04]) {
      const ht = htFromTtc(p, 21);
      expect(Math.abs(ht * 1.21 - p)).toBeLessThan(0.0061);
      // le TTC envoyé au site part du PV TTC repris (= prix du site), pas du HT recalculé
      expect(shopifyTtc({ sale_price_ttc: p, sale_price_ht: ht, vat_rate: 21, round_up: false })).toBe(p);
    }
  });
});

describe('stock de départ = stock Shopify (inventaire annule-et-remplace, B6)', () => {
  test('stock DMS 0, site 2 → +2', () => {
    expect(planRealign(art())).toMatchObject({ stock_change: true, stock_delta: 2, stock_after: 2 });
  });
  test('stock DMS 3, site 1 → −2', () => {
    expect(planRealign(art({ real_qty: 3, shop_qty: 1 }))).toMatchObject({ stock_delta: -2, stock_after: 1 });
  });
  test('déjà aligné : aucun mouvement (réexécutable)', () => {
    expect(planRealign(art({ real_qty: 2 }))).toMatchObject({ stock_change: false, stock_delta: 0 });
  });
  test('stock Shopify négatif → ramené à 0, signalé', () => {
    const p = planRealign(art({ real_qty: 1, shop_qty: -1 }));
    expect(p).toMatchObject({ stock_delta: -1, stock_after: 0 });
    expect(p.notes.join()).toContain('négatif');
  });
  test('stock Shopify inconnu : rien, signalé', () => {
    const p = planRealign(art({ shop_qty: null }));
    expect(p.stock_change).toBe(false);
    expect(p.notes.join()).toContain('relire Shopify');
  });
  test('type sans stock (M) : pas de mouvement', () => {
    expect(planRealign(art({ mgmt_type: 'M' })).stock_change).toBe(false);
  });
  test('réservé dans le DMS : signalé', () => {
    expect(planRealign(art({ reserved_qty: 1 })).notes.join()).toContain('réservé');
  });
});

describe('prix = prix du site (W-10), PV du DMS en HT', () => {
  test('PV G8 hors TVA rangé en TTC : HT et TTC repris du site', () => {
    expect(planRealign(art())).toMatchObject({ price_change: true, ht_after: 97.76, ttc_after: 118.29 });
  });
  test('article sans prix dans le DMS : prix repris', () => {
    expect(planRealign(art({ sale_price_ttc: 0 }))).toMatchObject({ price_change: true, ttc_after: 118.29 });
  });
  test('déjà aligné : aucun changement de prix (réexécutable)', () => {
    expect(planRealign(art({ sale_price_ht: 97.76, sale_price_ttc: 118.29 })).price_change).toBe(false);
  });
  test('TVA 6 % de l’article respectée', () => {
    expect(planRealign(art({ vat_rate: 6, shop_price: 106 }))).toMatchObject({ ht_after: 100, ttc_after: 106 });
  });
  test('prix verrouillé, TVA marge (O) ou pas de prix sur le site : prix du DMS inchangé', () => {
    expect(planRealign(art({ price_sale_locked: true })).price_change).toBe(false);
    expect(planRealign(art({ mgmt_type: 'O' })).price_change).toBe(false);
    expect(planRealign(art({ shop_price: null })).price_change).toBe(false);
    expect(planRealign(art({ shop_price: 0 })).price_change).toBe(false);
  });
  test('article relié à deux produits du site : rien n’est fait', () => {
    const p = planRealign(art({ links_of_article: 2 }));
    expect(p.stock_change || p.price_change).toBe(false);
  });
});
