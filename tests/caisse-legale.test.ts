/**
 * Tests M6 (POS) — caisse conforme au droit belge (PDV010, 03/11/2026). Memes regles qu en base
 * (migration 20261103170000_m6_caisse_legale.sql) :
 *  - journal Z numerote en continu (Z-2026-00001 avant Z-2026-00002), un rapport X n entre pas au journal ;
 *  - Z fige : on lit l instantane de la cloture, rien n est recalcule (reimpression identique) ;
 *  - lignes distinctes des ventes dont le prix unitaire depasse 500 EUR TTC ;
 *  - plafond des especes 3 000 EUR par vente (acomptes compris, contre-passations en moins) ;
 *  - annulation d un reglement = contre-passation (ligne inverse, motif obligatoire) ;
 *  - facture obligatoire : moto toujours, piece / accessoire du vehicule au-dela de 125 EUR TTC ;
 *  - pas d encaissement caisse fermee ; arrondi 5 cents du rendu et des remboursements ;
 *  - motif obligatoire d un ecart de caisse ; export CSV du journal des recettes.
 */
import { test, expect, describe } from 'bun:test';
import {
  parseZReport, isFrozenZ, compareZNumber, journalRows, journalTotals, journalCsv, journalCsvFileName,
  zPdfFileName, isLargeItem, zDay, zMonth,
} from '../src/modules/sales/z-report';
import { CASH_LIMIT_EUR, cashTotal, cashLimitExceeded, reversalLine, reversedIds, varianceReasonMissing } from '../src/modules/sales/cash-rules';
import { familyRequiresInvoice, invoiceRequired, posSessionError, INVOICE_THRESHOLD_TTC, type InvoiceFamilyRule } from '../src/modules/sales/pos-rules';
import { changeDue } from '../src/modules/sales/cash-rounding';
import { refundLines, documentValidationError } from '../src/modules/sales/write-api';
import { zPdfSections, buildZPdf } from '../src/modules/sales/z-report-pdf';

const rawZ = (number: string | null, closedAt: string, extra: Record<string, unknown> = {}) => ({
  version: 2, number, register_code: 'CAISSE-1', session_id: `s-${number ?? 'x'}`,
  company: { name: 'ITALBIKE STORE', legal_name: 'ITALBIKE STORE SRL', vat_number: 'BE0123456789', address: 'Chaussee 1', zip: '1410', city: 'Waterloo' },
  opened_at: '2026-11-03T08:00:00Z', closed_at: closedAt, opening_float: 150, expected_cash: 395.5, counted_cash: 395.5, variance: 0, variance_reason: null,
  documents: [{ doc_type: 'TIK', count: 3, total_ttc: 845.5 }, { doc_type: 'AVO', count: 1, total_ttc: -24.2 }],
  ticket_count: 3,
  vat_breakdown: [{ vat_rate: 21, base_ht: '678.76', vat: '142.54', ttc: '821.30' }],
  discounts_ht: 12.5, refunds_ttc: -24.2, net_sales_ttc: 821.3,
  large_items: [{ number: 'TIK-2026-00012', doc_type: 'TIK', issue_date: '2026-11-03', designation: 'Echappement Termignoni', quantity: 1, line_ttc: 605 }],
  payments_by_method: [{ method: 'ESP', label: 'Especes', sales: 245.5, deposits: 0, refunds: 0, total: 245.5 }, { method: 'MAE', label: 'Carte', sales: 600, deposits: 0, refunds: -24.2, total: 575.8 }],
  cash_in_esp: 0, cash_out_esp: 0, cash_in: 0, cash_out: 0, movements: [],
  ...extra,
});

describe('journal Z — numerotation continue', () => {
  test('Z-2026-00002 apres Z-2026-00001, Z-2026-00010 apres Z-2026-00009 (pas de tri alphabetique)', () => {
    expect(compareZNumber('Z-2026-00001', 'Z-2026-00002')).toBeLessThan(0);
    expect(compareZNumber('Z-2026-00010', 'Z-2026-00009')).toBeGreaterThan(0);
    expect(compareZNumber('Z-2027-00001', 'Z-2026-00999')).toBeGreaterThan(0);
  });
  test('le journal suit le numero d ordre, les rapports X (non numerotes) n y entrent pas', () => {
    const zs = [rawZ('Z-2026-00002', '2026-11-04T18:00:00Z'), rawZ(null, '2026-11-05T12:00:00Z'), rawZ('Z-2026-00001', '2026-11-03T18:00:00Z')].map(parseZReport);
    const rows = journalRows(zs);
    expect(rows.map((r) => r.number)).toEqual(['Z-2026-00001', 'Z-2026-00002']);
  });
  test('un Z numerote est fige, un X ne l est pas', () => {
    expect(isFrozenZ(parseZReport(rawZ('Z-2026-00001', '2026-11-03T18:00:00Z')))).toBe(true);
    expect(isFrozenZ(parseZReport(rawZ(null, '2026-11-03T18:00:00Z')))).toBe(false);
  });
});

