/**
 * Tests M6 — audit du parcours de vente (31/10/2026, VEN001) :
 *  - totaux HT / TVA / TTC d'un document à 3 lignes (article, main-d'œuvre, texte) ;
 *  - refus de validation : sans ligne, sans client (sauf ticket de caisse), à 0 € ;
 *  - transformation devis → facture : lignes recopiées à l'identique, stock débité à la
 *    facture seulement (le devis ne touche pas au stock) ;
 *  - numérotation : le numéro n'existe qu'à la validation (brouillon sans numéro) et la
 *    séquence est par société et par type (testé en base, transaction annulée : voir
 *    docs/bible/missions/mission-08-ventes-facturation.md §2).
 */
import { test, expect, describe } from 'bun:test';
import {
  computeTotals, documentValidationError, rowToLineInput, lineMovesStock,
  REAL_OUT_DOC_TYPES, RESERVE_DOC_TYPES, SALE_DOC_TYPES, NO_CLIENT_DOC_TYPES, CONVERSIONS,
  type LineInput, type DocumentLine,
} from '../src/modules/sales/write-api';

const line = (p: Partial<LineInput> = {}): LineInput => ({
  designation: 'x', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, line_type: 'article', ...p,
});

// Le devis de Simon du 30/10 : une moto, 2 h de montage, un commentaire.
const threeLines: LineInput[] = [
  line({ designation: 'Scrambler Icon Dark', article_id: 'art-moto', reference: 'SCR-ICON', unit_price_ht: 8256.2 }),
  line({ designation: 'MO ATELIER VIP1', article_id: 'art-mo', line_type: 'main_oeuvre', quantity: 2, unit_price_ht: 80 }),
  line({ designation: 'PREMIER ENTRETIEN OFFERT', line_type: 'texte', quantity: 0, unit_price_ht: 0 }),
];

describe('totaux d un document a 3 lignes (article, main-d oeuvre, texte)', () => {
  test('HT = moto + 2 h de MO ; la ligne texte ne compte pas ; TVA 21 % ; TTC = HT + TVA', () => {
    const r = computeTotals(threeLines);
    expect(r.lines_ht).toBe(8416.2);          // 8 256,20 + 160
    expect(r.total_ht).toBe(8416.2);
    expect(r.total_vat).toBe(1767.4);         // 8 416,20 x 21 %
    expect(r.total_ttc).toBe(10183.6);
    expect(r.total_ttc).toBe(Math.round((r.total_ht + r.total_vat) * 100) / 100);
  });

  test('en mode TTC, le prix saisi 9 990 € TTC redonne 8 256,20 € HT et le TTC exact', () => {
    const ht = Math.round((9990 / 1.21) * 100) / 100;
    expect(ht).toBe(8256.2);
    const r = computeTotals([line({ unit_price_ht: ht })]);
    expect(r.total_ttc).toBe(9990);
  });
});

describe('refus de validation (message clair, jamais un document vide)', () => {
  const client = 'contact-1';

  test('sans aucune ligne : refuse, brouillon compris', () => {
    expect(documentValidationError({ docType: 'DEV', status: 'brouillon', contactId: client, lines: [] })).toBe('needLine');
    expect(documentValidationError({ docType: 'DEV', status: 'validee', contactId: client, lines: [] })).toBe('needLine');
  });

  test('une ligne sans libelle ou seulement des lignes vides = pas de ligne', () => {
    expect(documentValidationError({ docType: 'DEV', status: 'validee', contactId: client, lines: [line({ designation: '   ' })] })).toBe('needLine');
    expect(documentValidationError({ docType: 'DEV', status: 'validee', contactId: client, lines: [line({ line_type: 'vide', designation: '' })] })).toBe('needLine');
  });

  test('validation sans client : refusee pour devis, bon de commande, reservation, BL, facture', () => {
    for (const docType of ['DEV', 'BC', 'RES', 'BL', 'FAC']) {
      expect(documentValidationError({ docType, status: 'validee', contactId: null, lines: threeLines })).toBe('needClient');
    }
  });

  test('un brouillon peut rester sans client', () => {
    expect(documentValidationError({ docType: 'DEV', status: 'brouillon', contactId: null, lines: threeLines })).toBeNull();
  });

  test('le ticket de caisse (comptoir) se valide sans client', () => {
    expect([...NO_CLIENT_DOC_TYPES]).toEqual(['TIK']);
    expect(documentValidationError({ docType: 'TIK', status: 'validee', contactId: null, lines: [line()] })).toBeNull();
  });

  test('validation a 0 € depuis l ecran de vente : refusee (devis « TEST » du 30/10), autorisee en brouillon', () => {
    const zero = [line({ designation: 'TEST', unit_price_ht: 0 })];
    expect(documentValidationError({ docType: 'DEV', status: 'validee', contactId: client, lines: zero, requireAmount: true })).toBe('needAmount');
    expect(documentValidationError({ docType: 'DEV', status: 'brouillon', contactId: client, lines: zero, requireAmount: true })).toBeNull();
    // Une ligne texte seule n'est pas un montant.
    const textOnly = [line({ line_type: 'texte', designation: 'Merci', quantity: 0, unit_price_ht: 0 })];
    expect(documentValidationError({ docType: 'DEV', status: 'validee', contactId: client, lines: textOnly, requireAmount: true })).toBe('needAmount');
  });

  test('facture d OR en garantie a 0 € : pas de controle de montant hors ecran de vente (B10)', () => {
    const warranty = [line({ designation: 'Pièce garantie', article_id: 'a1', unit_price_ht: 0 })];
    expect(documentValidationError({ docType: 'FAC', status: 'validee', contactId: client, lines: warranty })).toBeNull();
  });

  test('document complet : accepte', () => {
    expect(documentValidationError({ docType: 'DEV', status: 'validee', contactId: client, lines: threeLines, requireAmount: true })).toBeNull();
  });
});

