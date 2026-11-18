/**
 * Tests M6 — Journaux de caisse façon G8 (rattrapage G8 du 18/11/2026, PDV008) et bordereau de remise.
 * Jeu de données d'une période (forme de `cash_journal_data`) : 2 jours, ticket, facture avec remise
 * globale et port, avoir, règlements espèces / carte / remboursement, mouvements (consommable avec TVA,
 * dépôt-vente, sortie posée par une remise), remise d'espèces avant la période (report) et pendant.
 */
import { test, expect, describe } from 'bun:test';
import {
  buildJournal, parseJournalData, ventilatedLines, documentMargins, familyKey, JOURNAL_IDS, frDay, type JournalData,
} from '../src/modules/sales/cash-journals';
import { formatCell, journalGrid, sheetName, buildJournalsXlsx } from '../src/modules/sales/cash-journals-export';
import { depositSlipJournal, sourceLabel } from '../src/modules/sales/cash-deposit-slip';

const data: JournalData = parseJournalData({
  from: '2026-11-17', to: '2026-11-18',
  methods: [{ code: 'ESP', label: 'Espèces' }, { code: 'MAE', label: 'Maestro / Débit' }, { code: 'VIR', label: 'Virement' }],
  documents: [
    { id: 'd1', number: 'TIK-2026-00010', doc_type: 'TIK', status: 'payee', issue_date: '2026-11-17', created_at: '2026-11-17T09:15:00Z',
      contact_id: null, contact_label: null, operator: 'Jeremy', total_ht: '100', total_vat: '21', total_ttc: '121', paid_amount: '121',
      shipping_ht: 0, shipping_vat_rate: 21, shipping_taxed: true, legacy_margin: null },
    // Facture : lignes 200 HT, remise globale 10 % → 180 HT marchandises + 10 HT de port = 190 HT.
    { id: 'd2', number: 'FAC-2026-00020', doc_type: 'FAC', status: 'validee', issue_date: '2026-11-18', created_at: '2026-11-18T14:30:00Z',
      contact_id: 'c1', contact_label: 'Rossi Marco', operator: 'Domenico', total_ht: 190, total_vat: 39.9, total_ttc: 229.9, paid_amount: 100,
      shipping_ht: 10, shipping_vat_rate: 21, shipping_taxed: true, legacy_margin: null },
    { id: 'd3', number: 'AVO-2026-00003', doc_type: 'AVO', status: 'validee', issue_date: '2026-11-18', created_at: '2026-11-18T16:00:00Z',
      contact_id: null, contact_label: null, operator: 'Jeremy', total_ht: -20, total_vat: -4.2, total_ttc: -24.2, paid_amount: -24.2,
      shipping_ht: 0, shipping_vat_rate: 21, shipping_taxed: true, legacy_margin: null },
  ],
  lines: [
    { document_id: 'd1', article_id: 'a1', reference: '97980', designation: 'Huile', line_type: 'article', quantity: 2, vat_rate: 21, line_ht: 100, line_ttc: 121, unit_cost: 30, family: 'R11/03-05/HUILE' },
    { document_id: 'd2', article_id: 'a2', reference: 'CASQUE1', designation: 'Casque', line_type: 'article', quantity: 1, vat_rate: 21, line_ht: 150, line_ttc: 181.5, unit_cost: 90, family: 'EQUIPEMENT/CASQUES' },
    { document_id: 'd2', article_id: 'a1', reference: '97980', designation: 'Huile', line_type: 'article', quantity: 1, vat_rate: 21, line_ht: 50, line_ttc: 60.5, unit_cost: 30, family: 'R11/03-05/HUILE' },
    { document_id: 'd3', article_id: 'a1', reference: '97980', designation: 'Huile', line_type: 'article', quantity: -1, vat_rate: 21, line_ht: -20, line_ttc: -24.2, unit_cost: 15, family: 'R11/03-05/HUILE' },
  ],
  payments: [
    { id: 'p1', document_id: 'd1', document_number: 'TIK-2026-00010', doc_type: 'TIK', contact_label: null, method: 'ESP', amount: 121, paid_at: '2026-11-17T09:16:00Z', note: null },
    { id: 'p2', document_id: 'd2', document_number: 'FAC-2026-00020', doc_type: 'FAC', contact_label: 'Rossi Marco', method: 'MAE', amount: 100, paid_at: '2026-11-18T14:31:00Z', note: null },
    { id: 'p3', document_id: 'd3', document_number: 'AVO-2026-00003', doc_type: 'AVO', contact_label: null, method: 'ESP', amount: -24.2, paid_at: '2026-11-18T16:01:00Z', note: 'Remboursement' },
  ],
  movements: [
    { id: 'm1', movement_no: 1, occurred_at: '2026-11-17T10:00:00Z', kind: 'out', method: 'ESP', amount: 10, reason: 'Test consommable', type_code: '04', type_label: 'Achat de consommables', vat_rate: 21, vat_amount: 1.74, account_code: '612000', deposit_id: null, session_id: 's1' },
    { id: 'm2', movement_no: 2, occurred_at: '2026-11-18T11:00:00Z', kind: 'in', method: 'VIR', amount: 7000, reason: 'Encaissement dépôt-vente', type_code: '02', type_label: 'Encaissement dépôt-vente', vat_rate: null, vat_amount: null, account_code: null, deposit_id: null, session_id: 's2' },
    { id: 'm3', movement_no: 3, occurred_at: '2026-11-18T17:00:00Z', kind: 'out', method: 'ESP', amount: 100, reason: 'Remise en banque n° 2', type_code: '01', type_label: 'Remise en banque', vat_rate: null, vat_amount: null, account_code: null, deposit_id: 'dep2', session_id: 's2' },
  ],
  sessions: [
    { id: 's1', register_code: 'CAISSE-1', z_number: 'Z-2026-00001', status: 'closed', opened_at: '2026-11-17T08:00:00Z', closed_at: '2026-11-17T18:00:00Z',
      opening_float: 100, proposed_float: 100, expected_cash: 211, counted_cash: 210 },
  ],
  deposits: [
    { id: 'dep1', number: 1, method: 'ESP', kind: 'remise', status: 'active', deposit_date: '2026-11-10', created_at: '2026-11-10T18:00:00Z', period_from: null, period_to: '2026-11-10T18:00:00Z',
      lines_total: 350, deposited_amount: 250, new_float: 100, line_count: 3, bank_label: 'BNP', comment: null, cancel_reason: null },
    { id: 'dep2', number: 2, method: 'ESP', kind: 'remise', status: 'active', deposit_date: '2026-11-18', created_at: '2026-11-18T17:00:00Z', period_from: null, period_to: '2026-11-18T17:00:00Z',
      lines_total: 186.8, deposited_amount: 100, new_float: 86.8, line_count: 4, bank_label: 'BNP', comment: 'Enveloppe 12', cancel_reason: null },
  ],
});

