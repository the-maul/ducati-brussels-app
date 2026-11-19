/**
 * M8 — Decisions du client du 18/11/2026 : Q48 taux horaire (standard 109,74 HT, VIP 90,00 HT par
 * le moteur de tarifs existant) et Q49 (lignes du kit d'entretien sur l'OR cree depuis le RDV,
 * avertissement de doublon a « Inserer un kit »). Execution : `bun test`.
 */
import { describe, expect, it } from 'bun:test';
import { clientLabourRate } from '../src/modules/workshop/labour-rate';
import { resolveQuoteFeeParams } from '../src/modules/workshop/quote-fees';
import { fromPriceListRule, priceListChain, resolveSalePrice, type PriceListRow, type PricingRule } from '../src/modules/sales/customer-pricing';
import { kitDuplicateCount, kitInsertLines, toRoLine, type PricedArticle } from '../src/modules/workshop/kits/insert-rules';

const STANDARD = 109.74;
const MO: PricedArticle = { id: 'mo', reference: 'MO', designation: "Main d'oeuvre atelier", mgmt_type: 'T', sale_price_ht: null, sale_price_ttc: 0, vat_rate: 21 };
const lists: PriceListRow[] = [
  { id: 'vip', code: 'VIP', label: 'VIP (main d oeuvre 90,00 HT)', show_discount: false },
  { id: 'r15', code: '15', label: 'REMISE 15 %' },
];
const vipRule = fromPriceListRule(
  { id: 'r1', price_list_id: 'vip', scope: 'reference', article_id: 'mo', kind: 'net', tiers: [{ min_qty: 1, value: 90 }] },
  priceListChain(lists, 'vip')[0],
) as PricingRule;
const remise15 = fromPriceListRule(
  { id: 'r2', price_list_id: 'r15', scope: 'all', kind: 'discount', tiers: [{ min_qty: 1, value: 15 }] },
  priceListChain(lists, 'r15')[0],
) as PricingRule;
const moPrice = (rules: PricingRule[]) => resolveSalePrice({ article: { id: 'mo', reference: 'MO' }, baseHt: STANDARD, qty: 1, date: '2026-11-19', rules });

describe('Q48 — taux horaire comme G8', () => {
  it('le taux standard se lit meme si le code de la ligne est en majuscules (DIAGNOSTIC)', () => {
    const p = resolveQuoteFeeParams([{ code: 'DIAGNOSTIC', is_active: true, extra: { hourly_rate_ht: 109.74, max_hours: 4 } }], null);
    expect(p.hourlyRateHt).toBe(109.74);
    expect(p.diagnosticMaxHours).toBe(4);
  });
  it('client sans tarif : 109,74 HT', () => {
    expect(clientLabourRate(STANDARD, moPrice([]))).toBe(109.74);
    expect(clientLabourRate(STANDARD, null)).toBe(109.74);
  });
  it('client VIP : 90,00 HT (tarif client « VIP », moteur de tarifs)', () => {
    expect(clientLabourRate(STANDARD, moPrice([vipRule]))).toBe(90);
  });
  it('« REMISE 15 % » sur tout le catalogue ne touche pas le taux de la MO (a trancher)', () => {
    const r = moPrice([remise15]);
    expect(r.rule).not.toBeNull();
    expect(clientLabourRate(STANDARD, r)).toBe(109.74);
  });
  it('taux standard absent : pas de taux invente', () => {
    expect(clientLabourRate(null, null)).toBeNull();
    expect(clientLabourRate(0, moPrice([]))).toBeNull();
  });
  it('forfait insere pour un VIP : la MO prend 90,00 HT, les pieces gardent leur prix', () => {
    const filter: PricedArticle = { id: 'f', reference: '44440312B', designation: 'FILTRE A HUILE', mgmt_type: 'A', sale_price_ht: 21.7, vat_rate: 21 };
    const articles = new Map([[MO.id, MO], [filter.id, filter]]);
    const comps = [{ articleId: 'f', reference: '44440312B', designation: 'FILTRE', quantity: 1 }, { articleId: 'mo', reference: 'MO', designation: 'MO', quantity: 1.5 }];
    const vip = kitInsertLines({ title: 'Kit', components: comps, articles, labourRateHt: clientLabourRate(STANDARD, moPrice([vipRule])) });
    const std = kitInsertLines({ title: 'Kit', components: comps, articles, labourRateHt: clientLabourRate(STANDARD, moPrice([])) });
    expect(vip.find((l) => l.type === 'mo')?.unit_price_ht).toBe(90);
    expect(std.find((l) => l.type === 'mo')?.unit_price_ht).toBe(109.74);
    expect(vip.find((l) => l.article_id === 'f')?.unit_price_ht).toBe(21.7);
    expect(vip.find((l) => l.type === 'mo')?.quantity).toBe(1.5);
  });
});

describe('Q49 — kit du RDV d entretien sur l OR', () => {
  const F = (id: string, ref: string): PricedArticle => ({ id, reference: ref, designation: ref, mgmt_type: 'F', sale_price_ht: 10, vat_rate: 21 });
  const articles = new Map<string, PricedArticle>([
    ['f', { id: 'f', reference: '44440312B', designation: 'FILTRE A HUILE', mgmt_type: 'A', sale_price_ht: 21.7, vat_rate: 21 }],
    ['dds', F('dds', 'APPAREIL DE DIAGNOTI')], ['pf', F('pf', 'PETITES FOURNITURES')], ['contri', F('contri', 'CONTRI')], [MO.id, MO],
  ]);
  const comps = ['f', 'dds', 'pf', 'contri', 'mo'].map((id) => ({ articleId: id, reference: articles.get(id)!.reference, designation: articles.get(id)!.designation, quantity: 1 }));
  it('toutes les lignes du kit deviennent des lignes d OR (pieces, controles, fournitures, CONTRI, MO)', () => {
    const lines = kitInsertLines({ title: 'Kit : Entretien annuel (depuis le RDV)', components: comps, articles, mode: 'detail', labourRateHt: 90 }).map(toRoLine);
    expect(lines).toHaveLength(6);                       // titre + 5 lignes
    expect(lines[0].kind).toBe('texte');
    expect(lines.filter((l) => l.kind === 'piece')).toHaveLength(4);
    expect(lines.find((l) => l.kind === 'mo')?.unit_price_ht).toBe(90);
  });
  it('« Inserer un kit » apres coup : doublon detecte, propose de ne pas reinserer', () => {
    const onOr = kitInsertLines({ title: 'Kit', components: comps, articles, labourRateHt: 90 }).map(toRoLine);
    const again = kitInsertLines({ title: 'Kit', components: comps, articles, labourRateHt: 90 });
    expect(kitDuplicateCount(onOr, again)).toBe(5);
    expect(kitDuplicateCount([], again)).toBe(0);
    expect(kitDuplicateCount([{ article_id: null, kind: 'texte' }], again)).toBe(0);
  });
});
