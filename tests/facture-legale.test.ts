/**
 * Tests lot « facture légale » (03/11/2026, VEN006 / M12 ; étude docs/etudes/2026-11-facturation-peppol-compta.md) :
 * journal des ventes après avoir, avoir partiel, facture d'acompte et déduction, champs UBL Peppol,
 * détaxe G, BillingReference, mentions légales FR + langue du client, copie comptable, empreinte du PDF.
 * Le comportement en base (FAA automatique, registre TVA, écritures) est testé à blanc par
 * supabase/tests/m6_facture_legale.sql (transaction annulée).
 */
import { test, expect, describe } from 'bun:test';
import {
  creditableQuantities, isFullCreditNote, creditNoteSettlement, canGenerateCreditNote, isClosedDocStatus,
  depositInvoiceRequired, depositInvoiceTotals, depositInvoiceDeadline, depositInvoiceItems, CREDITED_STATUS,
} from '../src/modules/sales/write-api';
import { creditChoiceSummary, defaultCreditChoice, buildConfirmSummary, type ConfirmLine } from '../src/modules/sales/confirm';
import { isOpenForBalance } from '../src/modules/sales/balance';
import { journalTotals, ublLinesFromRows } from '../src/modules/accounting/api';
import {
  buildUblInvoice, computeUbl, peppolEndpoint, ublExportBlockers, belgianCompanyNumber, MARGIN_EXEMPTION_TEXT, type UblInvoice,
} from '../src/modules/accounting/ubl';
import { invoiceLegalMentions, formatCompanyNumber } from '../src/modules/sales/invoice-legal';
import { accountantCopy, sha256Hex } from '../src/modules/sales/document-mail-api';
import { sha256Base64, attachmentsWithHash } from '../supabase/functions/_shared/mail-message.ts';
import { normalizeCompanyNumber, suggestedPeppolId } from '../src/modules/settings/companies-api';

