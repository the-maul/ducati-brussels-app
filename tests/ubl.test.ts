/**
 * Tests M12 — Génération UBL (Peppol BIS 3.0) : structure facture / avoir.
 */
import { test, expect } from 'bun:test';
import { buildUblInvoice, type UblInvoice } from '../src/modules/accounting/ubl';

const base: UblInvoice = {
  number: 'FAC-2026-00001', issueDate: '2026-06-11', dueDate: '2026-07-11', isCredit: false,
  supplier: { name: 'ITALBIKE', vat: 'BE0123456789', street: 'Rue X 1', zip: '1000', city: 'Bruxelles', country: 'BE', peppolId: null },
  customer: { name: 'Client', vat: null, street: null, zip: null, city: null, country: 'BE', peppolId: null },
  iban: 'BE00 0000 0000 0000', totalHt: 100, totalVat: 21, totalTtc: 121, taxExempt: false,
  lines: [{ id: 1, designation: 'Pièce', quantity: 1, unitPriceHt: 100, lineHt: 100, vatRate: 21 }],
};

test('facture UBL : profil Peppol + montants', () => {
  const xml = buildUblInvoice(base);
  expect(xml).toContain('<Invoice');
  expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0');
  expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
  expect(xml).toContain('<cbc:ID>FAC-2026-00001</cbc:ID>');
  expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>');
  expect(xml).toContain('schemeID="9925"'); // endpoint TVA belge
});

test('avoir UBL : type 381 + racine CreditNote', () => {
  const xml = buildUblInvoice({ ...base, isCredit: true });
  expect(xml).toContain('<CreditNote');
  expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
});

test('détaxe : catégorie exonérée', () => {
  const xml = buildUblInvoice({ ...base, taxExempt: true, totalVat: 0, totalTtc: 100 });
  expect(xml).toContain('<cbc:ID>E</cbc:ID>');
});
