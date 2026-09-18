/**
 * Tests des lignes d'une commande de pièces : totaux HTVA et rappel du seuil du type en direct
 * (carte « Ajouter et modifier les pièces d'une commande », mission 02). Même formule que le
 * serveur (trigger part_order_lines_guard, fonction part_order_check_rules).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  lineHt, orderTotals, withDraftLine, validateLine, availableQty, thresholdProgress,
} from '../src/modules/orders/lines';
import type { OrderRule } from '../src/modules/orders/thresholds';

const base = { isActive: true, configured: true, minHt: null, surchargePct: 0, maxPerDay: null, fallback: null, minHtPerTab: null };
const RULES: OrderRule[] = [
  { ...base, code: 'standard', label: 'Commande standard', sortOrder: 1, minHt: 250 },
  { ...base, code: 'urgente', label: 'Commande urgente', sortOrder: 2, minHt: 0, surchargePct: 10, maxPerDay: 1 },
  { ...base, code: 'accident', label: 'Commande accident', sortOrder: 3, minHt: 1500, fallback: 'standard' },
  { ...base, code: 'excel', label: 'Commande Excel', sortOrder: 4, minHtPerTab: 2000 },
];

test('total de ligne = (qté client + qté magasin) × PU HTVA, arrondi au centime', () => {
  expect(lineHt({ qtyClient: 2, qtyShop: 1, unitPriceHt: 100 })).toBe(300);
  expect(lineHt({ qtyClient: 3, qtyShop: 0, unitPriceHt: 50.555 })).toBe(151.67); // = serveur (vérifié en base)
  expect(lineHt({ qtyClient: 0, qtyShop: 1.5, unitPriceHt: 10.005 })).toBe(15.01);
  expect(lineHt({ qtyClient: 0, qtyShop: 0, unitPriceHt: 99 })).toBe(0);
});

test('totaux de la commande : somme des lignes arrondies, TVA et TVAC', () => {
  const t = orderTotals([
    { qtyClient: 3, qtyShop: 0, unitPriceHt: 50.555, vatRate: 21 },
    { qtyClient: 1, qtyShop: 0, unitPriceHt: 300, vatRate: 21 },
    { qtyClient: 0, qtyShop: 2, unitPriceHt: 10, vatRate: 6 },
  ]);
  expect(t.lineCount).toBe(3);
  expect(t.qtyClient).toBe(4);
  expect(t.qtyShop).toBe(2);
  expect(t.totalHt).toBe(471.67);
  expect(t.totalTtc).toBe(567.72); // 151,67×1,21 + 300×1,21 + 20×1,06
  expect(t.totalVat).toBe(96.05);
  expect(orderTotals([])).toEqual({ lineCount: 0, qtyClient: 0, qtyShop: 0, totalHt: 0, totalVat: 0, totalTtc: 0 });
});

test('aperçu en direct : la ligne en cours de saisie remplace ou complète les lignes', () => {
  const lines = [
    { id: 'a', qtyClient: 1, qtyShop: 0, unitPriceHt: 100, vatRate: 21 },
    { id: 'b', qtyClient: 1, qtyShop: 0, unitPriceHt: 50, vatRate: 21 },
  ];
  expect(orderTotals(withDraftLine(lines, null)).totalHt).toBe(150);
  expect(orderTotals(withDraftLine(lines, { id: 'a', qtyClient: 3, qtyShop: 0, unitPriceHt: 100, vatRate: 21 })).totalHt).toBe(350);
  expect(orderTotals(withDraftLine(lines, { id: null, qtyClient: 1, qtyShop: 1, unitPriceHt: 25, vatRate: 21 })).totalHt).toBe(200);
});

test('contrôles de saisie identiques au serveur', () => {
  const ok = { qtyClient: 1, qtyShop: 0, unitPriceHt: 10, vatRate: 21, designation: 'Filtre' };
  expect(validateLine(ok)).toBeNull();
  expect(validateLine({ ...ok, qtyShop: 2, qtyClient: 0 })).toBeNull();
  expect(validateLine({ ...ok, qtyClient: 0 })).toBe('qty_zero');
  expect(validateLine({ ...ok, qtyClient: -1, qtyShop: 3 })).toBe('qty_negative');
  expect(validateLine({ ...ok, qtyClient: Number.NaN })).toBe('qty_negative');
  expect(validateLine({ ...ok, unitPriceHt: -5 })).toBe('price_negative');
  expect(validateLine({ ...ok, designation: '  ' })).toBe('designation_empty');
  expect(validateLine({ ...ok, unitPriceHt: 0 })).toBeNull(); // pièce gratuite (garantie) acceptée
});

test('disponible (B4) = réel − réservé + en commande', () => {
  expect(availableQty(5, 2, 0)).toBe(3);
  expect(availableQty(5, 2, 4)).toBe(7);
  expect(availableQty(0, 1, 0)).toBe(-1);
});

test('seuil standard : il manque ce qu’il faut pour 250 €, puis atteint', () => {
  const p = thresholdProgress('standard', 151.67, RULES);
  expect(p.met).toBe(false);
  expect(p.min).toBe(250);
  expect(p.remaining).toBe(98.33);
  expect(p.percent).toBe(60);
  expect(p.tone).toBe('danger');
  const q = thresholdProgress('standard', 250, RULES);
  expect(q.met).toBe(true);
  expect(q.remaining).toBe(0);
  expect(q.percent).toBe(100);
  expect(q.tone).toBe('success');
});

test('seuil accident : sous 1 500 € bascule en standard (minimum standard appliqué)', () => {
  const low = thresholdProgress('accident', 151.67, RULES);
  expect(low.fellBack).toBe(true);
  expect(low.effectiveKind).toBe('standard');
  expect(low.kindMin).toBe(1500);
  expect(low.kindRemaining).toBe(1348.33);
  expect(low.min).toBe(250);
  expect(low.remaining).toBe(98.33);
  expect(low.met).toBe(false);

  const mid = thresholdProgress('accident', 800, RULES);
  expect(mid.fellBack).toBe(true);
  expect(mid.met).toBe(true); // valable en standard
  expect(mid.tone).toBe('warning');

  const high = thresholdProgress('accident', 1500, RULES);
  expect(high.fellBack).toBe(false);
  expect(high.effectiveKind).toBe('accident');
  expect(high.met).toBe(true);
  expect(high.tone).toBe('success');
});

test('seuil urgente : pas de minimum, supplément +10 % rappelé', () => {
  const p = thresholdProgress('urgente', 12.5, RULES);
  expect(p.met).toBe(true);
  expect(p.min).toBeNull();
  expect(p.surchargePct).toBe(10);
});

test('règles suivies depuis Paramètres : minimum modifié, type désactivé, type non réglé', () => {
  const changed = RULES.map((r) => (r.code === 'standard' ? { ...r, minHt: 300 } : r));
  expect(thresholdProgress('standard', 250, changed).remaining).toBe(50);
  const disabled = RULES.map((r) => (r.code === 'standard' ? { ...r, isActive: false } : r));
  const d = thresholdProgress('standard', 999, disabled);
  expect(d.disabled).toBe(true);
  expect(d.met).toBe(false);
  const n = thresholdProgress('garantie', 10, RULES);
  expect(n.configured).toBe(false);
  expect(n.met).toBe(true);
});
