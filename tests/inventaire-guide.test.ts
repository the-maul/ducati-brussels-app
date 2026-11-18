/**
 * Tests M5 — rattrapage G8 du 18/11/2026 (règle 7 : arrêté / réintégration d'inventaire).
 *  - B4 : copies automatiques le 15 et en fin de mois, stock à une date, réintégration unique et juste
 *         (avec ou sans remise à zéro, ventes pendant le comptage) ;
 *  - B6 : les 3 modes de réajustement sur l'arrêté et sur le stock réel ;
 *  - B7 : tout réajustement est un delta (ancien → nouveau), jamais une écrasement ;
 *  - B12 : quantité d'étiquettes par défaut = stock réel (ou 1), cumul par poste, double étiquette ;
 *  - les 8 méthodes G8 et leur check-list d'étapes avec retour arrière.
 * Mêmes règles que supabase/migrations/20261118210000_m5_inventaire_guide.sql (essai à blanc
 * supabase/tests/m5_inventaire_guide.sql). Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  ALL_METHODS, methodSteps, methodCode, nextStep, rollbackTarget, defaultMode, stepKind, isDangerousStep,
  nextArreteQty, realReadjustDelta, reintegrationDelta, resetDeltas, isAutoCopyDay, stockAtDate,
  type ArreteAdjustment,
} from '../src/modules/stock/inventory-rules';
import { defaultLabelQty, groupPendingByWorkstation, cumulate, labelItemsFor, type PendingRow } from '../src/modules/stock/labels-rules';
import { sortEditionRows, triStateKeeps, filtersToJson, DEFAULT_FILTERS, viewNeedsSnapshot, subtotals } from '../src/modules/stock/edition-rules';

describe('les 8 méthodes G8', () => {
  test('8 méthodes distinctes, codes uniques', () => {
    expect(ALL_METHODS.length).toBe(8);
    expect(new Set(ALL_METHODS.map(methodCode)).size).toBe(8);
  });

  test('magasin ouvert : la séquence G8 relevée le 18/11', () => {
    expect(methodSteps({ open: true, erase: false, gaps: false })).toEqual([
      'debut', 'sauvegarde', 'generation_arrete', 'raz_stock_reel', 'edition_arrete_initial',
      'comptage', 'reajustement_arrete', 'edition_arrete_final', 'sauvegarde_finale', 'reintegration', 'copie_stock', 'fin',
    ]);
  });

  test('effacement et écarts ajoutent leurs étapes au bon endroit', () => {
    const o = methodSteps({ open: true, erase: true, gaps: true });
    expect(o.indexOf('raz_arrete')).toBeLessThan(o.indexOf('comptage'));
    expect(o.indexOf('edition_ecarts')).toBeGreaterThan(o.indexOf('reajustement_arrete'));
    expect(o.indexOf('edition_ecarts')).toBeLessThan(o.indexOf('reintegration'));
    const f = methodSteps({ open: false, erase: true, gaps: true });
    expect(f).not.toContain('reintegration');
    expect(f).toContain('reajustement_reel');
    expect(f.indexOf('raz_stock_reel')).toBeLessThan(f.indexOf('comptage'));
  });

  test('toutes les méthodes commencent par Début et finissent par Fin, réintégration seulement magasin ouvert', () => {
    for (const m of ALL_METHODS) {
      const s = methodSteps(m);
      expect(s[0]).toBe('debut');
      expect(s[s.length - 1]).toBe('fin');
      expect(s.includes('reintegration')).toBe(m.open);
      expect(new Set(s).size).toBe(s.length);
    }
  });

  test('mode par défaut : effacement → cumul, sinon annule et remplace', () => {
    expect(defaultMode({ open: false, erase: true, gaps: false })).toBe('cumul');
    expect(defaultMode({ open: true, erase: false, gaps: false })).toBe('annule_remplace');
  });

  test('check-list : étape suivante, retour arrière sur la dernière validée, réintégration définitive', () => {
    const steps = methodSteps({ open: true, erase: false, gaps: false });
    expect(nextStep(steps, new Set())).toBe('debut');
    const done = new Set(['debut', 'sauvegarde', 'generation_arrete']);
    expect(nextStep(steps, done)).toBe('raz_stock_reel');
    expect(rollbackTarget(steps, done)).toBe('generation_arrete');
    expect(rollbackTarget(steps, new Set())).toBeNull();
    const upToReint = new Set(steps.slice(0, steps.indexOf('reintegration') + 1));
    expect(rollbackTarget(steps, upToReint)).toBeNull();
    expect(nextStep(steps, new Set(steps))).toBeNull();
  });

  test('nature des étapes', () => {
    expect(stepKind('generation_arrete')).toBe('action');
    expect(stepKind('reajustement_arrete')).toBe('saisie');
    expect(stepKind('edition_ecarts')).toBe('edition');
    expect(stepKind('debut')).toBe('repere');
    expect(isDangerousStep('raz_stock_reel')).toBe(true);
    expect(isDangerousStep('comptage')).toBe(false);
  });
});

describe('B6 — 3 modes de réajustement sur l\'arrêté', () => {
  const h = (id: number, mode: ArreteAdjustment['mode'], counted: number | null, bin: string | null = null): ArreteAdjustment => ({ id, mode, counted, bin });

  test('annule et remplace : la saisie remplace', () => {
    expect(nextArreteQty([], 'annule_remplace', 7)).toBe(7);
    expect(nextArreteQty([h(1, 'cumul', 3)], 'annule_remplace', 2)).toBe(2);
  });

  test('cumul : les comptages de plusieurs emplacements s\'additionnent, en partant de 0', () => {
    expect(nextArreteQty([], 'cumul', 3)).toBe(3);
    expect(nextArreteQty([h(1, 'cumul', 3)], 'cumul', 2)).toBe(5);
    // un annule-et-remplace remet la base du cumul à zéro
    expect(nextArreteQty([h(1, 'cumul', 3), h(2, 'annule_remplace', 10)], 'cumul', 2)).toBe(2);
  });

  test('casier : recompter un casier remplace ce casier seulement', () => {
    const hist = [h(1, 'casier', 3, 'A12'), h(2, 'casier', 4, 'B03')];
    expect(nextArreteQty(hist, 'casier', 5, 'C01')).toBe(12);
    expect(nextArreteQty(hist, 'casier', 1, 'A12')).toBe(5);
    expect(nextArreteQty([], 'casier', 2, 'A12')).toBe(2);
  });

  test('après une remise à zéro de l\'arrêté, le cumul repart de 0', () => {
    expect(nextArreteQty([h(1, 'cumul', 3), h(2, 'raz', null)], 'cumul', 4)).toBe(4);
  });
});

describe('B6 — 3 modes de réajustement sur le stock réel', () => {
  test('annule et remplace (G8 : 000017847, 3 → 10 = mouvement +7)', () => {
    expect(realReadjustDelta('annule_remplace', 3, 10)).toBe(7);
  });
  test('cumul : la saisie s\'ajoute', () => {
    expect(realReadjustDelta('cumul', 3, 2)).toBe(2);
  });
  test('casier : un seul emplacement → comme annule et remplace ; plusieurs → stock du casier', () => {
    expect(realReadjustDelta('casier', 5, 4, { multiBin: false })).toBe(-1);
    expect(realReadjustDelta('casier', 5, 4, { multiBin: true, binQty: 2 })).toBe(2);
  });
});

describe('B4 — réintégration de l\'arrêté', () => {
  test('avec remise à zéro : le réel (= ventes pendant le comptage) reçoit l\'arrêté compté', () => {
    // arrêté 10, RAZ → 0, 2 ventes pendant le comptage → réel −2 ; compté 9
    // cible = 9 + (−2) = 7 ; réel actuel −2 → mouvement +9
    expect(reintegrationDelta(9, -2, -2)).toBe(9);
  });
  test('sans remise à zéro : seul l\'écart de comptage est passé', () => {
    // arrêté 10, réel 10 − 2 ventes = 8 ; compté 9 → cible 7 → mouvement −1 (l'écart d'inventaire)
    expect(reintegrationDelta(9, -2, 8)).toBe(-1);
  });
  test('article non compté et sans effacement : rien ne bouge', () => {
    expect(reintegrationDelta(10, 0, 10)).toBe(0);
  });
});

describe('remise à zéro du stock réel', () => {
  const lv = [
    { article_id: 'a', real_qty: 3, mgmt_type: 'A' },
    { article_id: 'b', real_qty: -2, mgmt_type: 'A' },
    { article_id: 'm', real_qty: 1, mgmt_type: 'V' },
    { article_id: 'z', real_qty: 0, mgmt_type: 'A' },
  ];
  test('positifs et négatifs, motos conservées', () => {
    expect(resetDeltas(lv, 'tous', true)).toEqual([{ article_id: 'a', delta: -3 }, { article_id: 'b', delta: 2 }]);
  });
  test('uniquement les négatifs', () => {
    expect(resetDeltas(lv, 'negatifs', false)).toEqual([{ article_id: 'b', delta: 2 }]);
  });
});

describe('B4 — copies datées et stock à une date', () => {
  test('le 15 et le dernier jour du mois (février bissextile compris)', () => {
    expect(isAutoCopyDay({ year: 2026, month: 11, day: 15 })).toBe(true);
    expect(isAutoCopyDay({ year: 2026, month: 11, day: 30 })).toBe(true);
    expect(isAutoCopyDay({ year: 2026, month: 12, day: 30 })).toBe(false);
    expect(isAutoCopyDay({ year: 2028, month: 2, day: 29 })).toBe(true);
    expect(isAutoCopyDay({ year: 2026, month: 2, day: 28 })).toBe(true);
    expect(isAutoCopyDay({ year: 2026, month: 11, day: 18 })).toBe(false);
  });
  test('stock à une date = mouvements jusqu\'à la date, réservations exclues', () => {
    const moves = [
      { qty_delta: 5, occurred_at: '2026-11-01T10:00:00Z', is_reservation: false },
      { qty_delta: -1, occurred_at: '2026-11-10T10:00:00Z', is_reservation: false },
      { qty_delta: 2, occurred_at: '2026-11-10T11:00:00Z', is_reservation: true },
      { qty_delta: -3, occurred_at: '2026-11-20T10:00:00Z', is_reservation: false },
    ];
    expect(stockAtDate(moves, '2026-11-15T23:59:59Z')).toBe(4);
    expect(stockAtDate(moves, '2026-12-01T00:00:00Z')).toBe(1);
  });
});

describe('B12 — étiquetage', () => {
  test('quantité par défaut = stock réel (au moins 1) ou une seule ; réception = quantité reçue', () => {
    expect(defaultLabelQty('stock', 4)).toBe(4);
    expect(defaultLabelQty('stock', 0)).toBe(1);
    expect(defaultLabelQty('stock', -2)).toBe(1);
    expect(defaultLabelQty('one', 12)).toBe(1);
    expect(defaultLabelQty('stock', 4, 5)).toBe(5);
  });

  test('édition différée cumulée : regroupée par poste, quantités additionnées', () => {
    const row = (ws: string | null, name: string | null, art: string, qty: number): PendingRow => ({
      workstation_id: ws, workstation_name: name, article_id: art, reference: art, designation: art,
      with_barcode: true, with_price: true, with_tarif: false, qty, lines: 1, first_at: '', last_at: '', operators: null, ids: [1],
    });
    const groups = groupPendingByWorkstation([row('p1', 'Comptoir', 'x', 2), row('p2', 'Atelier', 'x', 1), row('p1', 'Comptoir', 'y', 3)]);
    expect(groups.length).toBe(2);
    expect(groups.find((g) => g.workstation_id === 'p1')!.total).toBe(5);
    expect(cumulate([{ article_id: 'x', qty: 2 }, { article_id: 'x', qty: 3 }, { article_id: 'y', qty: 1 }]))
      .toEqual([{ article_id: 'x', qty: 5 }, { article_id: 'y', qty: 1 }]);
  });

  test('avec / sans prix, avec / sans code-barres, double étiquette au prix tarif', () => {
    const art = { reference: 'R1', designation: 'Filtre', bin_location: 'A12', bin_location2: null, price_ttc: 12, price_ht: 9.92, price_tarif: 14.5, pack_qty: 1, barcode: '3000118912704' };
    const opts = { withPrice: true, withBarcode: true, withTarif: true, storeName: 'Ducati', tarifLabel: 'Prix tarif' };
    const items = labelItemsFor(art, 2, 12, opts);
    expect(items.length).toBe(2);
    expect(items[0].data.price_ttc).toBe(12);
    expect(items[0].data.barcode_value).toBe('3000118912704');
    expect(items[1].data.price_ttc).toBe(14.5);
    expect(items[1].data.discount).toBe('Prix tarif');
    expect(items[1].data.designation).toBe('Prix tarif · Filtre');
    const plain = labelItemsFor(art, 1, 12, { ...opts, withPrice: false, withBarcode: false, withTarif: false });
    expect(plain.length).toBe(1);
    expect(plain[0].data.price_ttc).toBeNull();
    expect(plain[0].data.barcode_value).toBe('R1');
  });
});

describe('édition du stock multi-critères', () => {
  test('filtres à trois états', () => {
    expect(triStateKeeps('inclus', true)).toBe(true);
    expect(triStateKeeps('exclus', true)).toBe(false);
    expect(triStateKeeps('uniquement', false)).toBe(false);
  });
  test('paramètres envoyés : stocks nuls exclus par défaut, champs vides omis, date en fin de journée', () => {
    const j = filtersToJson({ ...DEFAULT_FILTERS, at: '2026-10-31' });
    expect(j.zero).toBe('exclus');
    expect(j.at).toBe('2026-10-31T23:59:59');
    expect('supplier_id' in j).toBe(false);
  });
  test('onglets qui lisent une photo', () => {
    expect(viewNeedsSnapshot('non_reajuste')).toBe('arrete');
    expect(viewNeedsSnapshot('copie')).toBe('copie');
    expect(viewNeedsSnapshot('date')).toBeNull();
  });
  test('classement sur plusieurs niveaux, vides en dernier, sous-totaux', () => {
    const r = (supplier: string | null, cat: string, ref: string, qty: number) => ({
      supplier_name: supplier, category_path: cat, brand: null, bin_location: null, mgmt_type: 'A',
      reference: ref, designation: ref, serial_no: null, qty, value: qty * 2,
    });
    const rows = [r('Ducati', '02-01-03', 'B', 1), r(null, '01-01-01', 'A', 2), r('Bihr', '02-01-01', 'C', 3), r('Ducati', '01-02-01', 'D', 4)];
    expect(sortEditionRows(rows, ['supplier', 'rayon']).map((x) => x.reference)).toEqual(['C', 'D', 'B', 'A']);
    expect(sortEditionRows(rows, ['rayon', 'reference']).map((x) => x.reference)).toEqual(['A', 'D', 'B', 'C']);
    const st = subtotals(rows, 'rayon');
    expect(st.find((s) => s.key === '02')!.qty).toBe(4);
  });
});
