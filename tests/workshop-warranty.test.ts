/**
 * Tests M8 — OR garantie (B10), rattrapage G8 du 18/11/2026 : couverture d'une ligne, refus total
 * et partiel avec re-routage vers le client, type de cession, commentaire automatique, resume de
 * la garantie (MO au taux garantie), taux MO garantie, retours constructeur, garanties / CA.
 */
import { describe, expect, test } from 'bun:test';
import {
  cessionFromRepairType, clientUnitPrice, isWarrantyCessionCode, lineCoveredByWarranty, lineDecisionToSave,
  lineReroutedToClient, parseWarrantyRate, returnStatusPatch, returnsTotals, statusAfterCessionChoice,
  warrantyLinesTotals, warrantyRatePct, warrantyRequestNote, warrantyStatsTotals, warrantyStatusTone, warrantySummary,
} from '../src/modules/workshop/warranty/rules';

const g = (p: Partial<{ is_warranty: boolean; warranty_decision: string | null }> = {}) => ({ is_warranty: true, warranty_decision: null, ...p });

describe('ligne couverte par la garantie (B10)', () => {
  test('ligne hors garantie : jamais couverte', () => {
    for (const s of ['aucune', 'en_attente', 'accepte', 'refus_total', 'refus_partiel']) {
      expect(lineCoveredByWarranty({ is_warranty: false }, s)).toBe(false);
    }
  });
  test('en attente / acceptee / ancienne saisie sans statut : 0 € pour le client', () => {
    expect(lineCoveredByWarranty(g(), 'en_attente')).toBe(true);
    expect(lineCoveredByWarranty(g(), 'accepte')).toBe(true);
    expect(lineCoveredByWarranty(g(), 'aucune')).toBe(true);
    expect(lineCoveredByWarranty(g(), undefined)).toBe(true);
  });
  test('refus total : toutes les lignes re-routees vers le client', () => {
    expect(lineCoveredByWarranty(g(), 'refus_total')).toBe(false);
    expect(lineReroutedToClient(g(), 'refus_total')).toBe(true);
    expect(clientUnitPrice({ ...g(), unit_price_ht: 80 }, 'refus_total')).toBe(80);
  });
  test('refus partiel : seule la ligne refusee part au client', () => {
    expect(lineCoveredByWarranty(g({ warranty_decision: 'accepte' }), 'refus_partiel')).toBe(true);
    expect(lineCoveredByWarranty(g(), 'refus_partiel')).toBe(true);
    expect(lineCoveredByWarranty(g({ warranty_decision: 'refuse' }), 'refus_partiel')).toBe(false);
    expect(lineReroutedToClient(g({ warranty_decision: 'refuse' }), 'refus_partiel')).toBe(true);
    expect(clientUnitPrice({ ...g({ warranty_decision: 'refuse' }), unit_price_ht: 50 }, 'refus_partiel')).toBe(50);
    expect(clientUnitPrice({ ...g({ warranty_decision: 'accepte' }), unit_price_ht: 50 }, 'refus_partiel')).toBe(0);
  });
  test('une decision « refusee » ne joue qu\'en refus partiel', () => {
    expect(lineCoveredByWarranty(g({ warranty_decision: 'refuse' }), 'accepte')).toBe(true);
  });
  test('decision enregistree seulement sur une ligne en garantie', () => {
    expect(lineDecisionToSave(g({ warranty_decision: 'refuse' }))).toBe('refuse');
    expect(lineDecisionToSave({ is_warranty: false, warranty_decision: 'refuse' })).toBeNull();
    expect(lineDecisionToSave(g({ warranty_decision: 'n importe' }))).toBeNull();
  });
});

describe('type de cession garantie (05 / 06 / 07)', () => {
  test('codes reconnus', () => {
    expect(isWarrantyCessionCode('05')).toBe(true);
    expect(isWarrantyCessionCode('07')).toBe(true);
    expect(isWarrantyCessionCode('01')).toBe(false);
  });
  test('type de reparation garantie Ducati → 05, magasin → 06, autre → rien', () => {
    expect(cessionFromRepairType('garantie_ducati')).toBe('05');
    expect(cessionFromRepairType('garantie_magasin')).toBe('06');
    expect(cessionFromRepairType('entretien')).toBeNull();
  });
  test('choisir un type ouvre la demande (en attente) sans ecraser un statut engage', () => {
    expect(statusAfterCessionChoice('aucune', '05')).toBe('en_attente');
    expect(statusAfterCessionChoice('accepte', '05')).toBe('accepte');
    expect(statusAfterCessionChoice('aucune', '')).toBe('aucune');
  });
  test('commentaire automatique comme G8', () => {
    expect(warrantyRequestNote('Demande de garantie pour le châssis {vin} immat. {plate}', { vin: 'ZDM1234', plate: '1-ABC-123' }))
      .toBe('Demande de garantie pour le châssis ZDM1234 immat. 1-ABC-123');
    expect(warrantyRequestNote('{vin} / {plate}', {})).toBe('— / —');
  });
  test('badge : couleur par avancement (jamais le rouge marque)', () => {
    expect(warrantyStatusTone('en_attente')).toBe('warning');
    expect(warrantyStatusTone('accepte')).toBe('success');
    expect(warrantyStatusTone('refus_total')).toBe('danger');
    expect(warrantyStatusTone('refus_partiel')).toBe('info');
  });
});