describe('transformation devis → facture', () => {
  const saved = (p: Partial<DocumentLine>): DocumentLine => ({
    id: 'l1', document_id: 'd1', article_id: null, designation: 'x', quantity: 1, unit_price_ht: 100, vat_rate: 21,
    discount_pct: 0, line_ht: 100, line_ttc: 121, sort_order: 0, created_at: '2026-10-31', reference: null, line_type: 'article', ...p,
  } as DocumentLine);

  const quoteLines: DocumentLine[] = [
    saved({ id: 'l1', article_id: 'art-moto', reference: 'SCR-ICON', designation: 'Scrambler Icon Dark', unit_price_ht: 8256.2 }),
    saved({ id: 'l2', article_id: 'art-mo', line_type: 'main_oeuvre', designation: 'MO ATELIER VIP1', quantity: 2, unit_price_ht: 80 }),
    saved({ id: 'l3', line_type: 'texte', designation: 'PREMIER ENTRETIEN OFFERT', quantity: 0, unit_price_ht: 0, line_ht: 0, line_ttc: 0 }),
  ];

  test('un devis se transforme en facture (chaine autorisee)', () => {
    expect(CONVERSIONS.DEV).toContain('FAC');
  });

  test('les lignes sont recopiees a l identique (article, prix, TVA, type, reference) et les totaux ne bougent pas', () => {
    const copied = quoteLines.map((l) => rowToLineInput(l));
    expect(copied).toEqual([
      { article_id: 'art-moto', designation: 'Scrambler Icon Dark', reference: 'SCR-ICON', line_type: 'article', quantity: 1, unit_price_ht: 8256.2, vat_rate: 21, discount_pct: 0 },
      { article_id: 'art-mo', designation: 'MO ATELIER VIP1', reference: null, line_type: 'main_oeuvre', quantity: 2, unit_price_ht: 80, vat_rate: 21, discount_pct: 0 },
      { article_id: null, designation: 'PREMIER ENTRETIEN OFFERT', reference: null, line_type: 'texte', quantity: 0, unit_price_ht: 0, vat_rate: 21, discount_pct: 0 },
    ]);
    expect(computeTotals(copied)).toEqual(computeTotals(threeLines));
  });

  test('le stock est debite a la facture seulement : le devis ne touche pas au stock', () => {
    expect(SALE_DOC_TYPES as readonly string[]).not.toContain('DEV');
    expect(REAL_OUT_DOC_TYPES as readonly string[]).toContain('FAC');
    expect(RESERVE_DOC_TYPES as readonly string[]).not.toContain('FAC');
    // Sur la facture, seule la moto (ligne article avec article) sort du stock ; ni la MO ni le texte.
    const copied = quoteLines.map((l) => rowToLineInput(l));
    expect(copied.map((l) => lineMovesStock(l))).toEqual([true, false, false]);
  });

  test('un avoir recopie les lignes en negatif (reintegration), sans montant sur le texte, TVA comprise', () => {
    const neg = quoteLines.map((l) => rowToLineInput(l, -1));
    expect(neg.map((l) => l.quantity)).toEqual([-1, -2, 0]);
    const r = computeTotals(neg);
    expect(r.total_ht).toBe(-8416.2);
    expect(r.total_vat).toBe(-1767.4);       // avant le 31/10 : 0 (la TVA d'un avoir était perdue)
    expect(r.total_ttc).toBe(-10183.6);
  });

  test('un avoir d une facture avec remise globale (% ou €) rembourse le net, pas 0', () => {
    const pos = computeTotals(threeLines, { globalDiscountAmount: 416.2 });
    expect(pos.total_ht).toBe(8000);
    const neg = quoteLines.map((l) => rowToLineInput(l, -1));
    const byAmount = computeTotals(neg, { globalDiscountAmount: 416.2 });
    expect(byAmount.total_ht).toBe(-8000);   // avant le 31/10 : 0 (remise bornée au HT négatif)
    expect(byAmount.total_ttc).toBe(-9680);
    const byPct = computeTotals(neg, { globalDiscountPct: 10 });
    expect(byPct.total_ht).toBe(-7574.58);
    expect(byPct.total_vat).toBe(-1590.66);
  });
});