const total = (id: (typeof JOURNAL_IDS)[number], opts = {}) => {
  const j = buildJournal(id, data, opts);
  return j.sections.flatMap((s) => s.rows.filter((r) => r.tone === 'total').map((r) => r.cells));
};

describe('données et lignes ventilées', () => {
  test('parseJournalData convertit les nombres reçus en texte', () => {
    expect(data.documents[0].total_ht).toBe(100);
    expect(data.documents[0].total_ttc).toBe(121);
  });
  test('remise globale répartie au prorata et port en ligne à part : la somme = HT du document', () => {
    const vl = ventilatedLines(data).filter((l) => l.document_id === 'd2');
    expect(vl.map((l) => l.ht)).toEqual([135, 45, 10]);
    expect(vl.reduce((a, l) => a + l.ht, 0)).toBe(190);
    expect(vl[2].line_type).toBe('shipping');
    expect(vl[2].ttc).toBe(12.1);
  });
  test('marge par document : HT ventilé − quantité × coût (PAMP)', () => {
    const m = documentMargins(data);
    expect(m.get('d1')).toBe(40);            // 100 − 2 × 30
    expect(m.get('d2')).toBe(60);            // (135 − 90) + (45 − 30)
    expect(m.get('d3')).toBe(-5);            // −20 − (−1 × 15)
  });
  test('famille gardée sur N niveaux', () => {
    expect(familyKey('R11/03-05/HUILE', 1)).toBe('R11');
    expect(familyKey('R11/03-05/HUILE', 2)).toBe('R11 / 03-05');
    expect(familyKey(null, 1)).toBe('');
  });
});

describe('liste des factures', () => {
  test('sous-total par jour, total général, montant dû, marge et % de marge', () => {
    const j = buildJournal('invoices', data);
    const rows = j.sections[0].rows;
    const sub = rows.filter((r) => r.tone === 'subtotal');
    expect(sub).toHaveLength(2);
    const tot = rows.find((r) => r.tone === 'total')!.cells;
    expect(tot[4]).toBe(270);                 // HT : 100 + 190 − 20
    expect(tot[6]).toBe(326.7);               // TTC : 121 + 229,9 − 24,2
    expect(tot[7]).toBe(129.9);               // dû : facture 229,9 − 100
    expect(tot[8]).toBe(95);                  // marge : 40 + 60 − 5
  });
  test('règlements horizontaux : une colonne par mode utilisé', () => {
    const j = buildJournal('invoicesHorizontal', data);
    expect(j.sections[0].columns.map((c) => c.label)).toContain('Espèces');
    expect(j.sections[0].columns.map((c) => c.label)).toContain('Maestro / Débit');
    expect(j.sections[0].columns.map((c) => c.label)).not.toContain('Virement');
  });
  test('règlements verticaux : une ligne de détail par règlement', () => {
    expect(buildJournal('invoicesVertical', data).sections[0].rows.filter((r) => r.tone === 'detail')).toHaveLength(3);
  });
});

