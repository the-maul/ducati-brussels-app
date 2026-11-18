/**
 * Tests des cessions internes / O.R.O (rattrapage G8, 18/11/2026) — CLAUDE.md regle 7
 * (« imputation ORO ») et B5 (marges sur PA et PAMP). Execution : `bun test`.
 * Decision de Simon (18/11) : pieces au PAMP par defaut, dernier prix d'achat au choix.
 */
import { test, expect, describe } from 'bun:test';
import {
  unitCostFor, computeCostWindow, printUnitPrice, printLineTotal, printTotal,
  rayonOf, groupByRayon, minutesToHours, isTruthySetting, defaultCostBasis, cessionActions,
  type PricedLine,
} from '../src/modules/tradein/cessions/rules';

describe('valorisation des pieces (PAMP par defaut, dernier PA au choix)', () => {
  test('PAMP : 0,75 meme si le dernier PA est 0,50', () => {
    expect(unitCostFor('pamp', 0.75, 0.5)).toBe(0.75);
  });
  test('dernier PA : 0,50 meme si le PAMP est 0,75', () => {
    expect(unitCostFor('pa', 0.75, 0.5)).toBe(0.5);
  });
  test('replis : sans PAMP on prend le PA, sans PA on prend le PAMP, rien = 0', () => {
    expect(unitCostFor('pamp', 0, 1.2)).toBe(1.2);
    expect(unitCostFor('pamp', null, 1.2)).toBe(1.2);
    expect(unitCostFor('pa', 0.9, 0)).toBe(0.9);
    expect(unitCostFor('pa', null, null)).toBe(0);
  });
  test('arrondi a 3 decimales comme en base', () => {
    expect(unitCostFor('pamp', 0.12345, 0)).toBe(0.123);
  });
  test('reglage societe : « pa » = dernier PA, tout le reste = PAMP', () => {
    expect(defaultCostBasis('pa')).toBe('pa');
    expect(defaultCostBasis(' PA ')).toBe('pa');
    expect(defaultCostBasis('pamp')).toBe('pamp');
    expect(defaultCostBasis(null)).toBe('pamp');
    expect(defaultCostBasis('n importe quoi')).toBe('pamp');
  });
});

describe('fenetre « prix de revient » (G8 parcours 10)', () => {
  // Reprise 5 000 €, piece 0,75 (PAMP) + 1 h interne a 28,20 = 28,95, PV 5 000 € (O, TVA marge 0 %).
  const g8 = { purchasePrice: 5000, legacyOro: 0, otherCessions: 0, currentCost: 28.95, accounted: true, options: 0, saleTtc: 5000, vatRate: 0 };

  test('au PAMP : 5 000 → 5 028,95, marge PR −28,95 (−0,58 %)', () => {
    const w = computeCostWindow(g8);
    expect(w.previousCost).toBe(5000);
    expect(w.currentImputed).toBe(28.95);
    expect(w.newCost).toBe(5028.95);
    expect(w.saleHt).toBe(5000);
    expect(w.marginPr).toBe(-28.95);
    expect(w.marginPrPct).toBe(-0.58);
    expect(w.marginPa).toBe(0);
  });

  test('au dernier PA : piece 0,50 → cession 28,70, prix de revient 5 028,70', () => {
    const current = 1 * unitCostFor('pa', 0.75, 0.5) + 1 * unitCostFor('pa', 28.2, 28.2);
    const w = computeCostWindow({ ...g8, currentCost: Math.round(current * 100) / 100 });
    expect(w.currentImputed).toBe(28.7);
    expect(w.newCost).toBe(5028.7);
    expect(w.marginPr).toBe(-28.7);
  });

  test('autres cessions et options s\'additionnent', () => {
    const w = computeCostWindow({ ...g8, otherCessions: 28.95, currentCost: 50, options: 100 });
    expect(w.newCost).toBe(5178.95);
    expect(w.options).toBe(100);
  });

  test('anciennes lignes d\'ORO de la reprise comptent dans l\'ancien prix de revient', () => {
    const w = computeCostWindow({ ...g8, legacyOro: 120 });
    expect(w.previousCost).toBe(5120);
    expect(w.newCost).toBe(5148.95);
  });

  test('cession non comptabilisee : aucun effet sur le prix de revient (ni options)', () => {
    const w = computeCostWindow({ ...g8, accounted: false, options: 100 });
    expect(w.currentImputed).toBe(0);
    expect(w.options).toBe(0);
    expect(w.newCost).toBe(5000);
  });

  test('moto a 21 % : PV HT = TTC / 1,21, marges sur PR et sur PA', () => {
    const w = computeCostWindow({ ...g8, saleTtc: 12100, vatRate: 21 });
    expect(w.saleHt).toBe(10000);
    expect(w.marginPr).toBe(4971.05);
    expect(w.marginPrPct).toBe(49.71);
    expect(w.marginPa).toBe(5000);
    expect(w.marginPaPct).toBe(50);
  });

  test('sans prix de vente : pas de marge affichee', () => {
    const w = computeCostWindow({ ...g8, saleTtc: null });
    expect(w.saleHt).toBeNull();
    expect(w.marginPr).toBeNull();
    expect(w.marginPrPct).toBeNull();
  });

  test('options negatives ignorees', () => {
    expect(computeCostWindow({ ...g8, options: -50 }).newCost).toBe(5028.95);
  });
});

