/**
 * Chantier C8 (REP-03, REP-04, REP-05) — fil d'étapes du dépôt-vente : étape courante calculée à partir
 * des statuts réels, alertes de cession, frais engagés au retour (affichés, jamais facturés d'office).
 */
import { test, expect, describe } from 'bun:test';
import {
  depotCurrentStep, depotSteps, depotWarnings, canReturnToOwner, summarizeDepotCessions, returnFeesSummary, docDue,
  DEPOT_MAIN_PATH, DEPOT_RETURN_PATH, type DepotFacts, type DepotCessionRow,
} from '../src/modules/tradein/consignment-steps';

const base: DepotFacts = {
  status: 'en_depot', soldReversal: null, payoutAt: null, buyerDue: null, returnDue: null, cessionsToValidate: 0, cessionsMissed: 0,
};
const sold = (o: Partial<DepotFacts> = {}): DepotFacts => ({ ...base, status: 'vendu', soldReversal: 5000, buyerDue: 0, ...o });
const back = (o: Partial<DepotFacts> = {}): DepotFacts => ({ ...base, status: 'restitue', ...o });
const stateOf = (f: DepotFacts, key: string) => depotSteps(f).find((s) => s.key === key)?.state;

describe('étape courante', () => {
  test('moto en dépôt sans frais à valider : en vente', () => expect(depotCurrentStep(base)).toBe('vente'));
  test('cession ouverte avec des lignes : frais à valider', () => expect(depotCurrentStep({ ...base, cessionsToValidate: 1 })).toBe('frais'));
  test('vendue, acheteur pas encore payé : encaisser', () => expect(depotCurrentStep(sold({ buyerDue: 7000 }))).toBe('vendue'));
  test('vendue, acheteur payé : reverser au déposant', () => expect(depotCurrentStep(sold())).toBe('reversement'));
  test('vendue sans facture acheteur (parcours G8) : reverser', () => expect(depotCurrentStep(sold({ buyerDue: null }))).toBe('reversement'));
  test('reste dû d un centime ou moins : considéré payé', () => expect(depotCurrentStep(sold({ buyerDue: 0.004 }))).toBe('reversement'));
  test('déposant payé et acheteur payé : clôturé', () => expect(depotCurrentStep(sold({ payoutAt: '2026-11-23' }))).toBe('cloture'));
  test('déposant payé mais acheteur non : le dossier n est pas clôturé', () => {
    expect(depotCurrentStep(sold({ payoutAt: '2026-11-23', buyerDue: 100 }))).toBe('vendue');
  });
  test('rien à reverser : clôturé', () => expect(depotCurrentStep(sold({ soldReversal: 0 }))).toBe('cloture'));
  test('moto rendue sans frais : clôturé', () => expect(depotCurrentStep(back())).toBe('cloture'));
  test('moto rendue, frais payés : clôturé', () => expect(depotCurrentStep(back({ returnDue: 0 }))).toBe('cloture'));
  test('moto rendue, facture de frais impayée : reste au retour', () => expect(depotCurrentStep(back({ returnDue: 120 }))).toBe('retour'));
});

describe('fil affiché', () => {
  test('parcours de vente complet', () => {
    expect(depotSteps(base).map((s) => s.key)).toEqual([...DEPOT_MAIN_PATH]);
    expect(depotSteps(sold()).map((s) => s.key)).toEqual([...DEPOT_MAIN_PATH]);
  });
  test('branche retour : pas d étapes de vente', () => {
    expect(depotSteps(back()).map((s) => s.key)).toEqual([...DEPOT_RETURN_PATH]);
  });
  test('une seule étape courante, quel que soit le cas', () => {
    for (const f of [base, { ...base, cessionsToValidate: 2 }, sold(), sold({ buyerDue: 10 }), sold({ payoutAt: 'x' }), back(), back({ returnDue: 5 })]) {
      expect(depotSteps(f).filter((s) => s.current)).toHaveLength(1);
    }
  });
  test('en vente : entrée cochée, vente en cours, suite à faire', () => {
    const s = depotSteps(base);
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'todo', 'todo', 'todo', 'todo']);
    expect(s.find((x) => x.current)?.key).toBe('vente');
  });
  test('reversement à faire : tout ce qui précède est coché', () => {
    expect(depotSteps(sold()).map((x) => x.state)).toEqual(['done', 'done', 'done', 'done', 'todo', 'todo']);
  });
  test('dossier clôturé : tout est coché', () => {
    expect(depotSteps(sold({ payoutAt: 'x' })).every((x) => x.state === 'done')).toBe(true);
    expect(depotSteps(back()).every((x) => x.state === 'done')).toBe(true);
  });
  test('acheteur impayé : étape Vendue à vérifier', () => expect(stateOf(sold({ buyerDue: 10 }), 'vendue')).toBe('warning'));
  test('cession à valider : étape Frais à vérifier', () => expect(stateOf({ ...base, cessionsToValidate: 1 }, 'frais')).toBe('warning'));
  test('cession oubliée à la vente : étape Frais à vérifier', () => expect(stateOf(sold({ cessionsMissed: 1 }), 'frais')).toBe('warning'));
  test('retour avec frais impayés : étape Retour à vérifier', () => expect(stateOf(back({ returnDue: 5 }), 'retour')).toBe('warning'));
  test('le retour au propriétaire n est proposé que pour une moto en dépôt', () => {
    expect(canReturnToOwner('en_depot')).toBe(true);
    expect(canReturnToOwner('vendu')).toBe(false);
    expect(canReturnToOwner('restitue')).toBe(false);
  });
});