describe('encaissements', () => {
  test('état de la journée : règlements + entrées / sorties de caisse = total des encaissements', () => {
    const j = buildJournal('dayReceipts', data);
    expect(j.sections.map((s) => s.title)).toEqual(['17/11/2026', '18/11/2026']);
    const day2 = j.sections[1].rows.find((r) => r.tone === 'total')!.cells;
    expect(day2[4]).toBe(6975.8);             // 100 − 24,2 + 7 000 − 100
  });
  test('récapitulatif par mode : ventes, avoirs, entrées, sorties', () => {
    const j = buildJournal('dayRecap', data);
    const esp = j.sections[1].rows.find((r) => r.cells[0] === 'Espèces')!.cells;
    expect(esp).toEqual(['Espèces', 0, 0, -24.2, 0, -100, -124.2]);
  });
  test('état du mois simplifié : un total par mois et par mode', () => {
    const tot = total('monthReceiptsSimple')[0];
    expect(tot[tot.length - 1]).toBe(7086.8);  // 121 − 10 + 100 − 24,2 + 7 000 − 100
  });
});

describe('journal de caisse (report, solde)', () => {
  test('espèces : report de la remise d avant la période, remise de la période, sortie de remise non doublée, écart de clôture', () => {
    const j = buildJournal('cashJournal', data);
    const esp = j.sections.find((s) => s.title === 'Espèces')!;
    expect(esp.rows[0].cells[6]).toBe(100);   // report du 10/11
    const labels = esp.rows.map((r) => r.cells[2]);
    expect(labels).toContain('Remise en banque n° 2');
    expect(labels.filter((l) => String(l).startsWith('Remise en banque'))).toHaveLength(1);
    // 100 + 121 − 10 − 1 (écart Z) − 24,2 − 100 (remise) = 85,8
    expect(esp.rows[esp.rows.length - 1].cells[6]).toBe(85.8);
  });
  test('autres modes : lignes et total, sans report', () => {
    const vir = buildJournal('cashJournal', data).sections.find((s) => s.title === 'Virement')!;
    expect(vir.rows[vir.rows.length - 1].cells[6]).toBe(7000);
  });
});

describe('ventes et ventilations', () => {
  test('journal des ventes : total facturation et panier moyen hors avoirs', () => {
    const rows = buildJournal('salesJournal', data).sections[0].rows.filter((r) => r.tone === 'total');
    expect(rows[0].cells[3]).toBe(270);
    expect(rows[1].cells[3]).toBe(135);       // 270 / 2 ventes
  });
  test('ventilation TVA : base HT, TVA et TTC par taux ; filtre par taux', () => {
    const tot = total('ventVatDay')[0];
    expect(tot[2]).toBe(270);
    expect(buildJournal('ventVatDay', data, { vatRate: 6 }).sections[0].rows).toHaveLength(0);
  });
  test('ventilation par famille (niveau 1) : port à part, somme = HT', () => {
    const j = buildJournal('ventFamilyMonth', data, { familyLevel: 1 });
    const keys = j.sections[0].rows.filter((r) => !r.tone).map((r) => r.cells[1]);
    expect(keys).toEqual(['EQUIPEMENT', 'Port', 'R11']);
    expect(j.sections[0].rows.find((r) => r.tone === 'total')!.cells[3]).toBe(270);
  });
  test('ventilation par opérateur', () => {
    const rows = buildJournal('ventOperatorDay', data).sections[0].rows.filter((r) => !r.tone);
    expect(rows.map((r) => [r.cells[0], r.cells[1], r.cells[2]])).toEqual([['17/11/2026', 'Jeremy', 1], ['18/11/2026', 'Domenico', 1], ['18/11/2026', 'Jeremy', 1]]);
  });
  test('détail des ventes d une référence (avoir compris)', () => {
    const tot = total('articleSales', { reference: '97980' })[0];
    expect(tot[4]).toBe(2);                   // 2 + 1 − 1
    expect(buildJournal('articleSales', data).notes[0]).toContain('référence');
  });
  test('port par facture', () => {
    expect(total('shipping')[0][3]).toBe(10);
  });
  test('mouvements de fonds : n°, type, TVA, compte, cumul', () => {
    const j = buildJournal('movements', data);
    expect(j.sections[0].rows[0].cells.slice(0, 1)).toEqual(['1']);
    const cumul = j.sections[0].rows.find((r) => r.tone === 'total')!.cells;
    expect([cumul[6], cumul[7], cumul[9]]).toEqual([7000, 110, 1.74]);
  });
  test('historique des reports : remises de la période seulement', () => {
    const rows = buildJournal('reportHistory', data).sections[0].rows.filter((r) => !r.tone);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells[8]).toBe(86.8);
  });
  test('tous les journaux se construisent, y compris sans données, et excluent les brouillons (mention)', () => {
    const empty = parseJournalData({ from: '2026-11-18', to: '2026-11-18' });
    for (const id of JOURNAL_IDS) {
      expect(() => buildJournal(id, empty)).not.toThrow();
      expect(buildJournal(id, data).notes.join(' ')).toContain('Brouillons');
    }
  });
});

