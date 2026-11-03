/**
 * Tests B2 — TVA sur la marge a la vente (regle 7 ; decision M-89 du 03/11/2026, VEN005).
 * Moto d occasion rachetee a un particulier (O) : aucune TVA sur la facture, prix TTC = prix
 * convenu, mention legale dans la langue du client ; TVA due globale par periode de declaration
 * (ventes − achats, report de la marge negative, AR 53 art. 3) ; P et V inchanges (21 %).
 */
import { test, expect } from 'bun:test';
import { computeTotals, piedWithoutVat, isMargeDocument, isMissingMargeColumn, type LineInput } from '../src/modules/sales/write-api';
import {
  detectVatScheme, vatSchemeError, marginPurchasePrice, marginPeriods, marginVat, MARGIN_MENTION_KEY,
  type ArticleVatInfo,
} from '../src/modules/sales/vat-scheme';
import { buildUblInvoice, type UblInvoice } from '../src/modules/accounting/ubl';
import {
  voMarginCsv, voMarginWinbooksRows, parseVatMarginSettings, DEFAULT_VAT_MARGIN_SETTINGS, type VoMarginPeriod,
} from '../src/modules/accounting/api';
import { buildSalesDocumentPdfUncompressed, type SalesPdfInput, type SalesPdfLine } from '../src/modules/sales/document-pdf';
import { tIn, LOCALES } from '../src/lib/i18n';

const arts = new Map<string, ArticleVatInfo>([
  ['moto-o', { mgmt_type: 'O', purchase_price: 8000 }],
  ['moto-o2', { mgmt_type: 'O', purchase_price: 6000 }],
  ['moto-o-sans-reprise', { mgmt_type: 'O', purchase_price: 0 }],
  ['moto-p', { mgmt_type: 'P', purchase_price: 7000 }],
  ['moto-v', { mgmt_type: 'V', purchase_price: 15000 }],
  ['piece', { mgmt_type: 'A', purchase_price: 10 }],
]);
const line = (p: Partial<LineInput> = {}): LineInput => ({
  designation: 'x', quantity: 1, unit_price_ht: 12000, vat_rate: 21, discount_pct: 0, line_type: 'article', ...p,
});

// ---------------------------------------------------------------------------------------------
// Totaux
// ---------------------------------------------------------------------------------------------
test('totaux marge : aucune TVA, prix TTC = prix convenu, quel que soit le taux de la ligne', () => {
  const r = computeTotals([line({ article_id: 'moto-o', vat_rate: 21 })], { vatScheme: 'marge' });
  expect(r.total_vat).toBe(0);
  expect(r.total_ht).toBe(12000);
  expect(r.total_ttc).toBe(12000);
  expect(piedWithoutVat({ vatScheme: 'marge' })).toBe(true);
});

test('totaux marge : un net TTC force change le prix, jamais la TVA', () => {
  const r = computeTotals([line({ article_id: 'moto-o' })], { vatScheme: 'marge', forcedTtc: 11500 });
  expect(r.total_ttc).toBe(11500);
  expect(r.total_ht).toBe(11500);
  expect(r.total_vat).toBe(0);
});

test('P et V inchanges : 21 % sur le prix total, regime normal', () => {
  for (const id of ['moto-p', 'moto-v']) {
    const ls = [line({ article_id: id, unit_price_ht: 10000 })];
    expect(detectVatScheme(ls, arts)).toBe('normal');
    const r = computeTotals(ls, { vatScheme: detectVatScheme(ls, arts) });
    expect(r.total_ht).toBe(10000);
    expect(r.total_vat).toBe(2100);
    expect(r.total_ttc).toBe(12100);
  }
  // sans regime precise (historique) : meme resultat
  expect(computeTotals([line({ unit_price_ht: 100 })]).total_ttc).toBe(121);
});

test('avoir d une vente marge : montants negatifs, toujours sans TVA', () => {
  const r = computeTotals([line({ article_id: 'moto-o', quantity: -1 })], { vatScheme: 'marge' });
  expect(r.total_ttc).toBe(-12000);
  expect(r.total_vat).toBe(0);
  // le prix de reprise fige de la facture dispense de relire l article (avoir)
  expect(vatSchemeError({ lines: [line({ article_id: 'moto-o-sans-reprise', quantity: -1 })], articles: arts, requirePurchasePrice: true, knownPurchasePrice: 8000 })).toBeNull();
});