// ---------------------------------------------------------------------------------------------
describe('journal des ventes après un avoir', () => {
  test('une facture compensée par un avoir reste au journal : facture + avoir = 0', () => {
    const rows = [
      { total_ht: 1000, total_vat: 210, total_ttc: 1210 },          // FAC (avoir_emis)
      { total_ht: -1000, total_vat: -210, total_ttc: -1210 },       // AVO total
    ];
    expect(journalTotals(rows)).toEqual({ ht: 0, vat: 0, ttc: 0 });
  });
  test('avoir partiel : le journal garde le reste de la facture', () => {
    expect(journalTotals([
      { total_ht: 1000, total_vat: 210, total_ttc: 1210 },
      { total_ht: -500, total_vat: -105, total_ttc: -605 },
    ])).toEqual({ ht: 500, vat: 105, ttc: 605 });
  });
  test('facture d acompte + facture finale : la vente n est comptée qu une fois', () => {
    expect(journalTotals([
      { total_ht: 413.22, total_vat: 86.78, total_ttc: 500 },                                                      // FAA
      { total_ht: 1000, total_vat: 210, total_ttc: 1210, prepaid_ht: 413.22, prepaid_vat: 86.78, prepaid_ttc: 500 }, // FAC
    ])).toEqual({ ht: 1000, vat: 210, ttc: 1210 });
  });
  test('statut avoir_emis : document fermé, plus d avoir ni d encaissement', () => {
    expect(isClosedDocStatus(CREDITED_STATUS)).toBe(true);
    expect(canGenerateCreditNote({ doc_type: 'FAC', status: CREDITED_STATUS })).toBe(false);
    expect(canGenerateCreditNote({ doc_type: 'FAC', status: 'payee' })).toBe(true);
    expect(canGenerateCreditNote({ doc_type: 'FAA', status: 'payee' })).toBe(true);
    expect(isOpenForBalance({ doc_type: 'FAC', status: CREDITED_STATUS })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('avoir partiel', () => {
  const inv = [
    { id: 'l1', article_id: 'a1', designation: 'Casque', unit_price_ht: 100, quantity: 2, line_type: 'article' },
    { id: 'l2', article_id: null, designation: 'Main d oeuvre', unit_price_ht: 60, quantity: 1.5, line_type: 'main_oeuvre' },
    { id: 'l3', article_id: null, designation: 'Merci', unit_price_ht: 0, quantity: 0, line_type: 'texte' },
  ];
  test('quantités restantes après un premier avoir', () => {
    const prev = [{ article_id: 'a1', designation: 'Casque', unit_price_ht: 100, quantity: -1, line_type: 'article' }];
    const rem = creditableQuantities(inv, prev);
    expect(rem.get('l1')).toBe(1);
    expect(rem.get('l2')).toBe(1.5);
    expect(rem.get('l3')).toBe(0);
  });
  test('avoir total = toutes les quantités restantes ; sinon partiel', () => {
    const rem = creditableQuantities(inv, []);
    expect(isFullCreditNote(rem, [{ lineId: 'l1', quantity: 2 }, { lineId: 'l2', quantity: 1.5 }])).toBe(true);
    expect(isFullCreditNote(rem, [{ lineId: 'l1', quantity: 1 }])).toBe(false);
  });
  test('règlement : l avoir solde d abord le dû, puis rembourse le surplus', () => {
    // facture 242 € payée 100 € en CB ; avoir partiel de 121 € → 121 € lettrés, rien à rembourser
    expect(creditNoteSettlement({ total_ttc: 242 }, [{ method: 'CB', amount: 100 }], -121)).toEqual({ settled: 121, refunds: [] });
    // facture payée en totalité → remboursement au mode d origine
    expect(creditNoteSettlement({ total_ttc: 242 }, [{ method: 'VIR', amount: 242 }], -121)).toEqual({ settled: 0, refunds: [{ method: 'VIR', amount: 121 }] });
  });
  test('fenêtre de l avoir : quantités par défaut = tout, total au prorata', () => {
    const lines: ConfirmLine[] = [
      { designation: 'Casque', quantity: -2, lineTtc: -242, lineId: 'l1', maxQuantity: 2 },
      { designation: 'MO', quantity: -1.5, lineTtc: -108.9, lineId: 'l2', maxQuantity: 1.5 },
    ];
    const all = creditChoiceSummary(lines, defaultCreditChoice(lines));
    expect(all.full).toBe(true);
    expect(all.totalTtc).toBe(-350.9);
    const part = creditChoiceSummary(lines, new Map([['l1', 1], ['l2', 0]]));
    expect(part.full).toBe(false);
    expect(part.totalTtc).toBe(-121);
    expect(part.lines).toHaveLength(1);
    const sum = buildConfirmSummary({ action: 'creditNote', docType: 'AVO', totalTtc: part.totalTtc, lines: part.lines, partialCredit: true });
    expect(sum.consequences).toContain('confirmInvoiceCreditedPartial');
    expect(sum.consequences).not.toContain('confirmInvoiceCancelled');
  });
});

// ---------------------------------------------------------------------------------------------
describe('facture d acompte', () => {
  test('obligatoire (automatique) pour une moto ou un client assujetti, sur demande sinon', () => {
    expect(depositInvoiceRequired({ vehicleId: 'v1', contactVat: null, lineMgmtTypes: [] })).toBe(true);
    expect(depositInvoiceRequired({ vehicleId: null, contactVat: 'BE0123456749', lineMgmtTypes: [] })).toBe(true);
    expect(depositInvoiceRequired({ vehicleId: null, contactVat: null, lineMgmtTypes: ['A', 'V'] })).toBe(true);
    expect(depositInvoiceRequired({ vehicleId: null, contactVat: '  ', lineMgmtTypes: ['A', 'M'] })).toBe(false);
  });
  test('montant encaissé TTC ventilé au taux du document ; détaxe = 0 %', () => {
    expect(depositInvoiceTotals(500, 21)).toEqual({ ht: 413.22, vat: 86.78, ttc: 500, rate: 21 });
    expect(depositInvoiceTotals(500, 21, true)).toEqual({ ht: 500, vat: 0, ttc: 500, rate: 0 });
  });
  test('date limite : le 15 du mois suivant l encaissement (AR 1 art. 4)', () => {
    expect(depositInvoiceDeadline('2026-11-03')).toBe('2026-12-15');
    expect(depositInvoiceDeadline('2026-12-31T10:00:00Z')).toBe('2027-01-15');
  });
  test('acomptes listés avec leur FAA ; financement et lettrage par avoir exclus', () => {
    const items = depositInvoiceItems([
      { id: 'p1', amount: 500, status: 'recu', paid_at: '2026-11-03T10:00:00Z', method: 'VIR' },
      { id: 'p2', amount: 300, status: 'recu', paid_at: '2026-11-04', method: 'ESP', deposit_invoice_id: 'f0' },
      { id: 'p3', amount: 1000, status: 'recu', paid_at: '2026-11-04', method: 'VIR', from_financing: true },
      { id: 'p4', amount: 50, status: 'attendu', paid_at: '2026-11-05', method: 'VIR' },
    ], [{ id: 'f1', number: 'FAA-2026-00001', issue_date: '2026-11-03', total_ttc: 500, total_vat: 86.78, deposit_payment_id: 'p1' }]);
    expect(items.map((i) => [i.paymentId, i.invoice?.id ?? null])).toEqual([['p1', 'f1'], ['p2', 'f0']]);
  });
});

// ---------------------------------------------------------------------------------------------
const supplier = { name: 'ITALBIKE STORE', vat: 'BE0472540151', street: 'Chaussée de Bruxelles 688', zip: '1410', city: 'Waterloo', country: 'BE', peppolId: '0208:0472540151', companyNumber: '0472540151' };
const base: UblInvoice = {
  number: 'FAC-2026-00012', issueDate: '2026-11-03', dueDate: '2026-12-03', isCredit: false,
  supplier,
  customer: { name: 'MOTO CLIENT SRL', vat: 'BE0123456749', street: 'Rue X 1', zip: '1000', city: 'Bruxelles', country: 'BE', peppolId: null },
  iban: 'BE13 1030 5292 0339', totalHt: 180, totalVat: 37.8, totalTtc: 217.8, taxExempt: false,
  lines: [{ id: 1, designation: 'Casque', quantity: 2, unitPriceHt: 100, lineHt: 180, vatRate: 21, discountPct: 10 }],
};

describe('UBL Peppol BIS 3.0', () => {
  test('identifiants 0208 du vendeur et de l acheteur (n° BCE), BuyerReference « NA »', () => {
    const xml = buildUblInvoice(base);
    expect(xml).toContain('<cbc:EndpointID schemeID="0208">0472540151</cbc:EndpointID>');
    expect(xml).toContain('<cbc:EndpointID schemeID="0208">0123456749</cbc:EndpointID>');
    expect(xml).toContain('<cbc:CompanyID schemeID="0208">0472540151</cbc:CompanyID>');
    expect(xml).toContain('<cbc:BuyerReference>NA</cbc:BuyerReference>');
    expect(xml).not.toMatch(/<(cbc|cac):[A-Za-z]+(\s[^>]*)?><\/(cbc|cac):[A-Za-z]+>/); // aucun élément vide
  });
  test('OrderReference = commande d origine', () => {
    expect(buildUblInvoice({ ...base, orderReference: 'RES-2026-00004' })).toContain('<cac:OrderReference><cbc:ID>RES-2026-00004</cbc:ID></cac:OrderReference>');
  });
  test('remise de ligne en AllowanceCharge : montant = qté × prix − remise', () => {
    const xml = buildUblInvoice(base);
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">180.00</cbc:LineExtensionAmount><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator>');
    expect(xml).toContain('<cbc:Amount currencyID="EUR">20.00</cbc:Amount>');
    expect(xml).toContain('<cbc:PriceAmount currencyID="EUR">100</cbc:PriceAmount>');
  });
  test('facture finale : PrepaidAmount, PayableAmount = TTC − acompte, référence à la FAA', () => {
    const xml = buildUblInvoice({ ...base, prepaidAmount: 100, billingReferences: [{ number: 'FAA-2026-00001', issueDate: '2026-10-20' }] });
    expect(xml).toContain('<cbc:PrepaidAmount currencyID="EUR">100.00</cbc:PrepaidAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">117.80</cbc:PayableAmount>');
    expect(xml).toContain('<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>FAA-2026-00001</cbc:ID><cbc:IssueDate>2026-10-20</cbc:IssueDate>');
  });
  test('facture d acompte : type 386', () => {
    expect(buildUblInvoice({ ...base, number: 'FAA-2026-00001', isPrepayment: true })).toContain('<cbc:InvoiceTypeCode>386</cbc:InvoiceTypeCode>');
  });
  test('détaxe export : catégorie G + VATEX-EU-G, TVA 0', () => {
    const xml = buildUblInvoice({ ...base, taxExempt: true, totalVat: 0, totalTtc: 180 });
    expect(xml).toContain('<cbc:ID>G</cbc:ID><cbc:Percent>0.00</cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-G</cbc:TaxExemptionReasonCode>');
    expect(xml).not.toContain('VATEX-EU-AE');
    expect(xml).toContain('<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>');
  });
  test('avoir : CreditNote 381 + BillingReference vers la facture d origine', () => {
    const xml = buildUblInvoice({ ...base, number: 'AVO-2026-00003', isCredit: true, dueDate: null, billingReferences: [{ number: 'FAC-2026-00012', issueDate: '2026-11-03' }] });
    expect(xml).toContain('<CreditNote');
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toContain('<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>FAC-2026-00012</cbc:ID>');
    expect(xml).toContain('<cac:CreditNoteLine>');
    expect(xml).not.toContain('<cbc:DueDate>');
  });
  test('régime de la marge : catégorie E 0 % + texte légal, montant TTC sans TVA', () => {
    const lines = ublLinesFromRows([{ designation: 'Monster occasion', quantity: 1, unit_price_ht: 8264.46, line_ht: 8264.46, line_ttc: 10000, vat_rate: 21, vat_scheme: 'margin' }]);
    const xml = buildUblInvoice({ ...base, lines, totalHt: 10000, totalVat: 0, totalTtc: 10000 });
    expect(xml).toContain(`<cbc:ID>E</cbc:ID><cbc:Percent>0.00</cbc:Percent><cbc:TaxExemptionReason>${MARGIN_EXEMPTION_TEXT.replace("'", '&apos;')}</cbc:TaxExemptionReason>`);
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">10000.00</cbc:PayableAmount>');
  });
  test('cohérence BR-CO : remise globale en AllowanceCharge de document, TVA par catégorie', () => {
    const c = computeUbl({ ...base, lines: [{ id: 1, designation: 'Pièce', quantity: 1, unitPriceHt: 200, lineHt: 200, vatRate: 21 }], totalHt: 180, totalVat: 37.8, totalTtc: 217.8 });
    expect(c.lineTotal).toBe(200);
    expect(c.docAllowance).toBe(20);
    expect(c.taxExclusive).toBe(180);
    expect(c.taxTotal).toBe(37.8);
    expect(c.payable).toBe(217.8);
  });
  test('lignes texte exclues, prix jamais négatif', () => {
    const lines = ublLinesFromRows([
      { designation: 'Texte', quantity: 0, unit_price_ht: 0, line_ht: 0, line_ttc: 0, vat_rate: 21, line_type: 'texte' },
      { designation: 'Reprise', quantity: 1, unit_price_ht: -50, line_ht: -50, line_ttc: -60.5, vat_rate: 21, line_type: 'article' },
    ]);
    expect(lines).toHaveLength(1);
    const xml = buildUblInvoice({ ...base, lines: [...base.lines, ...lines], totalHt: 130, totalVat: 27.3, totalTtc: 157.3 });
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="C62">-1</cbc:InvoicedQuantity>');
    expect(xml).not.toContain('<cbc:PriceAmount currencyID="EUR">-');
  });
  test('particulier : pas d identifiant (EM refusé par la liste EAS, validateur 2026.5) ; TVA étrangère : schéma du pays', () => {
    expect(peppolEndpoint({ name: 'X', vat: null, street: null, zip: null, city: null, country: 'BE', peppolId: null, email: 'a@b.be' })).toBeNull();
    expect(peppolEndpoint({ name: 'X', vat: 'CHE123456789', street: null, zip: null, city: null, country: 'CH', peppolId: null })).toEqual({ scheme: '9927', id: 'CHE123456789' });
    expect(peppolEndpoint({ name: 'X', vat: 'FR12345678901', street: null, zip: null, city: null, country: 'FR', peppolId: null })).toEqual({ scheme: '9957', id: 'FR12345678901' });
    expect(belgianCompanyNumber('BE 0472.540.151')).toBe('0472540151');
  });
  test('export refusé sans n° BCE ni identifiant Peppol 0208 sur la fiche société', () => {
    expect(ublExportBlockers({ ...supplier, companyNumber: null, peppolId: null })).toEqual(['missingCompanyNumber', 'missingPeppolId']);
    expect(ublExportBlockers({ ...supplier, peppolId: '9925:BE0472540151' })).toEqual(['missingPeppolId']);
    expect(ublExportBlockers(supplier)).toEqual([]);
    expect(normalizeCompanyNumber('BE 0472.540.151')).toBe('0472540151');
    expect(suggestedPeppolId('472540151')).toBe('0208:0472540151');
  });
});

// ---------------------------------------------------------------------------------------------
describe('mentions légales', () => {
  test('avoir : référence n° + date de la facture et mention AR 4, en FR puis NL', () => {
    const m = invoiceLegalMentions({ docType: 'AVO', locale: 'nl', totalVat: -21, source: { number: 'FAC-2026-00012', issueDate: '2026-11-03' } });
    expect(m[0]).toBe('Note de crédit relative à la facture n° FAC-2026-00012 du 03/11/2026.');
    expect(m[1]).toContain('FAC-2026-00012');
    expect(m[1]).toContain('Creditnota');
    expect(m[2]).toContain("TVA à reverser à l'État dans la mesure où elle a été initialement déduite");
    expect(m[3]).toContain('in aftrek werd gebracht');
  });
  test('avoir sans TVA : pas de mention AR 4 ; client francophone : FR seul', () => {
    const m = invoiceLegalMentions({ docType: 'AVO', locale: 'fr', totalVat: 0, source: { number: 'FAC-1', issueDate: '2026-11-03' } });
    expect(m).toHaveLength(1);
  });
  test('facture d acompte : date d encaissement et commande ; facture finale : acompte déduit', () => {
    const faa = invoiceLegalMentions({ docType: 'FAA', totalVat: 86.78, depositPaidAt: '2026-11-02T09:00:00Z', source: { number: 'RES-2026-00004', issueDate: '2026-10-30' } });
    expect(faa[0]).toContain('encaissé le 02/11/2026 sur la commande n° RES-2026-00004 du 30/10/2026');
    const fac = invoiceLegalMentions({ docType: 'FAC', locale: 'en', totalVat: 210, prepaid: [{ number: 'FAA-2026-00001', issueDate: '2026-11-03', ttc: 500, vat: 86.78 }] });
    expect(fac[0]).toContain('FAA-2026-00001 du 03/11/2026, 500,00 € TVAC dont TVA 86,78 €');
    expect(fac[1]).toContain('Deposit already invoiced');
  });
  test('détaxe : mention art. 39 en FR + langue du client', () => {
    const m = invoiceLegalMentions({ docType: 'FAC', locale: 'it', totalVat: 0, taxExempt: true });
    expect(m).toHaveLength(2);
    expect(m[0]).toContain('art. 39');
  });
  test('n° BCE lisible', () => {
    expect(formatCompanyNumber('0472540151')).toBe('0472.540.151');
  });
});

// ---------------------------------------------------------------------------------------------
describe('mail de facture', () => {
  test('copie comptable : facture / avoir / FAA seulement, adresse réglable, vide par défaut', () => {
    expect(accountantCopy('FAC', null, 'client@x.be')).toEqual([]);
    expect(accountantCopy('FAC', 'Compta@Fidu.be ', 'client@x.be')).toEqual(['compta@fidu.be']);
    expect(accountantCopy('DEV', 'compta@fidu.be', 'client@x.be')).toEqual([]);
    expect(accountantCopy('AVO', 'pas-une-adresse', 'client@x.be')).toEqual([]);
  });
  test('empreinte SHA-256 du PDF : même valeur côté navigateur et côté fonction serveur', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 test');
    const b64 = btoa(String.fromCharCode(...bytes));
    const h = await sha256Hex(bytes);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Base64(b64)).toBe(h);
    const [a] = await attachmentsWithHash([{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'FAC.pdf', contentType: 'application/pdf', contentBytes: b64 }]);
    expect(a.sha256).toBe(h);
    expect(a.size).toBe(bytes.length);
  });
});