describe('export', () => {
  test('formatage des montants, % et dates', () => {
    expect(formatCell(1234.5, 'money')).toBe('1.234,50');
    expect(formatCell(-24.2, 'money')).toBe('-24,20');
    expect(formatCell(21, 'pct')).toBe('21 %');
    expect(formatCell('2026-11-18', 'date')).toBe('18/11/2026');
    expect(frDay('2026-11-18')).toBe('18/11/2026');
  });
  test('grille Excel : titre, période, en-têtes, valeurs numériques brutes', () => {
    const g = journalGrid(buildJournal('shipping', data), { companyName: 'ITALBIKE STORE', period: 'du 17/11/2026 au 18/11/2026' });
    expect(g[0][0]).toBe('Détail des montants de port par facture');
    expect(g[4]).toContain('Port HT');
    expect(g[5][3]).toBe(10);
    expect(g[5][1]).toBe('18/11/2026');
  });
  test('noms de feuilles Excel valides et uniques ; classeur produit', () => {
    const used = new Set<string>();
    expect(sheetName('Journal de caisse / situation : [espèces]', used)).not.toMatch(/[:\\/?*[\]]/);
    const a = sheetName('Liste des factures (règlements verticaux)', used);
    const b = sheetName('Liste des factures (règlements verticaux)', used);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(31);
    const bytes = buildJournalsXlsx(JOURNAL_IDS.map((id) => buildJournal(id, data, { reference: '97980' })), { companyName: 'X', period: 'P' });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe('bordereau de remise en banque', () => {
  test('lignes, total des encaissements, montant remis et reporté', () => {
    const j = depositSlipJournal(
      { number: 1, method: 'ESP', kind: 'remise', status: 'active', deposit_date: '2026-11-18', period_from: null, period_to: '2026-11-18T17:00:00Z',
        lines_total: 367.64, deposited_amount: 267.64, new_float: 100, line_count: 3, bank_label: 'BNP Paribas Fortis', bank_iban: 'BE71096123456769', bank_bic: 'GEBABEBB', comment: null },
      [
        { source_type: 'report', occurred_at: '2022-11-22T18:00:00Z', label: 'Report caisse du 22/11/2022', contact_label: null, document_number: null, amount: 350 },
        { source_type: 'payment', occurred_at: '2026-11-18T09:00:00Z', label: 'TIK 22701456', contact_label: null, document_number: '22701456', amount: 27.64 },
        { source_type: 'movement', occurred_at: '2026-11-18T10:00:00Z', label: 'Test consommable', contact_label: null, document_number: 'MVT 1', amount: -10 },
      ], 'Espèces');
    expect(j.title).toBe('Remise en banque : Espèces n° 1');
    expect(j.sections[1].rows[0].cells[1]).toBe('Report caisse du 22/11/2022');
    expect(j.sections[1].rows.find((r) => r.tone === 'total')!.cells[4]).toBe(367.64);
    expect(j.sections[2].rows.map((r) => r.cells[1])).toEqual([267.64, 100]);
  });
  test('libellés traduits du report et des écarts', () => {
    expect(sourceLabel({ source_type: 'closing_gap', label: 'Écart de clôture Z-2026-00001', occurred_at: '2026-11-17T18:00:00Z' })).toBe('Écart de clôture Z-2026-00001');
    expect(sourceLabel({ source_type: 'opening_gap', label: 'x', occurred_at: '2026-11-17T08:00:00Z' })).toBe('Ouverture / correction du fond de caisse');
  });
});