describe('resume de la garantie et taux MO garantie', () => {
  const lines = [
    { kind: 'piece', is_warranty: true, quantity: 2, unit_price_ht: 10, discount_pct: 0 },
    { kind: 'mo', is_warranty: true, quantity: 1.5, unit_price_ht: 63.47, discount_pct: 0 },
    { kind: 'piece', is_warranty: true, warranty_decision: 'refuse', quantity: 1, unit_price_ht: 99, discount_pct: 0 },
    { kind: 'piece', is_warranty: false, quantity: 1, unit_price_ht: 5, discount_pct: 0 },
    { kind: 'mo', is_warranty: true, quantity: 1, unit_price_ht: 63.47, checkup_state: 'reporte' },
  ];
  test('refus partiel : pieces + MO couvertes, MO au taux garantie, une ligne re-routee', () => {
    const s = warrantySummary(lines, 'refus_partiel', 46.94);
    expect(s.coveredLines).toBe(2);
    expect(s.coveredSaleHt).toBe(115.21); // 20 + 1,5 x 63,47
    expect(s.labourHours).toBe(1.5);
    expect(s.labourWarrantyHt).toBe(70.41); // 1,5 x 46,94
    expect(s.rerouted).toBe(1);
  });
  test('sans taux garantie : MO valorisee au prix de la ligne', () => {
    expect(warrantySummary(lines, 'accepte', null).labourWarrantyHt).toBe(95.21);
  });
  test('refus total : rien de couvert', () => {
    const s = warrantySummary(lines, 'refus_total', 46.94);
    expect(s.coveredLines).toBe(0);
    expect(s.rerouted).toBe(3);
  });
  test('taux lu dans Parametres → Tables → Garantie atelier (code mo)', () => {
    expect(parseWarrantyRate([{ code: 'mo', is_active: true, extra: { hourly_rate_ht: 46.94 } }])).toBe(46.94);
    expect(parseWarrantyRate([{ code: 'mo', is_active: true, extra: { hourly_rate_ht: '46,94' } }])).toBe(46.94);
    expect(parseWarrantyRate([{ code: 'mo', is_active: false, extra: { hourly_rate_ht: 46.94 } }])).toBeNull();
    expect(parseWarrantyRate([{ code: 'mo', is_active: true, extra: { hourly_rate_ht: 0 } }])).toBeNull();
    expect(parseWarrantyRate([])).toBeNull();
  });
});

describe('retours / remboursements constructeur', () => {
  test('rembourse / echange : date de reception de la garantie posee (sans ecraser une date saisie)', () => {
    expect(returnStatusPatch('rembourse', { settled_at: null }, '2026-11-18')).toEqual({ status: 'rembourse', settled_at: '2026-11-18' });
    expect(returnStatusPatch('echange', { settled_at: '2026-11-02' }, '2026-11-18')).toEqual({ status: 'echange', settled_at: '2026-11-02' });
  });
  test('retour en attente : la date de reglement est effacee', () => {
    expect(returnStatusPatch('attente_echange', { settled_at: '2026-11-02' }, '2026-11-18')).toEqual({ status: 'attente_echange', settled_at: null });
  });
  test('totaux en attente / regles', () => {
    expect(returnsTotals([
      { status: 'attente_remboursement', amount_ht: 10 }, { status: 'attente_echange', amount_ht: '5.5' },
      { status: 'rembourse', amount_ht: 20 }, { status: 'echange', amount_ht: 1 },
    ])).toEqual({ pendingCount: 2, pendingHt: 15.5, settledCount: 2, settledHt: 21 });
  });
});

describe('listes Garanties et Garanties / CA', () => {
  test('% garantie / CA au PAMP, null sans CA', () => {
    expect(warrantyRatePct(150, 3000)).toBe(5);
    expect(warrantyRatePct(10, 0)).toBeNull();
  });
  test('totaux de la statistique', () => {
    const t = warrantyStatsTotals([
      { contact_id: 'a', client_code: '1', client_name: 'A', revenue_ht: 1000, warranty_pamp_ht: 50, warranty_pa_ht: 60, warranty_sale_ht: 90, warranty_lines: 2 },
      { contact_id: 'b', client_code: '2', client_name: 'B', revenue_ht: '1000', warranty_pamp_ht: '50', warranty_pa_ht: 40, warranty_sale_ht: 10, warranty_lines: 1 },
    ]);
    expect(t).toEqual({ revenueHt: 2000, pampHt: 100, paHt: 100, saleHt: 100, lines: 3, pct: 5 });
  });
  test('totaux de la liste : temps MO, pieces, MO, total', () => {
    expect(warrantyLinesTotals([
      { labour_hours: 1.5, parts_cost_ht: 0, labour_cost_ht: 70.41 },
      { labour_hours: 0, parts_cost_ht: '12.30', labour_cost_ht: 0 },
    ])).toEqual({ hours: 1.5, partsHt: 12.3, labourHt: 70.41, totalHt: 82.71 });
  });
});
