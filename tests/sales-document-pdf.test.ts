/**
 * Tests M6/M9 — PDF d'un document de vente (mission 05 carte 8, mission 02 carte 6) :
 * détail TVA par taux, validité du devis, totaux et reste à payer, PDF non vide.
 */
import { test, expect } from 'bun:test';
import {
  vatBreakdown, validityMention, addMonthsIso, eurPdf, salesPdfFileName,
  buildSalesDocumentPdf, buildSalesDocumentPdfUncompressed, type SalesPdfInput, type SalesPdfLine,
} from '../src/modules/sales/document-pdf';
import { computeTotals, type LineInput } from '../src/modules/sales/write-api';

const L = (p: Partial<SalesPdfLine>): SalesPdfLine => ({
  lineType: 'article', reference: null, designation: 'x', quantity: 1, unitPriceHt: 0, vatRate: 21, discountPct: 0, lineTtc: 0, ...p,
});

// Proforma type : moto 21 %, option 21 % remisée, MO 5,5 h, ligne vide, commentaire, article à 6 %.
const lines: SalesPdfLine[] = [
  L({ reference: 'SCR-ICON', designation: 'Scrambler Icon Dark 2G', unitPriceHt: 8256.2, lineTtc: 9990 }),
  L({ reference: '96481331AA', designation: 'Poignées chauffantes', quantity: 2, unitPriceHt: 100, discountPct: 10, lineTtc: 217.8 }),
  L({ reference: 'MO-VIP1', designation: 'MO ATELIER VIP1', lineType: 'main_oeuvre', quantity: 5.5, unitPriceHt: 80, lineTtc: 532.4 }),
  L({ lineType: 'vide', designation: '' }),
  L({ lineType: 'texte', designation: 'PREMIER ENTRETIEN\nOFFERT' }),
  L({ reference: 'LIVRE', designation: 'Livre Ducati', unitPriceHt: 50, vatRate: 6, lineTtc: 53 }),
];
const asInputs: LineInput[] = lines.map((l) => ({
  designation: l.designation, quantity: l.quantity, unit_price_ht: l.unitPriceHt, vat_rate: l.vatRate,
  discount_pct: l.discountPct, line_type: l.lineType as LineInput['line_type'],
}));

test('détail TVA : deux taux, lignes texte et vide ignorées, cohérent avec computeTotals', () => {
  const rows = vatBreakdown(lines);
  // 21 % : 8256,20 + 180 + 440 = 8876,20 ; 6 % : 50
  expect(rows).toEqual([
    { rate: 21, base: 8876.2, vat: 1864.0 },
    { rate: 6, base: 50, vat: 3 },
  ]);
  const tot = computeTotals(asInputs);
  expect(tot.total_ht).toBe(8926.2);
  expect(Math.round(rows.reduce((s, r) => s + r.vat, 0) * 100) / 100).toBe(tot.total_vat);
});

test('détail TVA : remise globale au prorata, port à son taux, détaxe à 0 %', () => {
  const pied = { globalDiscountAmount: 892.62, shippingHt: 20, shippingVatRate: 21 };
  const rows = vatBreakdown(lines, pied);
  const tot = computeTotals(asInputs, pied);
  expect(Math.round(rows.reduce((s, r) => s + r.base, 0) * 100) / 100).toBe(tot.total_ht);
  expect(Math.abs(rows.reduce((s, r) => s + r.vat, 0) - tot.total_vat)).toBeLessThan(0.02);
  const exempt = vatBreakdown(lines, { taxExempt: true });
  expect(exempt).toEqual([{ rate: 0, base: 8926.2, vat: 0 }]);
});