describe('edition en PAMP / prix de vente / prix d\'achat', () => {
  const piece: PricedLine = { kind: 'piece', quantity: 2, unit_cost: 0.75, unit_pamp: 0.75, unit_pa: 0.5, unit_sale_ht: 1.74, cost_locked: false };
  const frais: PricedLine = { kind: 'frais', quantity: 1, unit_cost: 50, unit_pamp: null, unit_pa: null, unit_sale_ht: null, cost_locked: true };
  const texte: PricedLine = { kind: 'texte', quantity: 0, unit_cost: 0, unit_pamp: null, unit_pa: null, unit_sale_ht: null, cost_locked: true };

  test('piece : PAMP 1,50, PA 1,00, PV 3,48', () => {
    expect(printLineTotal(piece, 'pamp')).toBe(1.5);
    expect(printLineTotal(piece, 'pa')).toBe(1);
    expect(printLineTotal(piece, 'pv')).toBe(3.48);
  });
  test('frais a cout saisi : meme montant en PAMP et en PA, 0 en PV', () => {
    expect(printUnitPrice(frais, 'pamp')).toBe(50);
    expect(printUnitPrice(frais, 'pa')).toBe(50);
    expect(printUnitPrice(frais, 'pv')).toBe(0);
  });
  test('total d\'edition', () => {
    expect(printTotal([piece, frais, texte], 'pamp')).toBe(51.5);
    expect(printTotal([piece, frais, texte], 'pa')).toBe(51);
  });
});

describe('listes et reglages', () => {
  test('rayon = premier segment du code famille', () => {
    expect(rayonOf('03-01-01')).toBe('03');
    expect(rayonOf('08')).toBe('08');
    expect(rayonOf(null)).toBe('');
  });
  test('cessions par rayon : quantites et montants HT PAMP / vente, sans rayon en dernier', () => {
    const r = groupByRayon([
      { category_path: '03-01-01', quantity: 1, amount_pamp: 0.75, amount_sale_ht: 1.74 },
      { category_path: '03-02-01', quantity: 2, amount_pamp: 1.5, amount_sale_ht: 3.48 },
      { category_path: null, quantity: 1, amount_pamp: 28.2, amount_sale_ht: 63.47 },
      { category_path: '01-01-01', quantity: 1, amount_pamp: 10, amount_sale_ht: 20 },
    ]);
    expect(r.map((x) => x.rayon)).toEqual(['01', '03', '']);
    expect(r[1]).toEqual({ rayon: '03', quantity: 3, amountPamp: 2.25, amountSaleHt: 5.22, lines: 2 });
  });
  test('heures passees depuis la pointeuse', () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(null)).toBe(0);
  });
  test('reglages oui / non', () => {
    expect(isTruthySetting('oui')).toBe(true);
    expect(isTruthySetting('Ja')).toBe(true);
    expect(isTruthySetting('non')).toBe(false);
    expect(isTruthySetting(null)).toBe(false);
  });
  test('actions selon le statut : une cession validee est figee, une archivee se desarchive', () => {
    expect(cessionActions('ouvert')).toEqual({ edit: true, validate: true, cancel: true, archive: true, unarchive: false });
    expect(cessionActions('valide')).toEqual({ edit: false, validate: false, cancel: false, archive: true, unarchive: false });
    expect(cessionActions('archive').unarchive).toBe(true);
    expect(cessionActions('annule').archive).toBe(false);
  });
});
