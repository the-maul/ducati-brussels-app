/**
 * Tests M1 / M6 — tarifs clients et cases client a la vente (rattrapage G8 du 18/11/2026).
 *  - tarif commun « REMISE 15 % » partage, tarif de base, paliers, dates, coefficient, prix net ;
 *  - priorite : regle du client > tarif du client > tarif de base > regle generale > catalogue ;
 *  - « afficher la remise » (tarif) et « afficher remises en caisse » (client) ;
 *  - client bloque, detaxe, mode HT, encours autorise, conditions de reglement, exemplaires.
 */
import { test, expect, describe } from 'bun:test';
import {
  resolveSalePrice, tierFor, cleanTiers, priceListChain, clientPriceListId, fromPriceListRule, fromCustomerPriceRule,
  fromClientPriceRule, isBlockedSale, clientPriceDefaults, creditCheck, creditRefuses, dueDateFromTerms, receiptCopies,
  type PricingRule, type PricingArticle,
} from '../src/modules/sales/customer-pricing';
import { parsePriceListSheet } from '../src/modules/sales/price-list-import';

const art: PricingArticle = { id: 'a1', reference: '96780010A', categoryId: 'cat1', categoryPath: 'R12-03-69', supplierId: 's1', brand: 'DUCATI', purchasePrice: 40 };
const D = '2026-11-18';
const list15 = { id: 'L15', code: '15', label: 'REMISE 15 %', base_list_id: null, is_promo: false, show_discount: true, is_active: true };
const rule = (p: Partial<PricingRule>): PricingRule => ({ id: 'r', source: 'list', depth: 1, scope: 'all', kind: 'discount', tiers: [{ min_qty: 1, value: 15 }], ...p });

describe('resolveSalePrice — tarif commun', () => {
  test('sans regle : prix catalogue', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, date: D, rules: [] });
    expect(r).toMatchObject({ unitPriceHt: 100, discountPct: 0, netHt: 100, rule: null });
  });
  test('REMISE 15 % sur tout le catalogue, remise affichee : PU catalogue + 15 %', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, date: D, rules: [rule({ listCode: '15' })] });
    expect(r.unitPriceHt).toBe(100);
    expect(r.discountPct).toBe(15);
    expect(r.netHt).toBe(85);
    expect(r.listCode).toBe('15');
  });
  test('remise non affichee (tarif) : prix net sur la ligne', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, date: D, rules: [rule({ showDiscount: false })] });
    expect(r).toMatchObject({ unitPriceHt: 85, discountPct: 0 });
  });
  test('client « afficher remises en caisse » decoche : prix net meme si le tarif affiche', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, date: D, rules: [rule({})], showDiscounts: false });
    expect(r).toMatchObject({ unitPriceHt: 85, discountPct: 0 });
  });
  test('coefficient : PV HT = PA x coef (prix net)', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, date: D, rules: [rule({ kind: 'coefficient', tiers: [{ min_qty: 1, value: 1.8 }] })] });
    expect(r).toMatchObject({ unitPriceHt: 72, discountPct: 0, netHt: 72 });
  });
  test('coefficient sans PA : la regle ne donne pas de prix, on passe a la suivante', () => {
    const r = resolveSalePrice({ article: { ...art, purchasePrice: 0 }, baseHt: 100, date: D, rules: [rule({ kind: 'coefficient', tiers: [{ min_qty: 1, value: 1.8 }] }), rule({ id: 'r2', depth: 2 })] });
    expect(r.rule?.id).toBe('r2');
    expect(r.netHt).toBe(85);
  });
  test('prix net fixe', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, date: D, rules: [rule({ scope: 'reference', articleId: 'a1', kind: 'net', tiers: [{ min_qty: 1, value: 79.9 }] })] });
    expect(r).toMatchObject({ unitPriceHt: 79.9, discountPct: 0 });
  });
});