describe('journal Z — instantane fige a la cloture', () => {
  test('parseZReport lit sans recalculer (montants en texte convertis, rien d autre ne change)', () => {
    const z = parseZReport(rawZ('Z-2026-00001', '2026-11-03T18:00:00Z'));
    expect(z.vat_breakdown).toEqual([{ vat_rate: 21, base_ht: 678.76, vat: 142.54, ttc: 821.3 }]);
    expect(z.net_sales_ttc).toBe(821.3);
    expect(z.refunds_ttc).toBe(-24.2);
    expect(z.company.vat_number).toBe('BE0123456789');
  });
  test('deux lectures du meme instantane donnent le meme journal (reimpression identique)', () => {
    const snap = rawZ('Z-2026-00001', '2026-11-03T18:00:00Z');
    expect(parseZReport(JSON.parse(JSON.stringify(snap)))).toEqual(parseZReport(snap));
    expect(zPdfSections(parseZReport(snap))).toEqual(zPdfSections(parseZReport(snap)));
  });
  test('un JSON incomplet ne plante pas (valeurs neutres)', () => {
    const z = parseZReport(null);
    expect(z.number).toBeNull();
    expect(z.register_code).toBe('CAISSE-1');
    expect(z.payments_by_method).toEqual([]);
  });
  test('le PDF porte le numero du Z, la caisse et la mention de reimpression', async () => {
    const z = parseZReport(rawZ('Z-2026-00001', '2026-11-03T18:00:00Z'));
    const txt = new TextDecoder('latin1').decode(await buildZPdf(z, { reprintAt: new Date('2026-11-10T09:00:00Z') }, false));
    expect(txt).toContain('Z-2026-00001');
    expect(txt).toContain('CAISSE-1');
    expect(txt).toContain('Echappement Termignoni');
    expect(txt).toMatch(/R.impression/);
    expect(zPdfFileName(z)).toBe('Z-2026-00001_CAISSE-1.pdf');
  });
});

describe('lignes distinctes > 500 EUR TTC (prix unitaire)', () => {
  test('500,01 EUR l unite → ligne distincte ; 500,00 non ; 2 x 300 non (unitaire 300)', () => {
    expect(isLargeItem({ quantity: 1, line_ttc: 500.01 })).toBe(true);
    expect(isLargeItem({ quantity: 1, line_ttc: 500 })).toBe(false);
    expect(isLargeItem({ quantity: 2, line_ttc: 600 })).toBe(false);
  });
  test('un avoir (negatif) d une moto s inscrit aussi a part ; quantite nulle ignoree', () => {
    expect(isLargeItem({ quantity: -1, line_ttc: -12990 })).toBe(true);
    expect(isLargeItem({ quantity: 0, line_ttc: 900 })).toBe(false);
  });
  test('les lignes > 500 du Z sont reprises telles quelles', () => {
    expect(parseZReport(rawZ('Z-2026-00001', '2026-11-03T18:00:00Z')).large_items[0]).toMatchObject({ number: 'TIK-2026-00012', line_ttc: 605 });
  });
});

describe('plafond des especes : 3 000 EUR par vente', () => {
  test('3 000 pile passe, 3 000,01 est refuse', () => {
    expect(CASH_LIMIT_EUR).toBe(3000);
    expect(cashLimitExceeded([], [{ method: 'ESP', amount: 3000 }])).toBe(false);
    expect(cashLimitExceeded([], [{ method: 'ESP', amount: 3000.01 }])).toBe(true);
  });
  test('un acompte en especes deja percu compte : 2 000 + 1 500 refuse', () => {
    expect(cashLimitExceeded([{ method: 'ESP', amount: 2000, status: 'recu' }], [{ method: 'ESP', amount: 1500 }])).toBe(true);
  });
  test('la carte, un reglement attendu et une contre-passation ne comptent pas comme especes percues', () => {
    const existing = [
      { method: 'ESP', amount: 2500, status: 'recu' }, { method: 'ESP', amount: -2500, status: 'recu' },
      { method: 'MAE', amount: 9000, status: 'recu' }, { method: 'ESP', amount: 800, status: 'attendu' },
    ];
    expect(cashTotal(existing, [{ method: 'ESP', amount: 2900 }])).toBe(2900);
    expect(cashLimitExceeded(existing, [{ method: 'ESP', amount: 2900 }])).toBe(false);
  });
});