// ---------------------------------------------------------------------------------------------
// Detection et refus
// ---------------------------------------------------------------------------------------------
test('detection : une moto O fait passer le document en marge, une ligne texte ne change rien', () => {
  expect(detectVatScheme([line({ article_id: 'moto-o' }), line({ line_type: 'texte', designation: 'Garantie 6 mois' })], arts)).toBe('marge');
  expect(detectVatScheme([line({ article_id: 'piece' })], arts)).toBe('normal');
  expect(isMargeDocument({ vat_scheme: 'marge' })).toBe(true);
  expect(isMargeDocument({ vat_scheme: 'normal' })).toBe(false);
  expect(isMargeDocument({})).toBe(false);
});

test('refus : impossible de facturer une O sans prix de reprise', () => {
  const ls = [line({ article_id: 'moto-o-sans-reprise' })];
  expect(vatSchemeError({ lines: ls, articles: arts, requirePurchasePrice: true })).toBe('margeNoPurchasePrice');
  expect(marginPurchasePrice(ls, arts)).toBeNull();
  // un devis / une reservation peut partir sans reprise chiffree (pas de vente effective)
  expect(vatSchemeError({ lines: ls, articles: arts, requirePurchasePrice: false })).toBeNull();
});

test('refus : une moto O = un document a part (ni piece, ni MO, ni port)', () => {
  expect(vatSchemeError({ lines: [line({ article_id: 'moto-o' }), line({ article_id: 'piece', unit_price_ht: 100 })], articles: arts, requirePurchasePrice: true })).toBe('margeMixed');
  expect(vatSchemeError({ lines: [line({ article_id: 'moto-o' }), line({ line_type: 'main_oeuvre', unit_price_ht: 80 })], articles: arts, requirePurchasePrice: true })).toBe('margeMixed');
  expect(vatSchemeError({ lines: [line({ article_id: 'moto-o' })], pied: { shippingHt: 50 }, articles: arts, requirePurchasePrice: true })).toBe('margeShipping');
  expect(vatSchemeError({ lines: [line({ article_id: 'moto-o' }), line({ line_type: 'texte', designation: 'note' })], articles: arts, requirePurchasePrice: true })).toBeNull();
});

test('prix de reprise fige : prix de reprise seul (ORO jamais ajoute), une moto par ligne', () => {
  expect(marginPurchasePrice([line({ article_id: 'moto-o' })], arts)).toBe(8000);
  expect(marginPurchasePrice([line({ article_id: 'moto-o' }), line({ article_id: 'moto-o2' })], arts)).toBe(14000);
});

test('migration non posee : erreur de colonne reconnue pour reecrire l en-tete sans le regime', () => {
  expect(isMissingMargeColumn({ code: 'PGRST204', message: "Could not find the 'vat_scheme' column of 'documents'" })).toBe(true);
  expect(isMissingMargeColumn({ code: '23514', message: 'autre refus' })).toBe(false);
  expect(isMissingMargeColumn(null)).toBe(false);
});

// ---------------------------------------------------------------------------------------------
// Base globale par periode (meme calcul que la fonction SQL vo_margin_periods)
// ---------------------------------------------------------------------------------------------
test('base globale : 2 periodes, marge negative reportee sur la suivante', () => {
  const [nov, dec] = marginPeriods([
    { period: '2026-11', sales: 5000, purchases: 8000 },   // vente Y 5000, reprise X 8000
    { period: '2026-12', sales: 12000, purchases: 0 },     // vente X 12000
  ]);
  expect(nov.margin).toBe(-3000);
  expect(nov.vatDue).toBe(0);
  expect(nov.baseHt).toBe(0);
  expect(nov.carriedOut).toBe(-3000);
  expect(dec.carriedIn).toBe(-3000);
  expect(dec.margin).toBe(9000);
  expect(dec.baseHt).toBe(7438.02);   // 9000 × 100 / 121
  expect(dec.vatDue).toBe(1561.98);   // TVA comprise dans la marge
  expect(dec.carriedOut).toBe(0);
});