describe('paliers de quantite (4 tranches)', () => {
  const tiers = [{ min_qty: 1, value: 5 }, { min_qty: 5, value: 10 }, { min_qty: 10, value: 15 }, { min_qty: 50, value: 20 }];
  test('le palier le plus haut atteint', () => {
    expect(tierFor(tiers, 1)?.value).toBe(5);
    expect(tierFor(tiers, 4)?.value).toBe(5);
    expect(tierFor(tiers, 5)?.value).toBe(10);
    expect(tierFor(tiers, 49)?.value).toBe(15);
    expect(tierFor(tiers, 200)?.value).toBe(20);
  });
  test('quantite sous le premier palier (« Qte mini ») : la regle ne s applique pas', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, qty: 2, date: D, rules: [rule({ tiers: [{ min_qty: 5, value: 10 }] })] });
    expect(r.rule).toBeNull();
    expect(r.unitPriceHt).toBe(100);
  });
  test('4 paliers au plus, tries, sans doublon ni valeur negative', () => {
    expect(cleanTiers([{ min_qty: 10, value: 3 }, { min_qty: 1, value: 1 }, { min_qty: 1, value: 9 }, { min_qty: 2, value: -1 }, { min_qty: 3, value: 2 }, { min_qty: 4, value: 2 }, { min_qty: 5, value: 2 }]))
      .toEqual([{ min_qty: 1, value: 1 }, { min_qty: 3, value: 2 }, { min_qty: 4, value: 2 }, { min_qty: 5, value: 2 }]);
  });
});

describe('dates de debut / fin, promotion', () => {
  test('hors dates : ignoree', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, date: D, rules: [rule({ dateFrom: '2026-12-01' }), rule({ id: 'old', dateTo: '2026-11-17' })] });
    expect(r.rule).toBeNull();
  });
  test('dans les dates (bornes comprises) + promotion signalee', () => {
    const r = resolveSalePrice({ article: art, baseHt: 100, date: D, rules: [rule({ dateFrom: D, dateTo: D, isPromo: true })] });
    expect(r.discountPct).toBe(15);
    expect(r.isPromo).toBe(true);
  });
});

describe('portee et priorite', () => {
  test('reference > famille > fournisseur > marque > tout, dans le meme tarif', () => {
    const rules = [
      rule({ id: 'all', scope: 'all', tiers: [{ min_qty: 1, value: 5 }] }),
      rule({ id: 'brand', scope: 'brand', brand: 'ducati', tiers: [{ min_qty: 1, value: 6 }] }),
      rule({ id: 'sup', scope: 'supplier', supplierId: 's1', tiers: [{ min_qty: 1, value: 7 }] }),
      rule({ id: 'fam', scope: 'family', familyCode: 'r12', tiers: [{ min_qty: 1, value: 8 }] }),
      rule({ id: 'ref', scope: 'reference', articleId: 'a1', tiers: [{ min_qty: 1, value: 9 }] }),
    ];
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules }).rule?.id).toBe('ref');
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules: rules.filter((r) => r.id !== 'ref') }).rule?.id).toBe('fam');
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules: rules.filter((r) => !['ref', 'fam'].includes(r.id)) }).rule?.id).toBe('sup');
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules: rules.filter((r) => ['brand', 'all'].includes(r.id)) }).rule?.id).toBe('brand');
  });
  test('famille la plus longue d abord', () => {
    const rules = [rule({ id: 'r12', scope: 'family', familyCode: 'R12' }), rule({ id: 'r1203', scope: 'family', familyCode: 'R12-03' })];
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules }).rule?.id).toBe('r1203');
  });
  test('famille / fournisseur / marque d un autre article : ignores', () => {
    const rules = [rule({ scope: 'family', familyCode: 'R13' }), rule({ id: 'x', scope: 'supplier', supplierId: 's2' }), rule({ id: 'y', scope: 'brand', brand: 'RIZOMA' })];
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules }).rule).toBeNull();
  });
  test('regle du client > tarif du client > tarif de base > regle generale', () => {
    const rules = [
      rule({ id: 'global', source: 'global', depth: 99, tiers: [{ min_qty: 1, value: 1 }] }),
      rule({ id: 'base', depth: 2, tiers: [{ min_qty: 1, value: 2 }] }),
      rule({ id: 'list', depth: 1, scope: 'family', familyCode: 'R99', tiers: [{ min_qty: 1, value: 3 }] }),
      rule({ id: 'client', source: 'client', depth: 0, scope: 'brand', brand: 'DUCATI', tiers: [{ min_qty: 1, value: 4 }] }),
    ];
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules }).rule?.id).toBe('client');
    // sans la regle du client : la famille R99 ne vise pas l article, on descend au tarif de base
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules: rules.filter((r) => r.id !== 'client') }).rule?.id).toBe('base');
    expect(resolveSalePrice({ article: art, baseHt: 100, date: D, rules: rules.filter((r) => ['global'].includes(r.id)) }).rule?.id).toBe('global');
  });
});

