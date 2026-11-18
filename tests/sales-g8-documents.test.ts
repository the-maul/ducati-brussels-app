/**
 * Rattrapage G8 « documents de vente » (18/11/2026) — règles pures :
 *  - liste des factures : exercice, filtres envoyés à la base, totaux, panier moyen, marge, règlements ;
 *  - facturation groupée des BL : regroupement, lignes, pied replié, majoration, échéance ;
 *  - options d'édition : titres, exclusions, CGV au verso ;
 *  - documents en attente, acompte direct, régularisations, disponibilité.
 * Exécution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import {
  fiscalBounds, filtersToRpc, emptyDocListFilters, totalsOf, averageBasket, marginPct, paymentsSummary, inNumberRange,
  docDue, countDocListFilters, exportAoa, type DocListRow,
} from '../src/modules/sales/document-list';
import {
  groupDeliveryNotes, blHeaderLine, blLinesForInvoice, combineDiscount, surchargeLine, dueDateFor, selectionTotals, linesHtOf,
  type BlCandidate,
} from '../src/modules/sales/bl-invoicing';
import { normalizePrintOptions, titleChoicesFor, titleKey, blankPageBeforeCgv, printableLines, hasPrintOptions, DEFAULT_PRINT_OPTIONS } from '../src/modules/sales/print-options';
import { isPendingDocument, directDepositAvailable, pendingDeposit } from '../src/modules/sales/pending-documents';
import { isRegularisation, matchesAvailability, sumOf, CLIENT_DOC_TABS, TAB_DOC_TYPES } from '../src/modules/sales/client-documents';

const today = new Date('2026-11-18T10:00:00');

describe('liste des factures', () => {
  test('exercice courant / antérieurs = années civiles', () => {
    expect(fiscalBounds('current', today)).toEqual({ from: '2026-01-01', to: null });
    expect(fiscalBounds('previous', today)).toEqual({ from: null, to: '2025-12-31' });
    expect(fiscalBounds('all', today)).toEqual({ from: null, to: null });
  });

  test('filtres → paramètres de la base : la période la plus étroite gagne', () => {
    const f = { ...emptyDocListFilters(), dateFrom: '2025-06-01', dateTo: '2026-03-31', amountMin: '10,5', clientKind: 'pro' as const, transfer: 'pending' as const, search: ' 2270 ' };
    const r = filtersToRpc(f, today);
    expect(r.date_from).toBe('2026-01-01');      // exercice courant plus étroit que le 01/06/2025
    expect(r.date_to).toBe('2026-03-31');
    expect(r.amount_min).toBe(10.5);
    expect(r.client_kind).toBe('pro');
    expect(r.transfer).toBe('pending');
    expect(r.search).toBe('2270');
    expect(r.doc_types).toEqual(['FAC', 'TIK', 'AVO', 'FAA']);
    expect('amount_max' in r).toBe(false);
  });

  test('exercices antérieurs et date de fin saisie', () => {
    const r = filtersToRpc({ ...emptyDocListFilters(), fiscal: 'previous', dateTo: '2026-02-01' }, today);
    expect(r.date_to).toBe('2025-12-31');
    expect('date_from' in r).toBe(false);
  });

  test('compte des filtres actifs (hors types et tri)', () => {
    expect(countDocListFilters(emptyDocListFilters())).toBe(0);
    expect(countDocListFilters({ ...emptyDocListFilters(), numberFrom: 'FAC', contactId: 'x', fiscal: 'all' })).toBe(3);
  });

  const row = (p: Partial<DocListRow>): DocListRow => ({
    id: 'x', doc_type: 'FAC', number: null, legacy_number: null, status: 'validee', issue_date: '2026-11-18', due_date: null, created_at: null,
    contact_id: null, contact_name: null, contact_code: null, contact_kind: null, operator: null, operator_user_id: null,
    total_ht: 0, total_vat: 0, total_ttc: 0, paid_amount: 0, due: 0, discount: 0, deposit: 0, margin: 0,
    tax_exempt: false, condition_reglement: null, compta_transferred: false, date_transfert: null, notes: null, source_document_id: null, vehicle_id: null,
    payments: [], ...p,
  });

  test('totaux et panier moyen : les avoirs comptent dans les totaux, pas dans le panier', () => {
    const rows = [
      row({ total_ht: 100, total_vat: 21, total_ttc: 121, due: 21, margin: 40 }),
      row({ total_ht: 50, total_vat: 10.5, total_ttc: 60.5, margin: 20 }),
      row({ doc_type: 'AVO', total_ht: -50, total_vat: -10.5, total_ttc: -60.5, margin: -20 }),
    ];
    const tot = totalsOf(rows);
    expect(tot.count).toBe(3);
    expect(tot.salesCount).toBe(2);
    expect(tot.ttc).toBe(121);
    expect(tot.due).toBe(21);
    expect(tot.margin).toBe(40);
    expect(averageBasket(tot)).toEqual({ ht: 75, ttc: 90.75 });
    expect(averageBasket({ salesCount: 0, salesHt: 0, salesTtc: 0 })).toEqual({ ht: 0, ttc: 0 });
  });

  test('marge inconnue sur une ligne : total de marge inconnu', () => {
    expect(totalsOf([row({ margin: 10 }), row({ margin: null })]).margin).toBeNull();
  });

  test('% marge sur le HT', () => {
    expect(marginPct(54.29, 98.09)).toBe(55.35);   // relevé G8 FACTICE du 18/11
    expect(marginPct(null, 100)).toBeNull();
    expect(marginPct(10, 0)).toBeNull();
  });

  test('montant dû : jamais négatif, jamais sur un avoir', () => {
    expect(docDue({ doc_type: 'FAC', total_ttc: 121, paid_amount: 100 })).toBe(21);
    expect(docDue({ doc_type: 'FAC', total_ttc: 121, paid_amount: 150 })).toBe(0);
    expect(docDue({ doc_type: 'AVO', total_ttc: -121, paid_amount: 0 })).toBe(0);
  });

  test('règlements en une ligne, attendus signalés, modes cumulés', () => {
    const s = paymentsSummary([
      { method: 'ESP', amount: 10, status: 'recu' }, { method: 'ESP', amount: 5, status: 'recu' },
      { method: 'CB', amount: 20, status: 'attendu' }, { method: 'VIR', amount: 0, status: 'recu' },
    ], (c) => (c === 'ESP' ? 'Espèces' : c), 'attendu');
    expect(s).toBe('Espèces 15,00 · CB 20,00 (attendu)');
  });

  test('plage de numéros (même série)', () => {
    expect(inNumberRange('FAC-2026-00012', 'FAC-2026-00010', 'FAC-2026-00020')).toBe(true);
    expect(inNumberRange('FAC-2026-00021', 'FAC-2026-00010', 'FAC-2026-00020')).toBe(false);
    expect(inNumberRange('fac-2026-00012', 'FAC-2026-00010', '')).toBe(true);
  });

  test('export : en-têtes puis une ligne par document', () => {
    const aoa = exportAoa([row({ number: 'FAC-1', total_ttc: 12 })], [
      { key: 'n', header: 'N°', value: (r) => r.number }, { key: 't', header: 'TTC', value: (r) => r.total_ttc },
    ]);
    expect(aoa).toEqual([['N°', 'TTC'], ['FAC-1', 12]]);
  });
});

describe('facturation groupée des BL', () => {
  const bl = (p: Partial<BlCandidate>): BlCandidate => ({
    id: 'b', number: 'BL-1', issue_date: '2026-11-18', contact_id: 'c1', contact_name: 'Client', condition_reglement: null,
    total_ht: 100, total_ttc: 121, paid_amount: 0, operator: null, tax_exempt: false, vat_scheme: 'normal', notes: null, ...p,
  });

  test('regroupement par client, BL triés par date ; détaxe et marge jamais mélangées', () => {
    const groups = groupDeliveryNotes([
      bl({ id: 'a', number: 'BL-3', issue_date: '2026-11-10' }),
      bl({ id: 'b', number: 'BL-1', issue_date: '2026-11-02' }),
      bl({ id: 'c', contact_id: 'c2' }),
      bl({ id: 'd', tax_exempt: true }),
      bl({ id: 'e', vat_scheme: 'marge' }),
    ], false);
    expect(groups.length).toBe(4);
    const c1 = groups.find((g) => g.some((b) => b.id === 'a'))!;
    expect(c1.map((b) => b.id)).toEqual(['b', 'a']);
  });

  test('une facture par BL', () => {
    expect(groupDeliveryNotes([bl({ id: 'a' }), bl({ id: 'b' })], true).length).toBe(2);
  });

  test('ligne d\'en-tête façon G8', () => {
    const l = blHeaderLine({ number: 'BL-2026-00001', issue_date: '2026-11-18' }, 'LIVRAISON N° {number} DU {date}');
    expect(l.designation).toBe('LIVRAISON N° BL-2026-00001 DU 18/11/2026');
    expect(l.line_type).toBe('texte');
    expect(l.quantity).toBe(0);
  });

  test('pied du BL replié : remise globale en % sur les lignes, port en ligne', () => {
    const lines = [{ article_id: 'x', designation: 'Pièce', quantity: 2, unit_price_ht: 50, vat_rate: 21, discount_pct: 10, line_type: 'article' as const }];
    const out = blLinesForInvoice(lines, { global_discount_pct: 10, global_discount_amount: 0, shipping_ht: 8, shipping_taxed: false, shipping_vat_rate: 21 }, 'Port');
    expect(out[0].discount_pct).toBe(19);           // 1 - 0,9 × 0,9
    expect(out[1]).toMatchObject({ designation: 'Port', unit_price_ht: 8, vat_rate: 0 });
    expect(combineDiscount(0, 0)).toBe(0);
  });

  test('remise globale en montant convertie en % du HT des lignes', () => {
    const lines = [{ article_id: 'x', designation: 'Pièce', quantity: 1, unit_price_ht: 200, vat_rate: 21, discount_pct: 0, line_type: 'article' as const }];
    const out = blLinesForInvoice(lines, { global_discount_pct: 0, global_discount_amount: 20, shipping_ht: 0, shipping_taxed: true, shipping_vat_rate: 21 }, 'Port');
    expect(out.length).toBe(1);
    expect(linesHtOf(out)).toBe(180);
  });

  test('majoration fixe + % sur le HT, au taux dominant', () => {
    const lines = [
      { article_id: null, designation: 'LIVRAISON', quantity: 0, unit_price_ht: 0, vat_rate: 0, discount_pct: 0, line_type: 'texte' as const },
      { article_id: 'a', designation: 'A', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, line_type: 'article' as const },
      { article_id: 'b', designation: 'B', quantity: 1, unit_price_ht: 20, vat_rate: 6, discount_pct: 0, line_type: 'article' as const },
    ];
    const s = surchargeLine(lines, { surchargeFixedHt: 5, surchargePct: 10 }, 'Majoration');
    expect(s).toMatchObject({ designation: 'Majoration', unit_price_ht: 17, vat_rate: 21, quantity: 1 });
    expect(surchargeLine(lines, { surchargeFixedHt: 0, surchargePct: 0 }, 'M')).toBeNull();
  });

  test('échéance : jours puis fin de mois', () => {
    expect(dueDateFor('2026-11-18', 30, false)).toBe('2026-12-18');
    expect(dueDateFor('2026-11-18', 30, true)).toBe('2026-12-31');
    expect(dueDateFor('2026-11-18', 0, true)).toBe('2026-11-30');
    expect(dueDateFor('2026-11-18', null, false)).toBeNull();
  });

  test('totaux de la sélection', () => {
    expect(selectionTotals([bl({ total_ht: 10, total_ttc: 12.1, paid_amount: 5 }), bl({ total_ht: 20, total_ttc: 24.2 })]))
      .toEqual({ count: 2, ht: 30, ttc: 36.3, deposit: 5 });
  });
});

describe('options d\'édition', () => {
  test('titres selon le type (Proforma / Devis / Estimation ; Réservation / Commande)', () => {
    expect(titleChoicesFor('DEV')).toEqual(['default', 'proforma', 'devis', 'estimation']);
    expect(titleChoicesFor('RES')).toEqual(['default', 'reservation', 'commande']);
    expect(titleChoicesFor('FAC')).toEqual(['default']);
    expect(titleKey('estimation')).toBe('printOptions.title_estimation');
    expect(titleKey('default')).toBeNull();
  });

  test('titre hors type ignoré ; sans prix exclut totaux seuls', () => {
    const o = normalizePrintOptions('FAC', { title: 'devis', noPrices: true, totalsOnly: true });
    expect(o.title).toBe('default');
    expect(o.noPrices).toBe(true);
    expect(o.totalsOnly).toBe(false);
    expect(hasPrintOptions(DEFAULT_PRINT_OPTIONS)).toBe(false);
    expect(hasPrintOptions(o)).toBe(true);
  });

  test('recto-verso : les CGV commencent sur une page paire', () => {
    expect(blankPageBeforeCgv(1, true)).toBe(false);   // CGV page 2 (verso)
    expect(blankPageBeforeCgv(2, true)).toBe(true);    // page 3 serait un recto : page blanche
    expect(blankPageBeforeCgv(2, false)).toBe(false);
  });

  test('totaux uniquement : aucune ligne imprimée', () => {
    expect(printableLines([1, 2, 3], { totalsOnly: true })).toEqual([]);
    expect(printableLines([1, 2, 3], { totalsOnly: false })).toEqual([1, 2, 3]);
  });
});

describe('documents en attente et acompte direct', () => {
  test('acompte direct disponible = perçu, tant qu\'il n\'est pas imputé', () => {
    expect(directDepositAvailable({ doc_type: 'ACD', status: 'payee', total_ttc: 0, paid_amount: 150 })).toBe(150);
    expect(directDepositAvailable({ doc_type: 'ACD', status: 'converti', total_ttc: 0, paid_amount: 150 })).toBe(0);
    expect(directDepositAvailable({ doc_type: 'RES', status: 'validee', total_ttc: 0, paid_amount: 150 })).toBe(0);
  });

  test('documents en attente : ouverts, factures dues, jamais les documents clos', () => {
    expect(isPendingDocument({ doc_type: 'DEV', status: 'validee', total_ttc: 100, paid_amount: 0 })).toBe(true);
    expect(isPendingDocument({ doc_type: 'RES', status: 'converti', total_ttc: 100, paid_amount: 0 })).toBe(false);
    expect(isPendingDocument({ doc_type: 'FAC', status: 'validee', total_ttc: 100, paid_amount: 100 })).toBe(false);
    expect(isPendingDocument({ doc_type: 'FAC', status: 'validee', total_ttc: 100, paid_amount: 40 })).toBe(true);
    expect(isPendingDocument({ doc_type: 'ACD', status: 'payee', total_ttc: 0, paid_amount: 0 })).toBe(false);
    expect(isPendingDocument({ doc_type: 'BL', status: 'brouillon', total_ttc: 10, paid_amount: 0 })).toBe(false);
    expect(pendingDeposit({ doc_type: 'RES', status: 'validee', total_ttc: 100, paid_amount: 30 })).toBe(30);
    expect(pendingDeposit({ doc_type: 'FAC', status: 'validee', total_ttc: 100, paid_amount: 30 })).toBe(0);
  });
});

describe('documents clients', () => {
  test('onze onglets, ceux des documents de vente typés', () => {
    expect(CLIENT_DOC_TABS.length).toBe(11);
    expect(TAB_DOC_TYPES.deliveries).toEqual(['BL']);
    expect(TAB_DOC_TYPES.proformas).toEqual(['DEV']);
  });

  test('régularisation = règlement perçu après le jour de la facture, hors acompte reporté', () => {
    expect(isRegularisation({ paid_at: '2026-11-20T09:00:00Z', issue_date: '2026-11-18', note: null })).toBe(true);
    expect(isRegularisation({ paid_at: '2026-11-18T17:00:00Z', issue_date: '2026-11-18', note: null })).toBe(false);
    expect(isRegularisation({ paid_at: '2026-11-20T09:00:00Z', issue_date: '2026-11-18', note: 'Acompte reporté RES 3' })).toBe(false);
  });

  test('filtre G8 de disponibilité', () => {
    expect(matchesAvailability('all', 'na')).toBe(true);
    expect(matchesAvailability('full', 'disponible')).toBe(true);
    expect(matchesAvailability('partial', 'partiel')).toBe(true);
    expect(matchesAvailability('missing', 'partiel')).toBe(true);
    expect(matchesAvailability('missing', 'disponible')).toBe(false);
    expect(matchesAvailability('full', null)).toBe(false);
  });

  test('somme d\'une colonne', () => {
    expect(sumOf([{ a: 1.25 }, { a: 2 }, { a: null }], (r) => r.a)).toBe(3.25);
  });
});
