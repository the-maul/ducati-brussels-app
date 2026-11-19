/**
 * M8 — Decisions du client du 18/11/2026 : Q48 taux horaire (standard 109,74 HT, VIP 90,00 HT par
 * le tarif client « VIP » du moteur unique des tarifs) et Q49 (lignes du kit d'entretien sur l'OR
 * cree depuis le RDV, prix par la fonction unique des lignes d'OR, doublon a « Inserer un kit »).
 * Execution : `bun test`.
 */
import { describe, expect, it } from 'bun:test';
import { resolveQuoteFeeParams } from '../src/modules/workshop/quote-fees';
import {
  fromPriceListRule, priceListChain, resolveSalePrice, LABOUR_PRICING_REFERENCE, type PriceListRow, type PricingRule,
} from '../src/modules/sales/customer-pricing';
import { lineBaseHt, priceOrLine, pricedAsLabour, repriceOrLines, type OrLinePricer } from '../src/modules/workshop/or-line-pricing';
import { kitDuplicateCount, kitInsertLines, toRoLine, type PricedArticle } from '../src/modules/workshop/kits/insert-rules';

const DATE = '2026-11-19';
const STANDARD = 109.74;
const MO_ID = 'art-mo';   // article de main-d'oeuvre de la societe (reference MO, type T, sans prix)
const LISTS: PriceListRow[] = [
  { id: 'vip', code: 'VIP', label: 'VIP (main d oeuvre 90,00 HT)', is_active: true, show_discount: false },
  { id: 'r15', code: '15', label: 'REMISE 15 %', is_active: true, show_discount: true },
];
// Ligne du tarif « VIP » posee par la migration 20261119192000 : prix net de l'article MO.
const VIP = fromPriceListRule(
  { id: 'r-vip', price_list_id: 'vip', scope: 'reference', article_id: MO_ID, kind: 'net', tiers: [{ min_qty: 1, value: 90 }] },
  priceListChain(LISTS, 'vip')[0],
) as PricingRule;

/** Meme contrat que CustomerPricer : priceLabour lit aussi les lignes qui visent l'article MO. */
function pricer(rules: PricingRule[]): OrLinePricer {
  return {
    price: async (articleId, baseHt, qty) => resolveSalePrice({ article: { id: articleId }, baseHt, qty, date: DATE, rules }),
    priceLabour: async (baseHt, qty) => resolveSalePrice({ article: { id: MO_ID, reference: LABOUR_PRICING_REFERENCE }, baseHt, qty, date: DATE, rules }),
  };
}

const MO: PricedArticle = { id: MO_ID, reference: 'MO', designation: "Main d'oeuvre atelier", mgmt_type: 'T', sale_price_ht: null, sale_price_ttc: 0, vat_rate: 21 };
const FILTER: PricedArticle = { id: 'f', reference: '44440312B', designation: 'FILTRE A HUILE', mgmt_type: 'A', sale_price_ht: 21.7, vat_rate: 21 };
const bases = { articleBaseHt: new Map([['f', 21.7]]), labourRateHt: STANDARD };