describe('contre-passation d un reglement (plus de suppression)', () => {
  test('ligne inverse : meme mode, montant oppose, motif, reference au reglement d origine', () => {
    expect(reversalLine({ id: 'p1', method: 'ESP', amount: '45.50', status: 'recu' }, '  erreur de mode ')).toEqual({
      method: 'ESP', amount: -45.5, status: 'recu', note: 'erreur de mode', reversalOf: 'p1',
    });
  });
  test('motif obligatoire', () => {
    expect(() => reversalLine({ id: 'p1', method: 'MAE', amount: 10, status: 'recu' }, '   ')).toThrow('needReason');
  });
  test('un reglement attendu ne se contre-passe pas (il s annule)', () => {
    expect(() => reversalLine({ id: 'p1', method: 'CHQC', amount: 10, status: 'attendu' }, 'cheque perdu')).toThrow('notReceived');
  });
  test('reglements deja contre-passes reperes (une seule contre-passation par reglement)', () => {
    const m = reversedIds([{ id: 'p1' }, { id: 'p2', reversal_of: 'p1' }, { id: 'p3', reversal_of: null }]);
    expect(m.get('p1')).toBe('p2');
    expect(m.has('p3')).toBe(false);
  });
});

describe('facture obligatoire : moto toujours, piece du vehicule > 125 EUR TTC', () => {
  const rules: InvoiceFamilyRule[] = [
    { code: 'R11', requiresInvoice: true }, { code: 'R13', requiresInvoice: false },
    { code: '03', requiresInvoice: true }, { code: '03-05', requiresInvoice: false },
    { code: 'ACCESSOIRES ET EQUIPEMENTS', requiresInvoice: true }, { code: 'ACCESSOIRES ET EQUIPEMENTS/ACC AGV', requiresInvoice: false },
    { code: '99', requiresInvoice: true, active: false },
  ];
  const line = (category_path: string | null, ht: number, mgmt_type = 'A', quantity = 1) => ({ category_path, mgmt_type, quantity, unit_price_ht: ht, vat_rate: 21 });

  test('le code le plus long l emporte, sans tenir compte de la casse', () => {
    expect(familyRequiresInvoice(rules, '03-05-99', 'A')).toBe(false);
    expect(familyRequiresInvoice(rules, '03-78-99', 'A')).toBe(true);
    expect(familyRequiresInvoice(rules, 'accessoires et equipements/acc agv', 'A')).toBe(false);
    expect(familyRequiresInvoice(rules, 'ACCESSOIRES ET EQUIPEMENTS/ACC RIZOMA', 'A')).toBe(true);
    expect(familyRequiresInvoice(rules, 'R11', 'A')).toBe(true);
  });
  test('famille inconnue ou ligne inactive : ticket possible ; main-d oeuvre (T) = travaux du vehicule', () => {
    expect(familyRequiresInvoice(rules, 'R99', 'A')).toBe(false);
    expect(familyRequiresInvoice(rules, '99-01-01', 'A')).toBe(false);
    expect(familyRequiresInvoice(rules, null, 'T')).toBe(true);
  });
  test('piece Ducati a 125 EUR TTC pile : ticket ; a 125,01 : facture', () => {
    expect(INVOICE_THRESHOLD_TTC).toBe(125);
    expect(invoiceRequired([line('R11', 125 / 1.21)], rules)).toBeNull();
    expect(invoiceRequired([line('R11', 125.01 / 1.21)], rules)).toBe('threshold');
  });
  test('un vetement a 400 EUR reste au ticket ; vetement + piece a 10 EUR au-dela de 125 : facture', () => {
    expect(invoiceRequired([line('R13', 400)], rules)).toBeNull();
    expect(invoiceRequired([line('R13', 400), line('R11', 10)], rules)).toBe('threshold');
  });
  test('une moto (V, O, P, D) impose la facture quel que soit le montant', () => {
    expect(invoiceRequired([line(null, 50, 'V')], rules)).toBe('vehicle');
    expect(invoiceRequired([line('08', 50, 'O')], [])).toBe('vehicle');
  });
  test('une ligne a quantite nulle ne compte pas', () => {
    expect(invoiceRequired([line(null, 9000, 'V', 0), line('R11', 20)], rules)).toBeNull();
  });
});

