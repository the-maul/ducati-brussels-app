/**
 * Tests des règles de commande de pièces — CLAUDE.md règle 7.
 * Les règles viennent de Paramètres (reference_values / order_threshold) : les tests passent
 * un jeu de règles identique au réglage initial, puis vérifient qu'un réglage modifié est suivi.
 * Même logique que la fonction SQL part_order_check_rules (contrôle qui fait foi).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  surchargeForKind, resolveKind, clientLinePrice, checkOrderRules,
  excelLineValue, excelLineFinal, excelTabTotal, excelTabReached, excelTabRemaining, excelTabsStatus,
  type ExcelLine, type OrderRule,
} from '../src/modules/orders/thresholds';

const base = { isActive: true, configured: true, minHt: null, surchargePct: 0, maxPerDay: null, fallback: null, minHtPerTab: null };
// Réglage initial de Paramètres → Tables → Règles des types de commande
const RULES: OrderRule[] = [
  { ...base, code: 'standard', label: 'Commande standard', sortOrder: 1, minHt: 250 },
  { ...base, code: 'urgente', label: 'Commande urgente', sortOrder: 2, minHt: 0, surchargePct: 10, maxPerDay: 1 },
  { ...base, code: 'accident', label: 'Commande accident', sortOrder: 3, minHt: 1500, fallback: 'standard' },
  { ...base, code: 'excel', label: 'Commande Excel', sortOrder: 4, minHtPerTab: 2000 },
];

test('supplément : urgente = +10 %, les autres 0 %', () => {
  expect(surchargeForKind('urgente', RULES)).toBe(10);
  expect(surchargeForKind('standard', RULES)).toBe(0);
  expect(surchargeForKind('excel', RULES)).toBe(0);
  expect(surchargeForKind('accident', RULES)).toBe(0);
});

test('standard : minimum 250 € HTVA', () => {
  expect(resolveKind('standard', 249.99, RULES)).toEqual({ effectiveKind: 'standard', thresholdMet: false });
  expect(resolveKind('standard', 250, RULES)).toEqual({ effectiveKind: 'standard', thresholdMet: true });
});

test('accident : ≥ 1 500 € reste accident, sinon repasse standard', () => {
  expect(resolveKind('accident', 1500, RULES)).toEqual({ effectiveKind: 'accident', thresholdMet: true });
  expect(resolveKind('accident', 800, RULES)).toEqual({ effectiveKind: 'standard', thresholdMet: true }); // 800 ≥ 250
  expect(resolveKind('accident', 100, RULES)).toEqual({ effectiveKind: 'standard', thresholdMet: false }); // 100 < 250
});

test('urgente : pas de minimum bloquant', () => {
  expect(resolveKind('urgente', 0, RULES)).toEqual({ effectiveKind: 'urgente', thresholdMet: true });
});

test('prix client ligne : urgente applique +10 %', () => {
  expect(clientLinePrice(100, 2, 'urgente', RULES)).toBe(220);
  expect(clientLinePrice(100, 2, 'standard', RULES)).toBe(200);
});

test('réglage modifié dans Paramètres : le nouveau minimum est suivi', () => {
  const changed = RULES.map((r) => (r.code === 'standard' ? { ...r, minHt: 300 } : r));
  expect(resolveKind('standard', 280, changed).thresholdMet).toBe(false);
  expect(resolveKind('standard', 280, RULES).thresholdMet).toBe(true);
});

// ---- Contrôle complet (même logique que part_order_check_rules) ----

test('contrôle : commande vide refusée', () => {
  const r = checkOrderRules({ kind: 'standard', totalHt: 0, lineCount: 0 }, RULES);
  expect(r.ok).toBe(false);
  expect(r.errors.map((e) => e.code)).toContain('no_lines');
});

test('contrôle : standard sous 250 € refusée, au-dessus acceptée', () => {
  const ko = checkOrderRules({ kind: 'standard', totalHt: 120, lineCount: 1 }, RULES);
  expect(ko.ok).toBe(false);
  expect(ko.errors[0]).toMatchObject({ code: 'below_min', min: 250, total: 120 });
  expect(checkOrderRules({ kind: 'standard', totalHt: 250, lineCount: 1 }, RULES).ok).toBe(true);
});

test('contrôle : urgente, une seule par jour et par société', () => {
  const first = checkOrderRules({ kind: 'urgente', totalHt: 30, lineCount: 1, validatedToday: 0, isDraft: true }, RULES);
  expect(first.ok).toBe(true);
  expect(first.surchargePct).toBe(10);
  const second = checkOrderRules({ kind: 'urgente', totalHt: 30, lineCount: 1, validatedToday: 1, isDraft: true }, RULES);
  expect(second.ok).toBe(false);
  expect(second.errors[0]).toMatchObject({ code: 'daily_limit', max: 1 });
  // À l'envoi (commande déjà validée), la limite du jour n'est pas recontrôlée
  expect(checkOrderRules({ kind: 'urgente', totalHt: 30, lineCount: 1, validatedToday: 1, isDraft: false }, RULES).ok).toBe(true);
});

test('contrôle : accident sous 1 500 € repasse en standard (avis), puis minimum standard', () => {
  const r = checkOrderRules({ kind: 'accident', totalHt: 800, lineCount: 2 }, RULES);
  expect(r.ok).toBe(true);
  expect(r.effectiveKind).toBe('standard');
  expect(r.notices[0]).toMatchObject({ code: 'fallback', to: 'standard' });
  const tiny = checkOrderRules({ kind: 'accident', totalHt: 100, lineCount: 1 }, RULES);
  expect(tiny.ok).toBe(false);
  expect(tiny.errors[0]).toMatchObject({ code: 'below_min', kind: 'standard' });
  expect(checkOrderRules({ kind: 'accident', totalHt: 1500, lineCount: 1 }, RULES).effectiveKind).toBe('accident');
});

test('contrôle : Excel, minimum 2 000 € par onglet utilisé', () => {
  const r = checkOrderRules({ kind: 'excel', totalHt: 4000, lineCount: 2, excelTabs: { demo: 1500, showroom: 2500 } }, RULES);
  expect(r.ok).toBe(false);
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toMatchObject({ code: 'below_min_tab', tab: 'demo', min: 2000 });
  expect(checkOrderRules({ kind: 'excel', totalHt: 2000, lineCount: 1, excelTabs: { courtoisie: 2000 } }, RULES).ok).toBe(true);
});

test('contrôle : type désactivé refusé, type non réglé accepté sans minimum (liste extensible)', () => {
  const off = RULES.map((r) => (r.code === 'urgente' ? { ...r, isActive: false } : r));
  expect(checkOrderRules({ kind: 'urgente', totalHt: 50, lineCount: 1 }, off).errors[0].code).toBe('kind_disabled');
  const extra = checkOrderRules({ kind: 'retour', totalHt: 10, lineCount: 1 }, RULES);
  expect(extra.ok).toBe(true);
  expect(extra.notices[0].code).toBe('no_rule');
});

// ---- Commande Excel (formules du classeur Ducati) ----

test('Excel : valeur ligne = prix dealer × qté (col M)', () => {
  expect(excelLineValue({ priceDealer: 810.4, qty: 2 })).toBe(1620.8);
});

test('Excel : prix final = M − (M × extra) (col O)', () => {
  expect(excelLineFinal({ tab: 'demo', priceDealer: 485.95, qty: 1, extraDiscount: 0.18 })).toBe(398.48);
});

const lines: ExcelLine[] = [
  { tab: 'demo', priceDealer: 810.4, qty: 2, extraDiscount: 0.18 },   // final 1329.06
  { tab: 'demo', priceDealer: 485.95, qty: 1, extraDiscount: 0.18 },  // final 398.48
  { tab: 'courtoisie', priceDealer: 100, qty: 5, extraDiscount: 0 },  // final 500
  { tab: 'showroom', priceDealer: 44.7, qty: 1, extraDiscount: 0.18 }, // final 36.65
];

test('Excel : total onglet = Σ prix finaux', () => {
  expect(excelTabTotal(lines, 'demo')).toBe(1727.54);
  expect(excelTabTotal(lines, 'courtoisie')).toBe(500);
});

test('Excel : minimum par onglet (atteint / reste)', () => {
  expect(excelTabReached(lines, 'demo', 2000)).toBe(false);
  expect(excelTabRemaining(lines, 'demo', 2000)).toBe(272.46);
  const big: ExcelLine[] = [{ tab: 'demo', priceDealer: 1000, qty: 3, extraDiscount: 0 }];
  expect(excelTabReached(big, 'demo', 2000)).toBe(true);
  expect(excelTabRemaining(big, 'demo', 2000)).toBe(0);
});

test('Excel : statut par onglet (3 onglets)', () => {
  const s = excelTabsStatus(lines, 2000);
  expect(Object.keys(s).sort()).toEqual(['courtoisie', 'demo', 'showroom']);
  expect(s.demo.reached).toBe(false);
  expect(s.courtoisie.total).toBe(500);
});
