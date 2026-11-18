/**
 * M7 — Dépôt-vente complet (18/11/2026, VEN007 / VEN008) : stock non valorisé, montants du
 * décompte, facture de commission. Même calcul que la SQL `consignment_amounts`
 * (migration 20261118270000). Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  computeSettlement, commissionTtc, htFromTtc, buyerInvoiceLine, belowReserve, saleCheck,
  stockEntryUnitCost, ownedStockValue, filterConsignments, fillMention, settingTruthy, settingNumber,
} from '../src/modules/tradein/consignment-rules';

describe('stock non valorisé (type D)', () => {
  test('l entrée en stock d une moto en dépôt n a jamais de coût', () => {
    expect(stockEntryUnitCost('D')).toBeNull();
  });
  test('la valeur du stock exclut les motos en dépôt, quel que soit leur PAMP', () => {
    const rows = [
      { mgmtType: 'A', realQty: 10, pamp: 12.5 },
      { mgmtType: 'O', realQty: 1, pamp: 6000 },
      { mgmtType: 'D', realQty: 1, pamp: 7000 },
    ];
    expect(ownedStockValue(rows)).toBe(6125);
  });
});

describe('décompte au déposant (parcours G8 15-16 : prix demandé 6 000, PV 7 000)', () => {
  test('mode écart : commission = PV − prix demandé, TVA 21 % comprise', () => {
    const s = computeSettlement({ salePrice: 7000, askedPrice: 6000, mode: 'ecart', vatRate: 21 });
    expect(s.commissionTtc).toBe(1000);
    expect(s.commissionHt).toBe(826.45);
    expect(s.commissionVat).toBe(173.55);
    expect(s.net).toBe(6000);
  });
  test('frais de dépôt et réparations déduits du reversement', () => {
    const s = computeSettlement({ salePrice: 7000, askedPrice: 6000, mode: 'ecart', fees: 150, repairs: 242, vatRate: 21 });
    expect(s.invoiceTtc).toBe(1392);
    expect(s.feesHt).toBe(123.97);
    expect(s.repairsHt).toBe(200);
    expect(s.invoiceHt).toBe(r2(826.45 + 123.97 + 200));
    expect(s.invoiceVat).toBe(r2(1392 - s.invoiceHt));
    expect(s.net).toBe(5608);
    // PV = facture au déposant + net : rien ne se perd
    expect(r2(s.invoiceTtc + s.net)).toBe(7000);
  });
  test('mode pourcentage sur le prix de vente TTC', () => {
    expect(commissionTtc({ salePrice: 7000, askedPrice: 0, mode: 'pourcentage', pct: 10 })).toBe(700);
    const s = computeSettlement({ salePrice: 7000, askedPrice: 6500, mode: 'pourcentage', pct: 8, vatRate: 21 });
    expect(s.commissionTtc).toBe(560);
    expect(s.net).toBe(6440);
  });
  test('mode forfait', () => {
    const s = computeSettlement({ salePrice: 5000, askedPrice: 4800, mode: 'forfait', fixed: 300, vatRate: 21 });
    expect(s.commissionTtc).toBe(300);
    expect(s.net).toBe(4700);
  });
  test('vendu sous le prix demandé : commission nulle, jamais négative', () => {
    const s = computeSettlement({ salePrice: 5500, askedPrice: 6000, mode: 'ecart', vatRate: 21 });
    expect(s.commissionTtc).toBe(0);
    expect(s.net).toBe(5500);
  });
  test('frais négatifs ignorés', () => {
    const s = computeSettlement({ salePrice: 1000, askedPrice: 900, mode: 'ecart', fees: -50, vatRate: 21 });
    expect(s.feesTtc).toBe(0);
    expect(s.net).toBe(900);
  });
});

describe('facture de commission (au déposant)', () => {
  test('HT et TVA par ligne au taux du réglage', () => {
    expect(htFromTtc(121, 21)).toBe(100);
    expect(htFromTtc(1000, 21)).toBe(826.45);
    const s = computeSettlement({ salePrice: 10000, askedPrice: 9000, mode: 'ecart', vatRate: 21 });
    expect(s.invoiceTtc).toBe(1000);
    expect(r2(s.invoiceHt + s.invoiceVat)).toBe(1000);
  });
  test('taux paramétrable (le comptable corrige par réglage)', () => {
    const s = computeSettlement({ salePrice: 7000, askedPrice: 6000, mode: 'ecart', vatRate: 0 });
    expect(s.commissionHt).toBe(1000);
    expect(s.commissionVat).toBe(0);
  });
});

describe('facture acheteur', () => {
  test('déposant particulier (0 %) : TTC = HT = prix de vente', () => {
    expect(buyerInvoiceLine(7000, 0)).toEqual({ unitPriceHt: 7000, vat: 0, ttc: 7000 });
  });
  test('déposant professionnel (21 %) : TTC exact = prix de vente', () => {
    const l = buyerInvoiceLine(7000, 21);
    expect(l.ttc).toBe(7000);
    expect(l.unitPriceHt).toBe(5785.12);
    expect(l.vat).toBe(1214.88);
  });
  test('mention avec le n° DEP', () => {
    expect(fillMention('Vente pour compte, depot-vente {numero}.', 'DEP-2026-00001')).toBe('Vente pour compte, depot-vente DEP-2026-00001.');
  });
});

describe('contrôles de vente', () => {
  const base = { buyerId: 'b', depositorId: 'd', salePrice: 7000, minPrice: 6500, net: 6000, forceBelowMin: false };
  test('ok', () => expect(saleCheck(base)).toBeNull());
  test('acquéreur obligatoire', () => expect(saleCheck({ ...base, buyerId: null })).toBe('needBuyer'));
  test('acquéreur différent du déposant', () => expect(saleCheck({ ...base, buyerId: 'd' })).toBe('buyerIsDepositor'));
  test('sous le prix de réserve : accord exigé', () => {
    expect(belowReserve(6000, 6500)).toBe(true);
    expect(saleCheck({ ...base, salePrice: 6000 })).toBe('belowReserve');
    expect(saleCheck({ ...base, salePrice: 6000, forceBelowMin: true })).toBeNull();
  });
  test('décompte négatif refusé', () => expect(saleCheck({ ...base, net: -1 })).toBe('negativeNet'));
});

describe('liste des dépôts', () => {
  const rows = [
    { status: 'en_depot', number: 'DEP-2026-00001', plate: '1-ABC-123', vin: 'ZDM1', depositorName: 'Dupont' },
    { status: 'vendu', number: 'DEP-2026-00002', plate: '2-XYZ-999', vin: 'ZDM2', depositorName: 'Martin' },
    { status: 'restitue', number: 'DEP-2026-00003', plate: null, vin: 'ZDM3', depositorName: 'Élise Noël' },
  ];
  test('vues en cours / vendus / rendus', () => {
    expect(filterConsignments(rows, 'en_cours', '').map((r) => r.number)).toEqual(['DEP-2026-00001']);
    expect(filterConsignments(rows, 'vendus', '')).toHaveLength(1);
    expect(filterConsignments(rows, 'rendus', '')).toHaveLength(1);
    expect(filterConsignments(rows, 'tous', '')).toHaveLength(3);
  });
  test('recherche n°, immatriculation sans tirets, déposant sans accent', () => {
    expect(filterConsignments(rows, 'tous', '2xyz999')).toHaveLength(1);
    expect(filterConsignments(rows, 'tous', '00003')).toHaveLength(1);
    expect(filterConsignments(rows, 'tous', 'elise')).toHaveLength(1);
  });
});

test('réglages tolérants', () => {
  expect(settingTruthy('Oui')).toBe(true);
  expect(settingTruthy('non')).toBe(false);
  expect(settingNumber('21', 0)).toBe(21);
  expect(settingNumber('7,5', 0)).toBe(7.5);
  expect(settingNumber('', 21)).toBe(21);
});

function r2(n: number) { return Math.round(n * 100) / 100; }
