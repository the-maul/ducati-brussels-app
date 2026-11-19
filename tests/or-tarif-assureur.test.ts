/**
 * T4 (lot accident-expert, 19/11/2026) : sur un OR accident, le tarif du cabinet d'assurance
 * s'applique automatiquement aux lignes (pieces et MO) a la place de celui du client, par la
 * fonction unique de prix des lignes d'OR et le moteur unique des tarifs (customer-pricing.ts).
 */
import { describe, expect, test } from 'bun:test';
import {
  resolveSalePrice, fromPriceListRule, fromClientPriceRule, clientPriceListId, priceListChain, LABOUR_PRICING_REFERENCE,
  type PricingRule, type PriceListRow,
} from '../src/modules/sales/customer-pricing';
import {
  insurerRepriceNeeded, isPriceableLine, lineBaseHt, priceOrLine, repriceOrLines, type OrLinePricer, type PriceableLine,
} from '../src/modules/workshop/or-line-pricing';

const DATE = '2026-11-19';
const CLIENT: PriceListRow = { id: 'l-client', code: '15', label: 'REMISE 15 %', is_active: true, show_discount: true };
const INSURER: PriceListRow = { id: 'l-assu', code: 'ASSU', label: 'TARIF ASSUREUR', is_active: true, show_discount: true };
const INSURER_NET: PriceListRow = { id: 'l-assu-net', code: 'ASSUNET', label: 'ASSUREUR PRIX NET', is_active: true, show_discount: false };
const LISTS = [CLIENT, INSURER, INSURER_NET];

const listRules = (list: PriceListRow, pct: number): PricingRule[] => {
  const [l] = priceListChain(LISTS, list.id);
  const r = fromPriceListRule({ id: `r-${list.id}`, price_list_id: list.id, scope: 'all', kind: 'discount', tiers: [{ min_qty: 1, value: pct }] }, l);
  return r ? [r] : [];
};

/** Meme contrat que CustomerPricer : le tarif du cabinet REMPLACE celui du client sur l'OR accident. */
function pricer(rules: PricingRule[]): OrLinePricer {
  return {
    price: async (articleId, baseHt, qty) => resolveSalePrice({ article: { id: articleId }, baseHt, qty, date: DATE, rules }),
    priceLabour: async (baseHt, qty) => resolveSalePrice({ article: { id: '', reference: LABOUR_PRICING_REFERENCE }, baseHt, qty, date: DATE, rules }),
  };
}

const lines: (PriceableLine & { designation: string })[] = [
  { kind: 'piece', article_id: 'a-carenage', designation: 'Carenage', quantity: 1, unit_price_ht: 85, discount_pct: 0 },
  { kind: 'mo', article_id: null, designation: 'MO carrosserie', quantity: 2, unit_price_ht: 109.74, discount_pct: 15 },
  { kind: 'texte', article_id: null, designation: 'Constat amiable recu', quantity: 1, unit_price_ht: 0, discount_pct: 0 },
  { kind: 'piece', article_id: null, designation: 'Piece libre', quantity: 1, unit_price_ht: 12, discount_pct: 0 },
];
const bases = { articleBaseHt: new Map([['a-carenage', 100]]), labourRateHt: 109.74 };

describe('T4 — tarif du cabinet d\'assurance sur les lignes de l\'OR accident', () => {
  test('le tarif du cabinet se retrouve par son id (lien) ou par son ancien code texte', () => {
    expect(clientPriceListId({ price_list_id: 'l-assu', price_list: 'l-assu' }, LISTS)).toBe('l-assu');
    expect(clientPriceListId({ price_list_id: 'ASSU', price_list: 'assu' }, LISTS)).toBe('l-assu');
    expect(clientPriceListId({ price_list_id: 'TARIF ASSUREUR', price_list: 'TARIF ASSUREUR' }, LISTS)).toBe('l-assu');
    expect(clientPriceListId({ price_list_id: 'inconnu', price_list: 'inconnu' }, LISTS)).toBeNull();
  });

  test('pieces et MO prennent la remise de l\'assureur (25 %) au lieu de celle du client (15 %)', async () => {
    const r = await repriceOrLines(lines, pricer(listRules(INSURER, 25)), bases);
    expect(r.lines[0]).toMatchObject({ unit_price_ht: 100, discount_pct: 25 });
    expect(r.lines[1]).toMatchObject({ unit_price_ht: 109.74, discount_pct: 25 });
    expect(r.changed).toBe(2);
  });

  test('texte et piece libre (sans article) ne sont jamais touches', async () => {
    const r = await repriceOrLines(lines, pricer(listRules(INSURER, 25)), bases);
    expect(r.lines[2]).toBe(lines[2]);
    expect(r.lines[3]).toBe(lines[3]);
    expect(isPriceableLine(lines[2])).toBe(false);
    expect(isPriceableLine(lines[3])).toBe(false);
  });

  test('tarif assureur sans « afficher la remise » : prix net sur la ligne', async () => {
    const r = await repriceOrLines(lines, pricer(listRules(INSURER_NET, 20)), bases);
    expect(r.lines[0]).toMatchObject({ unit_price_ht: 80, discount_pct: 0 });
    expect(r.lines[1]).toMatchObject({ unit_price_ht: 87.79, discount_pct: 0 });
  });

  test('cabinet retire : retour au tarif du client (15 %), sans tarif du tout : prix catalogue', async () => {
    const back = await repriceOrLines(lines, pricer(listRules(CLIENT, 15)), bases);
    expect(back.lines[0]).toMatchObject({ unit_price_ht: 100, discount_pct: 15 });
    const none = await repriceOrLines(lines, pricer([]), bases);
    expect(none.lines[0]).toMatchObject({ unit_price_ht: 100, discount_pct: 0 });
    expect(none.lines[1]).toMatchObject({ unit_price_ht: 109.74, discount_pct: 0 });
  });

  test('MO sans article : base = taux de l\'atelier, a defaut le prix saisi ; une regle MO_ATELIER (ex. VIP 90) s\'applique', async () => {
    expect(lineBaseHt(lines[1], bases)).toBe(109.74);
    expect(lineBaseHt(lines[1], { articleBaseHt: new Map(), labourRateHt: null })).toBe(109.74);
    const vip = fromClientPriceRule({ id: 'vip', target_type: 'reference', target_value: 'MO_ATELIER', mode: 'net', value1: 90 });
    const r = await priceOrLine(pricer(vip ? [vip] : []), lines[1], 109.74);
    expect(r).toMatchObject({ unit_price_ht: 90, discount_pct: 0, ruled: true });
    // La regle MO ne touche pas les pieces.
    const p = await priceOrLine(pricer(vip ? [vip] : []), lines[0], 100);
    expect(p).toMatchObject({ unit_price_ht: 100, ruled: false });
  });

  test('re-tarifage seulement quand le tarif assureur effectif change, jamais sur un OR facture', () => {
    expect(insurerRepriceNeeded({ applied: null, effective: 'l-assu', invoiced: false })).toBe(true);
    expect(insurerRepriceNeeded({ applied: 'l-assu', effective: null, invoiced: false })).toBe(true);
    expect(insurerRepriceNeeded({ applied: 'l-assu', effective: 'l-assu', invoiced: false })).toBe(false);
    expect(insurerRepriceNeeded({ applied: null, effective: null, invoiced: false })).toBe(false);
    expect(insurerRepriceNeeded({ applied: null, effective: 'l-assu', invoiced: true })).toBe(false);
    // Migration absente (colonne inconnue) : rien.
    expect(insurerRepriceNeeded({ applied: undefined, effective: 'l-assu', invoiced: false })).toBe(false);
  });
});
