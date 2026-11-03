/**
 * Etat au tarif Ducati (TAR008, 03/11/2026) : vide = commandable, E = remplacee, F = fin de serie.
 * Mapping, anomalies du rapport d'import (creation et mise a jour), garde-fous de commande
 * fournisseur et de publication Shopify, pastille de recherche. Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { guessMapping, buildRows } from '../src/modules/articles/import/parse';
import { availabilityFromStatus, diffRow, type ExistingArticle, type ImportRow } from '../src/modules/articles/import/rules';
import {
  supplyStateOf, supplierOrderDecision, guardSupplierLinesPure, supplyBadgeOf, type SupplyArticle,
} from '../src/modules/articles/supply-state';
import { canPublish } from '../supabase/functions/_shared/shopify-push';

const HEADERS = [
  'Matériel', 'Description matériel', 'État', 'Nombre colis', 'Classe de remise',
  'Hiérarchie des produits', 'Remplacement', 'Prix au détail', 'Devise',
  'Poids net', 'Unité de mesure', 'Code Intrastat',
];
const line = (etat: string, repl = '') => ['X1', 'PIECE', etat, '1', 'C', 'R11', repl, '10', 'EUR', '1', 'KG', ''];

const existing = (over: Partial<ExistingArticle> = {}): ExistingArticle => ({
  id: 'a1', reference: 'REF1', designation: 'PIECE', brand: 'Ducati', category_path: null, supplier_ref: 'REF1',
  purchase_price: 10, sale_price_ttc: 100, coefficient: null, superseded_by_id: null, is_library: false,
  supplier_availability: null, ...over,
});
const row = (over: Partial<ImportRow> = {}): ImportRow => ({ reference: 'REF1', rowIndex: 2, ...over });

describe('mapping de la colonne Etat', () => {
  test('vide = commandable (vert), E = remplacee (jaune), F = fin de serie (rouge)', () => {
    expect(availabilityFromStatus('')).toBe('green');
    expect(availabilityFromStatus('  ')).toBe('green');
    expect(availabilityFromStatus('E')).toBe('yellow');
    expect(availabilityFromStatus(' e ')).toBe('yellow');
    expect(availabilityFromStatus('F')).toBe('red');
  });
  test('colonne absente ou lettre inconnue : on ne touche a rien', () => {
    expect(availabilityFromStatus(null)).toBeNull();
    expect(availabilityFromStatus(undefined)).toBeNull();
    expect(availabilityFromStatus('Z')).toBeNull();
  });
  test('parse : cellule vide -> "" (commandable), colonne absente -> null', () => {
    const m = guessMapping(HEADERS);
    const rows = buildRows({ headers: HEADERS, rows: [line(''), line('E', 'X2'), line('F')] }, m);
    expect(rows.map((r) => r.supply_status)).toEqual(['', 'E', 'F']);
    const noCol = buildRows({ headers: ['Référence', 'Désignation'], rows: [['X1', 'PIECE']] }, guessMapping(['Référence', 'Désignation']));
    expect(noCol[0].supply_status).toBeNull();
    expect(availabilityFromStatus(noCol[0].supply_status)).toBeNull();
  });
  test("l'etat stocke correspond aux trois etats lisibles", () => {
    expect(supplyStateOf('green')).toBe('orderable');
    expect(supplyStateOf('yellow')).toBe('replaced');
    expect(supplyStateOf('red')).toBe('discontinued');
    expect(supplyStateOf(null)).toBe('unknown');
  });
});

describe("anomalies du rapport d'import", () => {
  test('creation : E avec remplacement, F, vide', () => {
    const e = diffRow(row({ reference: 'NEW1', supply_status: 'E', replacement_ref: 'NEW2' }), null);
    expect(e.patch.supplier_availability).toBe('yellow');
    expect(e.anomalies).toContain('Remplacée par NEW2 chez Ducati : commandez la nouvelle référence.');
    const f = diffRow(row({ reference: 'NEW1', supply_status: 'F' }), null);
    expect(f.patch.supplier_availability).toBe('red');
    expect(f.anomalies).toContain('Fin de série chez Ducati, sans remplaçant : plus commandable.');
    const v = diffRow(row({ reference: 'NEW1', supply_status: '' }), null);
    expect(v.patch.supplier_availability).toBe('green');
    expect(v.anomalies).toEqual([]);
  });
  test('mise a jour : passage a F signale, vide remet commandable sans anomalie', () => {
    const f = diffRow(row({ supply_status: 'F' }), existing({ supplier_availability: 'green' }));
    expect(f.action).toBe('update');
    expect(f.changes).toContainEqual({ field: 'supplier_availability', from: 'green', to: 'red' });
    expect(f.anomalies).toContain('Fin de série chez Ducati, sans remplaçant : plus commandable.');
    const v = diffRow(row({ supply_status: '' }), existing({ supplier_availability: 'yellow' }));
    expect(v.patch.supplier_availability).toBe('green');
    expect(v.anomalies.some((a) => a.includes('Ducati'))).toBe(false);
  });
  test('mise a jour : E sans remplacement donne le message generique', () => {
    const e = diffRow(row({ supply_status: 'E' }), existing());
    expect(e.patch.supplier_availability).toBe('yellow');
    expect(e.anomalies).toContain('Remplacée chez Ducati : commandez la nouvelle référence.');
  });
  test('etat deja connu : pas de changement, pas de nouvelle anomalie', () => {
    const r = diffRow(row({ supply_status: 'F' }), existing({ supplier_availability: 'red' }));
    expect(r.changes.find((c) => c.field === 'supplier_availability')).toBeUndefined();
    expect(r.anomalies).toEqual([]);
  });
  test('reference deja remplacee dans le DMS : seul l etat est rafraichi', () => {
    const r = diffRow(row({ supply_status: 'E', sale_price_ttc: 500 }), existing({ superseded_by_id: 'a2' }));
    expect(r.action).toBe('update');
    expect(r.changes).toEqual([{ field: 'supplier_availability', from: null, to: 'yellow' }]);
    expect(r.patch.sale_price_ttc).toBeUndefined();
  });
  test('tarif sans colonne Etat : la disponibilite ne bouge pas', () => {
    const r = diffRow(row({ supply_status: null, sale_price_ttc: 120 }), existing({ supplier_availability: 'red' }));
    expect(r.patch.supplier_availability).toBeUndefined();
  });
});

describe('garde-fous de commande fournisseur', () => {
  const art = (id: string, ref: string, avail: string | null, next: string | null = null): SupplyArticle =>
    ({ id, reference: ref, supplier_availability: avail, superseded_by_id: next });
  const map = (...xs: SupplyArticle[]) => new Map(xs.map((x) => [x.id, x]));

  test('fin de serie : refusee avec la raison', () => {
    const a = art('a', 'OLD1', 'red');
    const d = supplierOrderDecision(a, map(a));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe('discontinued');
      expect(d.message).toBe('OLD1 : fin de série chez Ducati, sans remplaçant : plus commandable.');
    }
  });
  test('remplacee : commandee sous la DERNIERE reference de la chaine', () => {
    const a = art('a', 'A', 'yellow', 'b');
    const b = art('b', 'B', 'yellow', 'c');
    const c = art('c', 'C', 'green');
    const d = supplierOrderDecision(a, map(a, b, c));
    expect(d).toEqual({ ok: true, articleId: 'c', reference: 'C', substitutedFrom: 'A' });
  });
  test('remplacee sans remplacant connu : refusee, jamais sous l ancien numero', () => {
    const a = art('a', 'A', 'yellow', 'b');
    const d1 = supplierOrderDecision(a, map(a));
    expect(d1.ok).toBe(false);
    if (!d1.ok) expect(d1.message).toBe('A : remplacée chez Ducati : commandez la nouvelle référence.');
    const b = art('b', 'B', 'red');
    const d2 = supplierOrderDecision(a, map(a, b));
    expect(d2.ok).toBe(false);
    if (!d2.ok) expect(d2.message).toBe('A : remplacée par B chez Ducati : commandez la nouvelle référence.');
  });
  test('boucle de remplacement : refusee', () => {
    const a = art('a', 'A', 'yellow', 'b');
    const b = art('b', 'B', 'yellow', 'a');
    expect(supplierOrderDecision(a, map(a, b)).ok).toBe(false);
  });
  test('commandable ou inconnu : accepte tel quel', () => {
    const a = art('a', 'A', 'green');
    const u = art('u', 'U', null, 'x');
    expect(supplierOrderDecision(a, map(a))).toEqual({ ok: true, articleId: 'a', reference: 'A' });
    expect(supplierOrderDecision(u, map(u))).toEqual({ ok: true, articleId: 'u', reference: 'U' });
  });
  test('panier : F retiree, E basculee sur la nouvelle reference, le reste intact', () => {
    const f = art('f', 'F1', 'red');
    const e = art('e', 'E1', 'yellow', 'n');
    const n = art('n', 'N1', 'green');
    const g = guardSupplierLinesPure(
      [{ article_id: 'f', qty: 1 }, { article_id: 'e', qty: 2 }, { article_id: 'n', qty: 3 }, { article_id: 'zz', qty: 1 }],
      map(f, e, n),
    );
    expect(g.lines).toEqual([{ article_id: 'n', qty: 2 }, { article_id: 'n', qty: 3 }, { article_id: 'zz', qty: 1 }]);
    expect(g.refused).toEqual(['F1 : fin de série chez Ducati, sans remplaçant : plus commandable.']);
    expect(g.substituted).toEqual(['E1 remplacée chez Ducati : commandée sous la nouvelle référence N1.']);
  });
});

describe('Shopify et pastille', () => {
  const base = { mode: 'tous' as const, in_trial: false, publishable: true, is_active: true, has_link: false, ttc: 10 };
  test('une piece en fin de serie ne se publie pas', () => {
    expect(canPublish({ ...base, discontinued: true })).toEqual({ ok: false, reason: 'discontinued' });
    expect(canPublish({ ...base, discontinued: false })).toEqual({ ok: true });
    expect(canPublish(base)).toEqual({ ok: true });
  });
  test('pastille : Remplacee (orange) / Fin de serie (rouge danger), rien sinon', () => {
    expect(supplyBadgeOf('yellow')).toMatchObject({ tone: 'warning', label: 'Remplacée' });
    expect(supplyBadgeOf('red')).toMatchObject({ tone: 'danger', label: 'Fin de série' });
    expect(supplyBadgeOf('green')).toBeNull();
    expect(supplyBadgeOf(null)).toBeNull();
  });
});