test('base globale : un avoir retire la vente de la periode de l avoir', () => {
  const [p1, p2] = marginPeriods([
    { period: '2027-01', sales: 12000, purchases: 8000 },
    { period: '2027-02', sales: -12000, purchases: 0 },
  ]);
  expect(p1.vatDue).toBe(694.21);     // 4000 × 21 / 121
  expect(p2.margin).toBe(-12000);
  expect(p2.vatDue).toBe(0);
  expect(p2.carriedOut).toBe(-12000);
  expect(marginVat(0)).toEqual({ baseHt: 0, vatDue: 0 });
});

// ---------------------------------------------------------------------------------------------
// Mention legale (4 langues), PDF, UBL
// ---------------------------------------------------------------------------------------------
test('mention legale de la marge dans les 4 langues du client', () => {
  expect(tIn('fr', MARGIN_MENTION_KEY)).toBe('Livraison soumise au régime particulier d\'imposition de la marge bénéficiaire. TVA non déductible.');
  expect(tIn('nl', MARGIN_MENTION_KEY)).toContain('winstmarge');
  expect(tIn('en', MARGIN_MENTION_KEY)).toContain('profit margin');
  expect(tIn('it', MARGIN_MENTION_KEY)).toContain('margine');
  expect(new Set(LOCALES.map((l) => tIn(l, MARGIN_MENTION_KEY))).size).toBe(LOCALES.length);
  for (const l of LOCALES) for (const k of ['sales.margeMixed', 'sales.margeNoPurchasePrice', 'sales.margeShipping', 'accounting.voVatDue']) {
    expect(tIn(l, k)).not.toBe(k);
  }
});

const pdfLine = (p: Partial<SalesPdfLine>): SalesPdfLine => ({
  lineType: 'article', reference: 'OCC-1', designation: 'Monster 821 occasion', quantity: 1, unitPriceHt: 12000, vatRate: 0, discountPct: 0, lineTtc: 12000, ...p,
});
const pdfInput = (locale: SalesPdfInput['locale']): SalesPdfInput => ({
  docType: 'FAC', number: 'FAC-2026-0100', issueDate: '2026-12-10', createdAt: '2026-12-10T10:00:00Z',
  dueDate: null, condition: null, operator: 'Domenico', clientCode: null,
  company: { name: 'ITALBIKE STORE' }, clientLines: ['CLIENT TEST'], vehicleLines: [],
  lines: [pdfLine({})], payments: [], taxExempt: false, isMarge: true, pied: {},
  totals: { ht: 12000, vat: 0, ttc: 12000, paid: 0 }, validity: null, locale,
});

test('PDF marge : mention dans la langue du client, aucune ventilation ni montant de TVA', async () => {
  const fr = new TextDecoder('latin1').decode(await buildSalesDocumentPdfUncompressed(pdfInput('fr')));
  expect(fr).toContain('Livraison soumise au r');
  expect(fr).not.toContain('MONTANT TVA');
  expect(fr).not.toContain('TAUX TVA');
  expect(fr).toContain('12 000,00');
  const nl = new TextDecoder('latin1').decode(await buildSalesDocumentPdfUncompressed(pdfInput('nl')));
  expect(nl).toContain('Levering onderworpen');
  // facture ordinaire : la ventilation reste
  const normal = new TextDecoder('latin1').decode(await buildSalesDocumentPdfUncompressed({
    ...pdfInput('fr'), isMarge: false, lines: [pdfLine({ vatRate: 21, lineTtc: 12100 })], totals: { ht: 12000, vat: 2520, ttc: 14520, paid: 0 },
  }));
  expect(normal).toContain('MONTANT TVA');
});

const ubl = (p: Partial<UblInvoice>): string => buildUblInvoice({
  number: 'FAC-2026-0100', issueDate: '2026-12-10', dueDate: null, isCredit: false,
  supplier: { name: 'ITALBIKE STORE', vat: 'BE0000000000', street: null, zip: null, city: null, country: 'BE', peppolId: null },
  customer: { name: 'Client', vat: null, street: null, zip: null, city: null, country: 'BE', peppolId: null },
  iban: null, totalHt: 12000, totalVat: 0, totalTtc: 12000, taxExempt: false,
  lines: [{ id: 1, designation: 'Monster 821 occasion', quantity: 1, unitPriceHt: 12000, lineHt: 12000, vatRate: 0 }], ...p,
});

