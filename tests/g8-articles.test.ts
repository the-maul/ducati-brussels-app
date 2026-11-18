/**
 * M2 — Rattrapage G8 (18/11/2026) : règles pures des outils de prix, de la cascade et des
 * microfiches. Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  priceIndicators, resolveFamilyRounding, roundWithTranches, roundingChange, familyPrefix,
  bracketChange, findBracket, ppcChange, type FamilyRoundingRule, type PriceBracket,
} from '../src/modules/articles/g8/pricing-tools';
import { parseMicrofiche, normalizeRef } from '../src/modules/articles/g8/microfiche';
import { CASCADE_ACTIONS, cascadeAction, cascadePayload } from '../src/modules/articles/g8/cascade-actions';
import { computeTotals } from '../src/modules/sales/write-api';
import { diffRow, type ExistingArticle } from '../src/modules/articles/import/rules';

describe('indicateurs de prix de la fiche (G8 bloc Prix)', () => {
  test('coefficients, ecart PV / PPC, marge et taux de marque sur PA et PAMP', () => {
    const r = priceIndicators({ pa: 25, pamp: 20, pvHt: 50, pvTtc: 60.5, ppcHt: 55, ppcTtc: 66.55 });
    expect(r.coefTtc).toBe(2.42);
    expect(r.coefHt).toBe(2);
    expect(r.coefPpc).toBe(2.662);
    expect(r.pvPpcPct).toBe(-9.09);
    expect(r.marginPa).toBe(25);
    expect(r.marginPamp).toBe(30);
    expect(r.markRatePa).toBe(50);   // marge / PV HT
    expect(r.markRatePamp).toBe(60);
    expect(r.markupPa).toBe(100);    // marge / PA
  });
  test('sans PA ni PPC : pas de division par zero', () => {
    const r = priceIndicators({ pa: 0, pamp: 0, pvHt: 10, pvTtc: 12.1, ppcTtc: null });
    expect(r.coefTtc).toBeNull();
    expect(r.pvPpcPct).toBeNull();
    expect(r.markRatePa).toBeNull();
  });
});

describe('arrondis par fournisseur x famille x tranche', () => {
  const rules: FamilyRoundingRule[] = [
    { supplier_id: null, category_prefix: null, up_to: 10, step: 0.1, mode: 'up' },
    { supplier_id: null, category_prefix: null, up_to: 0, step: 1, mode: 'up' },
    { supplier_id: null, category_prefix: '03', up_to: 0, step: 5, mode: 'up' },
    { supplier_id: 'duc', category_prefix: '03-02', up_to: 50, step: 0.5, mode: 'nearest' },
    { supplier_id: 'duc', category_prefix: '03-02', up_to: 0, step: 10, mode: 'up' },
  ];
  test('le groupe le plus precis gagne, puis la tranche', () => {
    expect(resolveFamilyRounding(rules, { supplierId: 'duc', categoryPath: '03-02-01' }).map((r) => r.step)).toEqual([0.5, 10]);
    expect(resolveFamilyRounding(rules, { supplierId: 'x', categoryPath: '03-02-01' }).map((r) => r.step)).toEqual([5]);
    expect(resolveFamilyRounding(rules, { supplierId: null, categoryPath: '02-01-01' }).map((r) => r.step)).toEqual([0.1, 1]);
    // « 031 » n'est pas la famille « 03 »
    expect(resolveFamilyRounding(rules, { categoryPath: '031-01' }).map((r) => r.step)).toEqual([0.1, 1]);
  });
  test('arrondi au pas de la tranche (en centimes, sans flottant)', () => {
    const t = resolveFamilyRounding(rules, { categoryPath: '02' });
    expect(roundWithTranches(9.21, t)).toBe(9.3);
    expect(roundWithTranches(10, t)).toBe(10);
    expect(roundWithTranches(10.01, t)).toBe(11);
    const d = resolveFamilyRounding(rules, { supplierId: 'duc', categoryPath: '03-02' });
    expect(roundWithTranches(12.2, d)).toBe(12);    // plus proche
    expect(roundWithTranches(51, d)).toBe(60);
  });
  test('changement propose : PV HT et coefficient suivent, rien si deja rond', () => {
    const c = roundingChange({ id: 'a', sale_price_ttc: 9.21, vat_rate: 21, purchase_price: 4, category_path: '02-01' }, rules);
    expect(c).toEqual({ id: 'a', sale_ttc: 9.3, sale_ht: 7.686, coef: 1.9215 });
    expect(roundingChange({ id: 'a', sale_price_ttc: 9.3, vat_rate: 21, purchase_price: 4, category_path: '02-01' }, rules)).toBeNull();
    expect(roundingChange({ id: 'a', sale_price_ttc: 9.21, vat_rate: 21, purchase_price: 4 }, [])).toBeNull();
  });
  test('prefixe de famille depuis les 3 niveaux', () => {
    expect(familyPrefix('03', '02', '')).toBe('03-02');
    expect(familyPrefix('', '02', '01')).toBeNull();
    expect(familyPrefix('01', '01', '01')).toBe('01-01-01');
  });
});

describe('recalcul PA / PV par tranches', () => {
  const brackets: PriceBracket[] = [
    { from: 0, to: 10, paPct: 5, pvPct: 10, coef: 2.5 },
    { from: 10.01, to: 100, paPct: 3, pvPct: 0, coef: 1.8 },
    { from: 100.01, to: null, paPct: 0, pvPct: 2, coef: 1.5 },
  ];
  test('tranche trouvee par le PA', () => {
    expect(findBracket(5, brackets)?.coef).toBe(2.5);
    expect(findBracket(250, brackets)?.coef).toBe(1.5);
    expect(findBracket(10.005, brackets)).toBeNull();
  });
  test('mode taux : % sur PA et % sur PV', () => {
    const c = bracketChange({ id: 'a', purchase_price: 8, sale_price_ttc: 20, vat_rate: 21 }, 'rate', brackets);
    expect(c).toEqual({ id: 'a', purchase: 8.4, sale_ttc: 22, sale_ht: 18.182, coef: 2.1645 });
  });
  test('mode taux : PA seul, le PV ne bouge pas', () => {
    const c = bracketChange({ id: 'a', purchase_price: 50, sale_price_ttc: 121, vat_rate: 21 }, 'rate', brackets);
    expect(c).toEqual({ id: 'a', purchase: 51.5, coef: 1.9417 });
  });
  test('mode coefficient : PV HT = PA x coef', () => {
    const c = bracketChange({ id: 'a', purchase_price: 50, sale_price_ttc: 100, vat_rate: 21 }, 'coef', brackets);
    expect(c).toEqual({ id: 'a', sale_ttc: 108.9, sale_ht: 90, coef: 1.8 });
  });
  test('verrous G8 respectes', () => {
    expect(bracketChange({ id: 'a', purchase_price: 50, sale_price_ttc: 100, vat_rate: 21, price_sale_locked: true }, 'coef', brackets)).toBeNull();
    const c = bracketChange({ id: 'a', purchase_price: 8, sale_price_ttc: 20, vat_rate: 21, price_purchase_locked: true }, 'rate', brackets);
    expect(c?.purchase).toBeUndefined();
    expect(c?.sale_ttc).toBe(22);
  });
  test('arrondi applique au nouveau PV', () => {
    const c = bracketChange({ id: 'a', purchase_price: 50, sale_price_ttc: 100, vat_rate: 21 }, 'coef', brackets, (v) => Math.ceil(v));
    expect(c?.sale_ttc).toBe(109);
  });
});

describe('PV selon PPC sur les articles existants', () => {
  const rules = [
    { supplier_name: 'DUCATI', category_path: null, brand: null, pct: -10, round_mode: 'ceil_1' as const },
    { supplier_name: null, category_path: '03', brand: null, pct: 0 },
  ];
  test('regle du fournisseur, arrondi', () => {
    const c = ppcChange({ id: 'a', ppc_ttc: 100, sale_price_ttc: 95, vat_rate: 21, purchase_price: 40, supplier_name: 'Ducati' }, rules);
    expect(c?.sale_ttc).toBe(90);
  });
  test('PV verrouille, sans PPC, deja au bon prix : rien', () => {
    expect(ppcChange({ id: 'a', ppc_ttc: 100, sale_price_ttc: 95, vat_rate: 21, purchase_price: 40, supplier_name: 'Ducati', price_sale_locked: true }, rules)).toBeNull();
    expect(ppcChange({ id: 'a', ppc_ttc: null, sale_price_ttc: 95, vat_rate: 21, purchase_price: 40, supplier_name: 'Ducati' }, rules)).toBeNull();
    expect(ppcChange({ id: 'a', ppc_ttc: 50, sale_price_ttc: 50, vat_rate: 21, purchase_price: 20, category_path: '03-01' }, rules)).toBeNull();
  });
});

describe('microfiches (ligne ; reference ; quantite)', () => {
  test('3 colonnes, en-tete ignore, virgule decimale, cumul des doublons', () => {
    const r = parseMicrofiche('Ligne;Référence;Quantité\n1;96480471A;2\n2;77140677CF;1,5\n3;96480471a;1\n');
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { line: 1, reference: '96480471A', quantity: 3 },
      { line: 2, reference: '77140677CF', quantity: 1.5 },
    ]);
  });
  test('2 colonnes, tabulation, quantite absente = 1, erreurs signalees', () => {
    const r = parseMicrofiche('ABC\t4\nDEF\n;3\nGHI;-2');
    expect(r.lines.map((l) => [l.reference, l.quantity])).toEqual([['ABC', 4], ['DEF', 1]]);
    expect(r.errors.map((e) => e.reason)).toEqual(['no_reference', 'bad_quantity']);
  });
  test('normalisation de reference', () => {
    expect(normalizeRef(' 964 80471a ')).toBe('96480471A');
  });
});

describe('cascade : actions G8', () => {
  test('23 actions G8 (sans nomenclature) + recalculs + librairie + suppression', () => {
    expect(CASCADE_ACTIONS.length).toBe(29);
    expect(new Set(CASCADE_ACTIONS.map((a) => a.key)).size).toBe(CASCADE_ACTIONS.length);
    expect(cascadeAction('pv_from_ppc')?.price).toBe(true);
  });
  test('saisie validee avant envoi', () => {
    expect(cascadePayload(cascadeAction('set_price')!, { value: 'abc' })).toEqual({ ok: false, error: 'g8a.cascade.errNumber' });
    expect(cascadePayload(cascadeAction('set_price')!, { value: '12,5' })).toEqual({ ok: true, value: { value: '12.5' } });
    expect(cascadePayload(cascadeAction('set_stock_min_max')!, {})).toEqual({ ok: false, error: 'g8a.cascade.errMinMax' });
    expect(cascadePayload(cascadeAction('set_bin')!, { value: ' A12 ' })).toEqual({ ok: true, value: { value: 'A12' } });
    expect(cascadePayload(cascadeAction('set_family')!, { value: '' }).ok).toBe(false);
  });
});

describe('hors remise pied de page (G8)', () => {
  test('la remise globale ne touche pas une ligne hors remise', () => {
    const lines = [
      { designation: 'A', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0 },
      { designation: 'B', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, no_footer_discount: true },
    ];
    const t = computeTotals(lines, { globalDiscountPct: 10 });
    expect(t.global_discount).toBe(10);
    expect(t.total_ht).toBe(190);
    expect(t.total_ttc).toBe(229.9);
  });
  test('remise en montant plafonnee aux lignes remisables', () => {
    const lines = [
      { designation: 'A', quantity: 1, unit_price_ht: 20, vat_rate: 21, discount_pct: 0 },
      { designation: 'B', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, no_footer_discount: true },
    ];
    const t = computeTotals(lines, { globalDiscountAmount: 50 });
    expect(t.global_discount).toBe(20);
    expect(t.total_ht).toBe(100);
  });
  test('sans drapeau : comportement inchange', () => {
    const lines = [{ designation: 'A', quantity: 2, unit_price_ht: 50, vat_rate: 21, discount_pct: 0 }];
    expect(computeTotals(lines, { globalDiscountPct: 10 }).total_ht).toBe(90);
  });
});

describe('import de tarif : verrous G8 de la designation et du PV', () => {
  const base: ExistingArticle = {
    id: 'a1', reference: 'REF1', designation: 'Ancienne', brand: 'Ducati', category_path: null, supplier_ref: null,
    purchase_price: 10, sale_price_ttc: 100, coefficient: 2, superseded_by_id: null, is_library: false,
  };
  test('designation verrouillee : conservee, signalee', () => {
    const r = diffRow({ reference: 'REF1', rowIndex: 1, designation: 'Nouvelle' }, { ...base, designation_locked: true });
    expect(r.patch.designation).toBeUndefined();
    expect(r.anomalies).toContain('Désignation verrouillée : conservée.');
  });
  test('PV verrouille : conserve meme en hausse', () => {
    const r = diffRow({ reference: 'REF1', rowIndex: 1, sale_price_ttc: 150 }, { ...base, price_sale_locked: true });
    expect(r.patch.sale_price_ttc).toBeUndefined();
    expect(r.anomalies).toContain('Prix de vente verrouillé : conservé.');
  });
  test('sans verrou : comportement inchange', () => {
    const r = diffRow({ reference: 'REF1', rowIndex: 1, designation: 'Nouvelle', sale_price_ttc: 150 }, base);
    expect(r.patch.designation).toBe('Nouvelle');
    expect(r.patch.sale_price_ttc).toBe(150);
  });
});