describe('caisse fermee : pas d encaissement', () => {
  test('aucune session ou session cloturee → noSession ; session ouverte → ok', () => {
    expect(posSessionError(null)).toBe('noSession');
    expect(posSessionError(undefined)).toBe('noSession');
    expect(posSessionError({ status: 'closed' })).toBe('noSession');
    expect(posSessionError({ status: 'open' })).toBeNull();
  });
});

describe('arrondi 5 cents : rendu et remboursements', () => {
  test('rendu arrondi a 5 cents : 20 remis pour 17,97 arrondis 17,95 → 2,05', () => {
    expect(changeDue(20, 17.95)).toBe(2.05);
    expect(changeDue(20.02, 17.95)).toBe(2.05);
  });
  test('remboursement : un reglement negatif par mode, especes arrondies, ARR et contre-passations deduites', () => {
    const paid = [
      { method: 'ESP', amount: 30, status: 'recu' }, { method: 'ESP', amount: 13.32, status: 'recu' },
      { method: 'ARR', amount: -0.02, status: 'recu' }, { method: 'MAE', amount: 50, status: 'recu' },
      { method: 'MAE', amount: -50, status: 'recu' }, { method: 'VIR', amount: 80, status: 'attendu' },
    ];
    const r = refundLines(paid, 'TIK-2026-00012');
    expect(r.find((l) => l.method === 'ESP')?.amount).toBe(-43.3);
    expect(r.find((l) => l.method === 'ARR')?.amount).toBe(-0.02);
    expect(r.some((l) => l.method === 'MAE' || l.method === 'VIR')).toBe(false);
    expect(r.filter((l) => l.method !== 'ARR').every((l) => (l.note ?? '').includes('TIK-2026-00012'))).toBe(true);
    // Le total rembourse = ce qui a ete percu (43,32).
    expect(Math.round(r.reduce((s, l) => s + l.amount, 0) * 100) / 100).toBe(-43.32);
  });
});

describe('ecart de caisse et journal des recettes (CSV)', () => {
  test('un ecart exige un motif ; pas d ecart, pas de motif', () => {
    expect(varianceReasonMissing(-2.5, '')).toBe(true);
    expect(varianceReasonMissing(-2.5, 'billet refuse')).toBe(false);
    expect(varianceReasonMissing(0, '')).toBe(false);
  });
  test('CSV : une ligne par Z, colonnes par taux et par mode, decimales a la virgule, pied de totaux', () => {
    const zs = [rawZ('Z-2026-00001', '2026-11-03T18:00:00Z'), rawZ('Z-2026-00002', '2026-11-04T18:00:00Z', { variance: -2.5, variance_reason: 'erreur; rendu' })].map(parseZReport);
    const labels = { number: 'N Z', day: 'Jour', register: 'Caisse', tickets: 'Tickets', base: 'Base', vat: 'TVA', ttc: 'TTC', discounts: 'Remises', refunds: 'Remb', net: 'CA net', opening: 'Fond', expected: 'Theorique', counted: 'Compte', variance: 'Ecart', reason: 'Motif', total: 'Total' };
    const lines = journalCsv(zs, labels).split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('Base 21%;TVA 21%;TTC 21%');
    expect(lines[0]).toContain('Especes;Carte');
    expect(lines[1].startsWith('Z-2026-00001;')).toBe(true);
    expect(lines[1]).toContain('821,3');
    expect(lines[2]).toContain('"erreur; rendu"');
    expect(lines[3].startsWith('Total;')).toBe(true);
    expect(journalTotals(journalRows(zs)).net_sales_ttc).toBe(1642.6);
    expect(journalCsvFileName('CAISSE-1', '2026-11')).toBe('journal-recettes_CAISSE-1_2026-11.csv');
  });
  test('jour et mois de cloture (heure locale)', () => {
    const z = parseZReport(rawZ('Z-2026-00001', '2026-11-03T18:00:00'));
    expect(zDay(z)).toBe('2026-11-03');
    expect(zMonth(z)).toBe('2026-11');
  });
});

describe('avoir d un ticket anonyme (remboursement au comptoir)', () => {
  const lines = [{ article_id: 'a1', designation: 'Casque', quantity: -1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, line_type: 'article' as const }];
  test('l avoir d un ticket sans client se valide ; celui d une facture exige un client', () => {
    expect(documentValidationError({ docType: 'AVO', status: 'validee', contactId: null, lines, sourceDocType: 'TIK' })).toBeNull();
    expect(documentValidationError({ docType: 'AVO', status: 'validee', contactId: null, lines, sourceDocType: 'FAC' })).toBe('needClient');
    expect(documentValidationError({ docType: 'FAC', status: 'validee', contactId: null, lines })).toBe('needClient');
  });
});