describe('tarif commun partage et tarif de base', () => {
  const base = { id: 'LB', code: 'BASE', label: 'Base pro', base_list_id: null, is_promo: false, show_discount: false, is_active: true };
  const child = { ...list15, base_list_id: 'LB' };
  test('chaine : tarif du client puis sa base', () => {
    expect(priceListChain([base, child], 'L15').map((l) => [l.code, l.depth])).toEqual([['15', 1], ['BASE', 2]]);
  });
  test('boucle coupee, tarif inactif saute', () => {
    const a = { ...list15, base_list_id: 'LB' }, b = { ...base, base_list_id: 'L15', is_active: false };
    expect(priceListChain([a, b], 'L15').map((l) => l.code)).toEqual(['15']);
  });
  test('tarif de la fiche, sinon texte repris de G8 (code puis libelle)', () => {
    expect(clientPriceListId({ price_list_id: 'L15' }, [list15])).toBe('L15');
    expect(clientPriceListId({ price_list: '15' }, [list15])).toBe('L15');
    expect(clientPriceListId({ price_list: 'remise 15 %' }, [list15])).toBe('L15');
    expect(clientPriceListId({ price_list: 'AUTRE' }, [list15])).toBeNull();
  });
  test('ligne de tarif normalisee : profondeur, code, promotion, remise affichee du tarif', () => {
    const r = fromPriceListRule({ id: 'x', price_list_id: 'LB', scope: 'all', kind: 'discount', tiers: [{ min_qty: 1, value: 10 }] }, { ...base, depth: 2 });
    expect(r).toMatchObject({ depth: 2, listCode: 'BASE', showDiscount: false, source: 'list' });
  });
});

describe('anciennes regles par client (deux tables) : lues aussi', () => {
  test('customer_price_rules : remise, paliers, coefficient, regle generale', () => {
    expect(fromCustomerPriceRule({ id: '1', contact_id: 'c1', kind: 'discount_pct', value: 12 }, 'c1')).toMatchObject({ depth: 0, kind: 'discount', tiers: [{ min_qty: 1, value: 12 }] });
    expect(fromCustomerPriceRule({ id: '2', contact_id: 'c1', kind: 'quantity_tiers', tiers: [{ min_qty: 5, discount_pct: 10 }, { min_qty: 1, discount_pct: 0 }] }, 'c1')?.tiers)
      .toEqual([{ min_qty: 1, value: 0 }, { min_qty: 5, value: 10 }]);
    expect(fromCustomerPriceRule({ id: '3', contact_id: null, article_id: 'a1', kind: 'coefficient', value: 2 }, 'c1')).toMatchObject({ depth: 99, scope: 'reference', kind: 'coefficient' });
    expect(fromCustomerPriceRule({ id: '4', contact_id: 'autre', kind: 'discount_pct', value: 12 }, 'c1')).toBeNull();
    expect(fromCustomerPriceRule({ id: '5', contact_id: 'c1', kind: 'discount_pct', value: 12, is_active: false }, 'c1')).toBeNull();
  });
  test('client_price_rules (onglet Tarifs) : 3 paliers, dates, promotion, prix net par reference', () => {
    const r = fromClientPriceRule({ id: 'x', target_type: 'reference', target_value: '96780010a', mode: 'net', value1: 50, qty2: 10, value2: 45, is_promo: true, date_from: '2026-01-01' });
    expect(r).toMatchObject({ scope: 'reference', reference: '96780010a', kind: 'net', isPromo: true, dateFrom: '2026-01-01' });
    expect(r?.tiers).toEqual([{ min_qty: 1, value: 50 }, { min_qty: 10, value: 45 }]);
    const p = resolveSalePrice({ article: art, baseHt: 100, qty: 12, date: D, rules: [r!] });
    expect(p.unitPriceHt).toBe(45);
    expect(fromClientPriceRule({ id: 'y', target_type: 'category', target_value: 'R12', mode: 'discount', value1: 5 })).toMatchObject({ scope: 'family', familyCode: 'R12' });
  });
});

