import { describe, expect, test } from 'bun:test';
import { buildPurchasePrintModel } from '../src/modules/purchases/purchase-print';

describe('Q65 — PDF commande / réception', () => {
  test('le PDF se dessine (réception partielle, plusieurs pages, reliquats)', async () => {
    const { drawPurchasePdf } = await import('../src/modules/purchases/purchase-print-pdf');
    const { jsPDF } = await import('jspdf');
    const lines = Array.from({ length: 60 }, (_, i) => ({
      id: `l${i}`, reference: `REF${i}`, supplierRef: `S${i}`, designation: `Désignation très longue de l'article numéro ${i} pour forcer le retour à la ligne`,
      quantity: 2, unitPriceHt: 12.34, discountPct: i % 3 ? 0 : 5, vatRate: 21, ordered: 4, remaining: i % 2 ? 2 : 0, orderNumber: 'CMD-2026-00001',
    }));
    const model = buildPurchasePrintModel('receipt', lines, { shippingHt: 10, shippingVatRate: 21 });
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: false });
    drawPurchasePdf(doc, {
      title: 'Bon de réception', number: 'REC-2026-00001', docType: 'REC',
      company: { name: 'ItalTest', lines: ['Rue X 1', '1000 Bruxelles'], logo: null },
      supplierLines: ['DUCATI WEST EUROPE', 'Rue Y 2', '1000 Bruxelles', 'TVA : BE0123456789'],
      band: [['N°', 'REC-2026-00001'], ['Date de réception', '20/11/2026'], ['Statut', 'Reçue']],
      model, sourceOrders: ['CMD-2026-00001'], notes: 'Livraison partielle',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const out = doc.output();
    expect(out).toContain('REC-2026-00001');
    expect(model.remainders.length).toBe(30);
  });
});
