/**
 * Rattrapage G8 (18/11/2026, lot parc) — fiche moto : bilan economique (marge previsionnelle,
 * TVA marge B2), jours de stock, primes par periode, fin de garantie. Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { vehicleEconomics, daysInStockOf, bonusesInPeriod, warrantyEndFrom } from '../src/modules/vehicles/economics';

describe('bilan economique', () => {
  test('moto neuve (V) : PV TTC 16 590, revient 12 000 -> PV HT 13 710,74, marge 1 710,74 (12,48 %)', () => {
    const e = vehicleEconomics({ mgmtType: 'V', purchasePrice: 12000, costPrice: 12000, saleTtc: 16590 });
    expect(e.scheme).toBe('normal');
    expect(e.saleHt).toBe(13710.74);
    expect(e.vat).toBe(2879.26);
    expect(e.margin).toBe(1710.74);
    expect(e.marginPct).toBe(12.48);
  });
  test('occasion de particulier (O, B2) : la TVA ne porte que sur PV - prix de reprise', () => {
    // reprise 5 000, remise en etat 600 -> revient 5 600 ; PV 7 000 : marge taxable 2 000, TVA 347,11
    const e = vehicleEconomics({ mgmtType: 'O', purchasePrice: 5000, costPrice: 5600, saleTtc: 7000 });
    expect(e.scheme).toBe('marge');
    expect(e.vat).toBe(347.11);
    expect(e.saleHt).toBe(6652.89);
    expect(e.margin).toBe(1052.89);
  });
  test('occasion O vendue sous le prix de reprise : pas de TVA negative', () => {
    const e = vehicleEconomics({ mgmtType: 'O', purchasePrice: 5000, costPrice: 5000, saleTtc: 4800 });
    expect(e.vat).toBe(0);
    expect(e.margin).toBe(-200);
  });
  test('occasion pro (P) : TVA 21 % sur le prix entier', () => {
    const e = vehicleEconomics({ mgmtType: 'P', purchasePrice: 8000, costPrice: 8000, saleTtc: 12100 });
    expect(e.saleHt).toBe(10000);
    expect(e.margin).toBe(2000);
    expect(e.marginPct).toBe(20);
  });
  test('depot-vente (D) : pas de marge sur le prix (la commission est a part)', () => {
    const e = vehicleEconomics({ mgmtType: 'D', purchasePrice: null, costPrice: null, saleTtc: 7000 });
    expect(e.scheme).toBe('depot');
    expect(e.margin).toBeNull();
    expect(e.saleHt).toBeNull();
  });
  test('primes et cote : marge primes comprises, ecart avec la cote', () => {
    const e = vehicleEconomics({ mgmtType: 'V', purchasePrice: 10000, costPrice: 10000, saleTtc: 12100, bonuses: 500, marketValue: 11500 });
    expect(e.margin).toBe(0);
    expect(e.marginWithBonuses).toBe(500);
    expect(e.gapToMarket).toBe(600);
  });
  test('sans prix de revient : celui-ci vaut le prix d\'achat ; sans PV : pas de marge', () => {
    expect(vehicleEconomics({ mgmtType: 'V', purchasePrice: 1000, costPrice: null, saleTtc: 1210 }).margin).toBe(0);
    expect(vehicleEconomics({ mgmtType: 'V', purchasePrice: 1000, costPrice: 1000, saleTtc: null }).margin).toBeNull();
  });
});

describe('jours de stock (G8 « Jour(s) stock »)', () => {
  const today = new Date('2026-11-18T12:00:00Z');
  test('encore en stock : jusqu\'a aujourd\'hui', () => {
    expect(daysInStockOf('2026-11-08', null, today)).toBe(10);
  });
  test('vendue : jusqu\'a la sortie', () => {
    expect(daysInStockOf('2026-01-01', '2026-01-31', today)).toBe(30);
  });
  test('sans date d\'entree : rien', () => {
    expect(daysInStockOf(null, null, today)).toBeNull();
  });
});

describe('liste des primes par periode', () => {
  const rows = [
    { bonus_date: '2026-01-15', amount: 300 }, { bonus_date: '2026-06-01', amount: 150.5 }, { bonus_date: '2026-12-31', amount: -50 },
  ];
  test('bornes incluses et total', () => {
    expect(bonusesInPeriod(rows, '2026-01-15', '2026-06-01')).toEqual({ rows: rows.slice(0, 2), total: 450.5 });
    expect(bonusesInPeriod(rows).total).toBe(400.5);
  });
});

describe('fin de garantie depuis la duree', () => {
  test('24 mois apres la mise en circulation', () => {
    expect(warrantyEndFrom('2026-03-15', 24)).toBe('2028-03-15');
  });
  test('fin de mois respectee (31/01 + 1 mois = 28/02)', () => {
    expect(warrantyEndFrom('2027-01-31', 1)).toBe('2027-02-28');
  });
  test('sans date ou sans duree : rien', () => {
    expect(warrantyEndFrom(null, 24)).toBeNull();
    expect(warrantyEndFrom('2026-01-01', 0)).toBeNull();
  });
});
