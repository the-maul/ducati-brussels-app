/**
 * Mission 03 — « Aligner le DMS sur le site (stock et prix) » (décision W-10, 21/09) : règles pures.
 *
 * Miroir TypeScript, testé (`tests/shopify-realign.test.ts`), de la fonction SQL `shopify_realign`
 * (migration 20260921140000) qui fait foi en base :
 *   - stock de départ = stock Shopify (jamais négatif) → un mouvement « inventaire » annule-et-remplace
 *     (B6) de (stock Shopify − stock réel), sans prix d'achat (le PAMP ne bouge pas) ;
 *   - prix = prix du site : PV TTC = prix Shopify (TVA comprise, W-7) ; PV HT = TTC ÷ (1 + TVA de
 *     l'article, 21 % par défaut), arrondi au centime ; changé seulement s'il diffère.
 */

export type RealignInput = {
  mgmt_type: string | null;
  real_qty: number;
  reserved_qty: number;
  shop_qty: number | null;
  shop_price: number | null;
  vat_rate: number | null;
  sale_price_ht: number | null;
  sale_price_ttc: number | null;
  price_sale_locked: boolean;
  links_of_article: number;
};

export type RealignPlan = {
  stock_change: boolean;
  stock_delta: number;
  stock_after: number;
  price_change: boolean;
  ht_after: number | null;
  ttc_after: number | null;
  notes: string[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** PV HT tiré d'un prix TVA comprise, au centime (taux absent : 21 %). */
export function htFromTtc(ttc: number, vatRate: number | null | undefined): number {
  const rate = vatRate == null || !Number.isFinite(Number(vatRate)) ? 21 : Number(vatRate);
  return round2(ttc / (1 + rate / 100));
}

const STOCK_TYPES = ['A', 'V', 'O', 'P', 'D'];

export function planRealign(a: RealignInput): RealignPlan {
  const notes: string[] = [];
  let stockDelta = 0;
  let stockAfter = a.real_qty;
  let htAfter = a.sale_price_ht;
  let ttcAfter = a.sale_price_ttc;
  let priceChange = false;

  if (a.links_of_article > 1) {
    notes.push('article relié à plusieurs produits du site : non traité');
    return { stock_change: false, stock_delta: 0, stock_after: stockAfter, price_change: false, ht_after: htAfter, ttc_after: ttcAfter, notes };
  }

  if (!STOCK_TYPES.includes(String(a.mgmt_type ?? ''))) notes.push('type de gestion sans stock suivi');
  else if (a.shop_qty == null) notes.push('stock Shopify inconnu : relire Shopify');
  else {
    const target = Math.max(a.shop_qty, 0);
    if (a.shop_qty < 0) notes.push('stock Shopify négatif : ramené à 0');
    stockDelta = target - a.real_qty;
    if (stockDelta !== 0) stockAfter = target;
    if (a.reserved_qty !== 0) notes.push('réservé dans le DMS : le site recevra réel − réservé');
  }

  if (a.shop_price == null || !(a.shop_price > 0)) notes.push('pas de prix sur le site : prix du DMS inchangé');
  else if (a.mgmt_type === 'O') notes.push('occasion TVA marge : prix non repris');
  else if (a.price_sale_locked) notes.push('prix de vente verrouillé : non modifié');
  else {
    const ttc = round2(a.shop_price);
    const ht = htFromTtc(a.shop_price, a.vat_rate);
    priceChange = a.sale_price_ht == null || Math.abs(a.sale_price_ht - ht) >= 0.005
      || a.sale_price_ttc == null || Math.abs(a.sale_price_ttc - ttc) >= 0.005;
    if (priceChange) { htAfter = ht; ttcAfter = ttc; }
  }

  return { stock_change: stockDelta !== 0, stock_delta: stockDelta, stock_after: stockAfter, price_change: priceChange, ht_after: htAfter, ttc_after: ttcAfter, notes };
}