describe('alertes', () => {
  test('cession ouverte avant la vente', () => expect(depotWarnings({ ...base, cessionsToValidate: 1 })).toEqual(['cessionOpenBeforeSale']));
  test('cession non déduite avant le reversement (ouverte ou archivée sans validation)', () => {
    expect(depotWarnings(sold({ cessionsToValidate: 1 }))).toEqual(['cessionNotDeducted']);
    expect(depotWarnings(sold({ cessionsMissed: 1 }))).toEqual(['cessionNotDeducted']);
  });
  test('acheteur impayé avant le reversement', () => expect(depotWarnings(sold({ buyerDue: 50 }))).toEqual(['buyerUnpaid']));
  test('déposant déjà payé : plus d alerte de reversement', () => {
    expect(depotWarnings(sold({ payoutAt: 'x', cessionsMissed: 1, buyerDue: 50 }))).toEqual([]);
  });
  test('dossier sain : aucune alerte', () => {
    expect(depotWarnings(base)).toEqual([]);
    expect(depotWarnings(sold())).toEqual([]);
    expect(depotWarnings(back())).toEqual([]);
  });
});

describe('cessions du dépôt', () => {
  const c = (o: Partial<DepotCessionRow>): DepotCessionRow => ({ id: 'x', number: 'OR-1', status: 'ouvert', validated_at: null, lines: [], ...o });
  const piece = { kind: 'piece', line_cost: 100, line_sale_ht: 150 };
  test('la cession vide ouverte à l entrée n est pas un frais', () => {
    const s = summarizeDepotCessions([c({})], 'cout', 21);
    expect(s.emptyOpen).toHaveLength(1);
    expect(s.toValidate).toHaveLength(0);
    expect(s.pendingTtc).toBe(0);
  });
  test('une ligne de texte seule n est pas un frais', () => {
    expect(summarizeDepotCessions([c({ lines: [{ kind: 'texte', line_cost: 0, line_sale_ht: 0 }] })], 'cout', 21).emptyOpen).toHaveLength(1);
  });
  test('ouverte avec des lignes : à valider, estimation au coût + TVA', () => {
    const s = summarizeDepotCessions([c({ lines: [piece] })], 'cout', 21);
    expect(s.toValidate).toHaveLength(1);
    expect(s.pendingTtc).toBe(121);
  });
  test('réglage au prix de vente : estimation sur le prix de vente', () => {
    expect(summarizeDepotCessions([c({ lines: [piece] })], 'vente', 21).pendingTtc).toBe(181.5);
  });
  test('archivée à la vente sans validation : oubliée', () => {
    const s = summarizeDepotCessions([c({ status: 'archive', lines: [piece] })], 'cout', 21);
    expect(s.missed).toHaveLength(1);
    expect(s.pendingTtc).toBe(121);
  });
  test('validée puis archivée : déjà comptée dans les frais du dépôt', () => {
    const s = summarizeDepotCessions([c({ status: 'archive', validated_at: '2026-11-20', lines: [piece] })], 'cout', 21);
    expect(s.missed).toHaveLength(0);
    expect(s.pendingTtc).toBe(0);
  });
  test('annulée : ne compte plus', () => {
    const s = summarizeDepotCessions([c({ status: 'annule', lines: [piece] })], 'cout', 21);
    expect(s.toValidate).toHaveLength(0);
    expect(s.missed).toHaveLength(0);
  });
});

describe('frais engagés au retour (affichés, pas de règle de facturation inventée)', () => {
  test('addition des frais et reste non facturé', () => {
    const r = returnFeesSummary({ depositFee: 50, validatedTtc: 121, pendingTtc: 30, uninvoicedRepairs: 200, billed: 100 });
    expect(r.engaged).toBe(401);
    expect(r.notBilled).toBe(301);
  });
  test('sans frais : zéro', () => {
    expect(returnFeesSummary({})).toMatchObject({ engaged: 0, billed: 0, notBilled: 0 });
  });
  test('facturé plus que les frais : jamais de reste négatif', () => {
    expect(returnFeesSummary({ depositFee: 10, billed: 50 }).notBilled).toBe(0);
  });
});

describe('reste dû sur un document', () => {
  test('pas de document : inconnu', () => expect(docDue(null)).toBeNull());
  test('partiellement payé', () => expect(docDue({ total_ttc: 100, paid_amount: 30 })).toBe(70));
  test('trop payé : zéro', () => expect(docDue({ total_ttc: 100, paid_amount: 120 })).toBe(0));
});
