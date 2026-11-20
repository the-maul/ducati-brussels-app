import { describe, expect, test } from 'bun:test';
import { buildPurchasePrintModel, purchaseLineHt, purchaseQty, purchasePdfFileName, type PurchasePrintLineInput } from '../src/modules/purchases/purchase-print';

const line = (o: Partial<PurchasePrintLineInput> & { id: string }): PurchasePrintLineInput => ({
  reference: 'REF', supplierRef: null, designation: 'Article', quantity: 1, unitPriceHt: 10, discountPct: 0, vatRate: 21, ...o,
});

describe('Q65 — impression commande fournisseur / réception', () => {
  test('total HT de ligne avec remise, au centime', () => {
    expect(purchaseLineHt(3, 12.5, 10)).toBe(33.75);
    expect(purchaseLineHt(10, 8.5, 0)).toBe(85);
    expect(purchaseLineHt(1, 9.99, 33)).toBe(6.69);
  });

  test('totaux recalculés : remise ligne, remise globale, port taxé', () => {
    const m = buildPurchasePrintModel('order', [
      line({ id: 'a', quantity: 2, unitPriceHt: 50, discountPct: 10 }),   // 90
      line({ id: 'b', quantity: 4, unitPriceHt: 2.5, vatRate: 6 }),        // 10
    ], { globalDiscountPct: 10, shippingHt: 15, shippingTaxed: true, shippingVatRate: 21 });
    expect(m.linesHt).toBe(100);
    expect(m.globalDiscountAmount).toBe(10);
    expect(m.totals.ht).toBe(105);
    // TVA : 90 × 0,9 × 21 % + 10 × 0,9 × 6 % + 15 × 21 % = 17,01 + 0,54 + 3,15
    expect(m.totals.vat).toBe(20.7);
    expect(m.totals.ttc).toBe(125.7);
  });

  test('les totaux enregistrés de l\'en-tête priment', () => {
    const m = buildPurchasePrintModel('order', [line({ id: 'a', quantity: 3, unitPriceHt: 10 })], { totals: { ht: 30, vat: 6.3, ttc: 36.3 } });
    expect(m.totals).toEqual({ ht: 30, vat: 6.3, ttc: 36.3 });
    const partial = buildPurchasePrintModel('order', [line({ id: 'a', quantity: 3, unitPriceHt: 10 })], { totals: { ht: 30, vat: null, ttc: null } });
    expect(partial.totals).toEqual({ ht: 30, vat: 6.3, ttc: 36.3 });
  });

  test('réception partielle : reçu sur ce bon, commandé, reliquat listé', () => {
    const m = buildPurchasePrintModel('receipt', [
      line({ id: 'r1', reference: 'FILTRE', quantity: 5, unitPriceHt: 8.5, ordered: 10, remaining: 5, orderNumber: 'CMD-2026-00001' }),
      line({ id: 'r2', reference: 'JOINT', quantity: 2, unitPriceHt: 1, ordered: 2, remaining: 0, orderNumber: 'CMD-2026-00001' }),
    ]);
    expect(m.lines[0]).toMatchObject({ ordered: 10, received: 5, remaining: 5, totalHt: 42.5 });
    expect(m.lines[1]).toMatchObject({ ordered: 2, received: 2, remaining: 0 });
    expect(m.partial).toBe(true);
    expect(m.remainders).toEqual([{ reference: 'FILTRE', designation: 'Article', orderNumber: 'CMD-2026-00001', ordered: 10, remaining: 5 }]);
    expect(m.linesHt).toBe(44.5);
  });

  test('réception complète : aucun reliquat', () => {
    const m = buildPurchasePrintModel('receipt', [
      line({ id: 'r1', quantity: 10, ordered: 10, remaining: 0 }),
      line({ id: 'r2', quantity: 1, ordered: null, remaining: null }),   // ligne hors commande
    ]);
    expect(m.partial).toBe(false);
    expect(m.remainders).toEqual([]);
    expect(m.lines[1]).toMatchObject({ ordered: null, received: 1, remaining: null });
  });

  test('commande soldée : plus de reliquat imprimé ; commande reçue en partie : reçu = cdé − reste', () => {
    const closed = buildPurchasePrintModel('order', [line({ id: 'a', quantity: 10, remaining: 4, orderClosed: true })]);
    expect(closed.remainders).toEqual([]);
    expect(closed.lines[0].remaining).toBe(0);
    const open = buildPurchasePrintModel('order', [line({ id: 'a', quantity: 10, remaining: 4, orderNumber: 'CMD-1' })]);
    expect(open.lines[0]).toMatchObject({ ordered: 10, received: 6, remaining: 4 });
    expect(open.partial).toBe(true);
    const neg = buildPurchasePrintModel('order', [line({ id: 'a', quantity: 10, remaining: -2 })]);
    expect(neg.lines[0].remaining).toBe(0);
  });

  test('formats', () => {
    expect(purchaseQty(1.5)).toBe('1,5');
    expect(purchaseQty(null)).toBe('');
    expect(purchasePdfFileName('Bon de réception', 'REC-2026-00001')).toBe('Bon-de-reception_REC-2026-00001.pdf');
  });
});