test('UBL marge (BEG 9) : categorie E a 0 %, motif en texte, jamais O ni code VATEX', () => {
  const xml = ubl({ vatScheme: 'marge', marginReason: tIn('nl', MARGIN_MENTION_KEY) });
  expect(xml).toContain('<cbc:ID>E</cbc:ID><cbc:Percent>0.00</cbc:Percent>');
  expect(xml).toContain('<cbc:TaxExemptionReason>Levering onderworpen');
  expect(xml).not.toContain('VATEX');
  expect(xml).not.toContain('<cbc:ID>O</cbc:ID>');
  expect(xml).not.toContain('<cbc:ID>S</cbc:ID>');
  // une facture ordinaire reste en S 21 %
  const normal = ubl({ totalVat: 2520, totalTtc: 14520, lines: [{ id: 1, designation: 'Panigale V4', quantity: 1, unitPriceHt: 12000, lineHt: 12000, vatRate: 21 }] });
  expect(normal).toContain('<cbc:ID>S</cbc:ID><cbc:Percent>21.00</cbc:Percent>');
});

// ---------------------------------------------------------------------------------------------
// Exports (CSV registre, OD Winbooks) et reglages parametrables
// ---------------------------------------------------------------------------------------------
const periods: VoMarginPeriod[] = [
  { period_key: '2026-11', period_start: '2026-11-01', period_end: '2026-11-30', count_sales: 1, count_purchases: 1, sales: 5000, purchases: 8000, carried_in: 0, margin: -3000, base_ht: 0, vat_due: 0, carried_out: -3000 },
  { period_key: '2026-12', period_start: '2026-12-01', period_end: '2026-12-31', count_sales: 1, count_purchases: 0, sales: 12000, purchases: 0, carried_in: -3000, margin: 9000, base_ht: 7438.02, vat_due: 1561.98, carried_out: 0 },
];

test('reglages : defauts, valeurs du parametrage, ligne inactive ignoree', () => {
  expect(parseVatMarginSettings([])).toEqual(DEFAULT_VAT_MARGIN_SETTINGS);
  const s = parseVatMarginSettings([
    { code: 'period', label: 'quarter' }, { code: 'rate', label: '21,0' }, { code: 'grid_vat', label: '55' },
    { code: 'winbooks_vat_code', label: 'X', is_active: false },
  ]);
  expect(s.period).toBe('quarter');
  expect(s.rate).toBe(21);
  expect(s.grid_vat).toBe('55');
  expect(s.winbooks_vat_code).toBe(DEFAULT_VAT_MARGIN_SETTINGS.winbooks_vat_code);
});

test('export CSV du registre : periodes avec grilles parametrees, ventes et achats', () => {
  const csv = voMarginCsv({ periods, sales: [], purchases: [], settings: { ...DEFAULT_VAT_MARGIN_SETTINGS, grid_base: '03', grid_vat: '54' } });
  expect(csv).toContain('BaseHT_grille_03');
  expect(csv).toContain('TVA_due_grille_54');
  expect(csv).toContain('2026-12;2026-12-01;2026-12-31;0.00;12000.00;-3000.00;9000.00;7438.02;1561.98;0.00');
});

test('OD Winbooks : une ecriture equilibree par periode avec TVA due, code TVA parametre', () => {
  const rows = voMarginWinbooksRows({ periods, settings: { ...DEFAULT_VAT_MARGIN_SETTINGS, winbooks_vat_code: 'M21' }, salesAccount: '700200', vatAccount: '451090' });
  expect(rows.length).toBe(2);                      // novembre (TVA 0) ne produit rien
  expect(rows[0]).toContain(';700200;');
  expect(rows[0]).toContain(';1561.98;M21');
  expect(rows[1]).toContain(';451090;');
  expect(rows[1]).toContain(';-1561.98;M21');
});