describe('Q48 — taux horaire comme G8', () => {
  it('le taux standard se lit meme si le code de la ligne est en majuscules (DIAGNOSTIC)', () => {
    const p = resolveQuoteFeeParams([{ code: 'DIAGNOSTIC', is_active: true, extra: { hourly_rate_ht: 109.74, max_hours: 4 } }], null);
    expect(p.hourlyRateHt).toBe(109.74);
    expect(p.diagnosticMaxHours).toBe(4);
  });
  it('MO sans article : 109,74 HT sans tarif, 90,00 HT au tarif VIP', async () => {
    const mo = { kind: 'mo' as const, article_id: null, quantity: 1, unit_price_ht: STANDARD, discount_pct: 0 };
    expect(await priceOrLine(pricer([]), mo, STANDARD)).toMatchObject({ unit_price_ht: 109.74, ruled: false });
    expect(await priceOrLine(pricer([VIP]), mo, STANDARD)).toMatchObject({ unit_price_ht: 90, discount_pct: 0, ruled: true });
  });
  it('MO d un forfait (article MO sans prix) : taux atelier puis tarif du client', async () => {
    const mo = { kind: 'mo' as const, article_id: MO_ID, quantity: 1.5, unit_price_ht: 0, discount_pct: 0 };
    expect(pricedAsLabour(mo, bases)).toBe(true);
    expect(lineBaseHt(mo, bases)).toBe(109.74);
    const r = await repriceOrLines([mo], pricer([VIP]), bases);
    expect(r.lines[0]).toMatchObject({ unit_price_ht: 90, quantity: 1.5 });
    const std = await repriceOrLines([mo], pricer([]), bases);
    expect(std.lines[0]).toMatchObject({ unit_price_ht: 109.74 });
  });
  it('le tarif VIP ne touche pas les pieces', async () => {
    const r = await repriceOrLines([{ kind: 'piece' as const, article_id: 'f', quantity: 1, unit_price_ht: 21.7, discount_pct: 0 }], pricer([VIP]), bases);
    expect(r.lines[0]).toMatchObject({ unit_price_ht: 21.7, discount_pct: 0 });
    expect(r.changed).toBe(0);
  });
});

describe('Q49 — kit du RDV d entretien sur l OR', () => {
  const F = (id: string, ref: string): PricedArticle => ({ id, reference: ref, designation: ref, mgmt_type: 'F', sale_price_ht: 10, vat_rate: 21 });
  const articles = new Map<string, PricedArticle>([
    ['f', FILTER], ['dds', F('dds', 'APPAREIL DE DIAGNOTI')], ['pf', F('pf', 'PETITES FOURNITURES')], ['contri', F('contri', 'CONTRI')], [MO_ID, MO],
  ]);
  const comps = ['f', 'dds', 'pf', 'contri', MO_ID].map((id) => ({ articleId: id, reference: articles.get(id)!.reference, designation: articles.get(id)!.designation, quantity: 1 }));
  it('toutes les lignes du kit deviennent des lignes d OR, puis passent par la fonction de prix (VIP : MO 90)', async () => {
    const lines = kitInsertLines({ title: 'Kit : Entretien annuel (depuis le RDV)', components: comps, articles, mode: 'detail', labourRateHt: STANDARD }).map(toRoLine);
    expect(lines).toHaveLength(6);                       // titre + 5 lignes
    expect(lines[0].kind).toBe('texte');
    expect(lines.filter((l) => l.kind === 'piece')).toHaveLength(4);
    expect(lines.find((l) => l.kind === 'mo')?.unit_price_ht).toBe(109.74);
    const priced = await repriceOrLines(lines, pricer([VIP]), { articleBaseHt: new Map([['f', 21.7], ['dds', 10], ['pf', 10], ['contri', 10]]), labourRateHt: STANDARD });
    expect(priced.lines.find((l) => l.kind === 'mo')?.unit_price_ht).toBe(90);
    expect(priced.lines.find((l) => l.article_id === 'f')?.unit_price_ht).toBe(21.7);
    expect(priced.lines[0]).toBe(lines[0]);              // le titre n'est pas touche
  });
  it('« Inserer un kit » apres coup : doublon detecte, propose de ne pas reinserer', () => {
    const onOr = kitInsertLines({ title: 'Kit', components: comps, articles, labourRateHt: STANDARD }).map(toRoLine);
    const again = kitInsertLines({ title: 'Kit', components: comps, articles, labourRateHt: STANDARD });
    expect(kitDuplicateCount(onOr, again)).toBe(5);
    expect(kitDuplicateCount([], again)).toBe(0);
    expect(kitDuplicateCount([{ article_id: null, kind: 'texte' }], again)).toBe(0);
  });
});