test('validité : devis 1 mois par défaut, réglable, désactivable', () => {
  expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
  expect(validityMention('DEV', '2026-09-19', [])).toBe('Devis valable 1 mois (jusqu\'au 19/10/2026)');
  expect(validityMention('FAC', '2026-09-19', [])).toBeNull();
  expect(validityMention('DEV', '2026-09-19', [{ docType: 'DEV', text: 'Offre valable jusqu\'au {date}', months: 2, active: true }]))
    .toBe('Offre valable jusqu\'au 19/11/2026');
  expect(validityMention('DEV', '2026-09-19', [{ docType: 'DEV', text: 'x', months: 1, active: false }])).toBeNull();
  expect(validityMention('BC', '2026-09-19', [{ docType: 'BC', text: 'Prix garantis 15 jours', months: 0, active: true }]))
    .toBe('Prix garantis 15 jours');
});

test('montants et nom de fichier', () => {
  expect(eurPdf(10862.2)).toBe('10 862,20 €');
  expect(eurPdf(-5)).toBe('-5,00 €');
  expect(salesPdfFileName('DEV', 'DEV-2026-0012')).toBe('Devis-proforma_DEV-2026-0012.pdf');
  expect(salesPdfFileName('RES', null)).toBe('Reservation_BROUILLON.pdf');
});

const input = (): SalesPdfInput => {
  const tot = computeTotals(asInputs);
  return {
    docType: 'DEV', number: 'DEV-2026-0012', issueDate: '2026-09-19', createdAt: '2026-09-19T10:15:00Z',
    dueDate: null, condition: null, operator: 'Domenico', clientCode: 'C1234',
    company: { name: 'ITALBIKE STORE', address: 'Chaussée de Test 1', zip: '1000', city: 'Bruxelles', vatNumber: 'BE0000000000', iban: 'BE00 0000 0000 0000', cgv: 'Article 1\nArticle 2', footer: 'Merci de votre confiance' },
    clientLines: ['MOREAU 2 SIMON', 'Rue du Test 2', '1000 Bruxelles'],
    vehicleLines: [],
    lines,
    payments: [{ date: '2026-09-19', label: 'ACOMPTE virement', amount: 1000, received: true }],
    taxExempt: false, isMarge: false, pied: {},
    totals: { ht: tot.total_ht, vat: tot.total_vat, ttc: tot.total_ttc, paid: 1000 },
    validity: validityMention('DEV', '2026-09-19', []),
  };
};

test('PDF : non vide, en-tête %PDF, bons totaux et reste à payer imprimés', async () => {
  const d = input();
  expect(d.totals.ttc).toBe(10793.2);          // 8926,20 HT + 1867,00 TVA
  const bytes = await buildSalesDocumentPdf(d);
  expect(bytes.length).toBeGreaterThan(2000);
  expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-');

  const raw = new TextDecoder('latin1').decode(await buildSalesDocumentPdfUncompressed(d));
  for (const s of [
    'DEV-2026-0012', 'ITALBIKE STORE', 'MOREAU 2 SIMON', 'Domenico',
    '8 926,20', '1 867,00', '10 793,20',        // net HT, TVA, net TTC
    '1 864,00', '3,00',                          // TVA 21 % et 6 %
    '1 000,00', '9 793,20',                      // acompte et reste à payer
    '5,50 h', 'PREMIER ENTRETIEN', 'OFFERT',     // MO en heures, commentaire multi-lignes
    'Devis valable 1 mois', 'Bon pour accord', 'Article 2', 'Page 1 / 2',
  ]) expect(raw).toContain(s);
});

test('PDF : facture sans case signature ni validité, beaucoup de lignes = plusieurs pages', async () => {
  const d = { ...input(), docType: 'FAC', validity: null, company: { name: 'X' },
    lines: Array.from({ length: 80 }, (_, i) => L({ reference: `R${i}`, designation: `Pièce ${i}`, unitPriceHt: 10, lineTtc: 12.1 })) };
  const raw = new TextDecoder('latin1').decode(await buildSalesDocumentPdfUncompressed(d));
  expect(raw).not.toContain('Bon pour accord');
  expect(raw).toContain('Page 2 / ');
});