describe('cases client a la vente', () => {
  test('client bloque : facture, ticket, reservation, BL, BC refuses ; devis et avoir permis', () => {
    for (const d of ['FAC', 'TIK', 'RES', 'BL', 'BC']) expect(isBlockedSale({ is_blocked: true }, d)).toBe(true);
    for (const d of ['DEV', 'AVO']) expect(isBlockedSale({ is_blocked: true }, d)).toBe(false);
    expect(isBlockedSale({ is_blocked: false }, 'FAC')).toBe(false);
  });
  test('detaxe => HT + TVA 0 % ; mode HT => saisie HT ; sinon rien', () => {
    expect(clientPriceDefaults({ is_detaxe: true, mode_ht: false })).toEqual({ priceMode: 'ht', taxExempt: true });
    expect(clientPriceDefaults({ mode_ht: true })).toEqual({ priceMode: 'ht', taxExempt: false });
    expect(clientPriceDefaults({})).toBeNull();
  });
  test('encours autorise : alerte, blocage seulement si la case est cochee et pour une vente a credit', () => {
    const alert = creditCheck({ credit_limit: 1000 }, 800, 300);
    expect(alert).toMatchObject({ exceeded: true, blocking: false, total: 1100 });
    const block = creditCheck({ credit_limit: 1000, credit_limit_blocking: true }, 800, 300);
    expect(block.blocking).toBe(true);
    expect(creditRefuses(block, 'FAC')).toBe(true);
    expect(creditRefuses(block, 'DEV')).toBe(false);
    expect(creditCheck({ credit_limit: 1000, credit_limit_blocking: true }, 800, 200).exceeded).toBe(false);
    expect(creditCheck({ credit_limit: 0, credit_limit_blocking: true }, 99999, 1).exceeded).toBe(false);
  });
  test('conditions de reglement -> echeance', () => {
    expect(dueDateFromTerms('30j', '2026-11-18')).toBe('2026-12-18');
    expect(dueDateFromTerms('30 jours fin de mois', '2026-11-18')).toBe('2026-12-31');
    expect(dueDateFromTerms('immediat', '2026-11-18')).toBe('2026-11-18');
    expect(dueDateFromTerms('Paiement comptant', '2026-11-18')).toBe('2026-11-18');
    expect(dueDateFromTerms('', '2026-11-18')).toBeNull();
    expect(dueDateFromTerms('selon accord', '2026-11-18')).toBeNull();
  });
  test('exemplaires du ticket : 0 = 1, plafonne a 5', () => {
    expect(receiptCopies({ receipt_copies: 0 })).toBe(1);
    expect(receiptCopies({ receipt_copies: 2 })).toBe(2);
    expect(receiptCopies({ receipt_copies: 40 })).toBe(5);
    expect(receiptCopies(null)).toBe(1);
  });
});

describe('import fichier d un tarif', () => {
  test('colonnes reconnues, paliers regroupes par reference, lignes en erreur listees', () => {
    const rows = [
      ['Reference', 'Remise %', 'Qte mini', 'Date debut', 'Date fin'],
      ['96780010A', '10', '1', '2026-01-01', ''],
      ['96780010A', '15', '10', '', ''],
      ['ABC', '', '', '', ''],
      ['XYZ', '5', '', '18/11/2026', '31/12/2026'],
    ];
    const r = parsePriceListSheet(rows);
    expect(r.errors.map((e) => e.row)).toEqual([4]);
    expect(r.rules).toHaveLength(2);
    expect(r.rules[0]).toMatchObject({ reference: '96780010A', kind: 'discount', tiers: [{ min_qty: 1, value: 10 }, { min_qty: 10, value: 15 }], date_from: '2026-01-01' });
    expect(r.rules[1]).toMatchObject({ reference: 'XYZ', date_from: '2026-11-18', date_to: '2026-12-31' });
  });
  test('prix net et coefficient', () => {
    const r = parsePriceListSheet([['Ref', 'Prix net HT', 'Coefficient'], ['A1', '12,50', ''], ['A2', '', '1,9']]);
    expect(r.rules[0]).toMatchObject({ kind: 'net', tiers: [{ min_qty: 1, value: 12.5 }] });
    expect(r.rules[1]).toMatchObject({ kind: 'coefficient', tiers: [{ min_qty: 1, value: 1.9 }] });
  });
  test('sans colonne reference : erreur claire', () => {
    expect(parsePriceListSheet([['Remise'], ['10']]).missingReference).toBe(true);
  });
});
