/**
 * Tests M4 — Panier de commande Ducati (mission 09, cartes 1, 2 et 4) :
 *  - minimax : quantité à commander, exclusion de ce qui est déjà en commande ;
 *  - « Enlever ce qui est déjà en stock » ;
 *  - validation : minimum 250 € HTVA (standard), urgente une par jour et sans minimum ;
 *  - urgente : +12 % sur le prix de vente des lignes commandées pour un client (M-78) ;
 *  - fichier ExportDucati.xls (Excel 97 / BIFF8) relu avec SheetJS et vérifié cellule par cellule ;
 *  - numéro DCS saisi après coup (M-79).
 * Même logique que les fonctions SQL basket_check / basket_fill_minimax / basket_remove_in_stock
 * (vérifiées en base le 03/11/2026 dans une transaction annulée). Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import * as XLSX from 'xlsx';
import {
  minimaxQty, belowMinimum, removeInStock, checkBasket, basketSurchargePct, clientSalePriceHt, canSetDcsNumber, canEditLines,
  exportRows, exportGrid, exportFileName, exportClientName, basketTotals, lineAmountHt, filterBaskets, countBaskets,
  EXPORT_HEADERS, EXPORT_FIRST_ROW, type BasketLine, type SupplierBasket,
} from '../src/modules/purchases/basket';
import { buildExportBytes, buildExportWorkbook, EXPORT_SHEET_NAME } from '../src/modules/purchases/basket-xls';
import type { OrderRule } from '../src/modules/orders/thresholds';

const base = { isActive: true, configured: true, minHt: null, surchargePct: 0, maxPerDay: null, fallback: null, minHtPerTab: null };
// Réglage de Paramètres → Tables → Règles des types de commande après la migration du 03/11 (urgente +12 %)
const RULES: OrderRule[] = [
  { ...base, code: 'standard', label: 'Commande standard', sortOrder: 1, minHt: 250 },
  { ...base, code: 'urgente', label: 'Commande urgente', sortOrder: 2, minHt: 0, surchargePct: 12, maxPerDay: 1 },
  { ...base, code: 'accident', label: 'Commande accident', sortOrder: 3, minHt: 1500, fallback: 'standard' },
  { ...base, code: 'excel', label: 'Commande Excel', sortOrder: 4, minHtPerTab: 2000 },
];

const line = (p: Partial<BasketLine> = {}): BasketLine => ({
  id: 'l1', articleId: 'a1', reference: '79110931A', designation: 'Filtre a huile', qty: 2, origin: 'manuel', originRef: null,
  originLineId: null, contactId: null, contactLabel: null, purchasePrice: 10, salePriceHt: 20, inStockQty: 0, realQtyNow: 0, sortOrder: 0,
  ...p,
});

describe('minimax (carte 1)', () => {
  test('quantité = greatest(max, min) − stock réel − déjà en commande', () => {
    expect(minimaxQty({ stockMin: 2, stockMax: 10, realQty: 1, onOrderQty: 0 })).toBe(9);
    expect(minimaxQty({ stockMin: 2, stockMax: 0, realQty: 1, onOrderQty: 0 })).toBe(1);   // pas de maxi : on remonte au mini
    expect(minimaxQty({ stockMin: 5, stockMax: 3, realQty: 0, onOrderQty: 0 })).toBe(5);   // maxi < mini : le mini gagne
  });
  test('ce qui est déjà en commande (CMD, commandes de pièces, autres paniers) est déduit', () => {
    expect(minimaxQty({ stockMin: 2, stockMax: 10, realQty: 1, onOrderQty: 4 })).toBe(5);
    expect(minimaxQty({ stockMin: 2, stockMax: 10, realQty: 1, onOrderQty: 9 })).toBe(0);
    expect(minimaxQty({ stockMin: 2, stockMax: 10, realQty: 1, onOrderQty: 20 })).toBe(0); // jamais négatif
  });
  test('seules les pièces stockées (A) avec un minimum > 0 et un stock réel sous ce minimum entrent', () => {
    expect(belowMinimum({ mgmtType: 'A', stockMin: 2, realQty: 1 })).toBe(true);
    expect(belowMinimum({ mgmtType: 'A', stockMin: 2, realQty: 2 })).toBe(false);
    expect(belowMinimum({ mgmtType: 'A', stockMin: 0, realQty: -3 })).toBe(false);
    expect(belowMinimum({ mgmtType: 'M', stockMin: 2, realQty: 0 })).toBe(false);
  });
});

describe('« Enlever ce qui est déjà en stock »', () => {
  test('retire les lignes dont le stock réel couvre la quantité, garde les autres', () => {
    const covered = line({ id: 'c', qty: 2, realQtyNow: 2 });
    const over = line({ id: 'o', qty: 1, realQtyNow: 5 });
    const missing = line({ id: 'm', qty: 3, realQtyNow: 2 });
    const none = line({ id: 'n', qty: 1, realQtyNow: 0 });
    const r = removeInStock([covered, over, missing, none]);
    expect(r.removed.map((l) => l.id)).toEqual(['c', 'o']);
    expect(r.kept.map((l) => l.id)).toEqual(['m', 'n']);
  });
});

describe('règles à la validation', () => {
  test('standard : minimum 250 € HTVA, message avec le total', () => {
    const ko = checkBasket({ kind: 'standard', totalHt: 249.99, lineCount: 3 }, RULES);
    expect(ko.ok).toBe(false);
    expect(ko.errors).toEqual([{ code: 'below_min', min: 250, total: 249.99 }]);
    const ok = checkBasket({ kind: 'standard', totalHt: 250, lineCount: 3 }, RULES);
    expect(ok.ok).toBe(true);
    expect(ok.minHt).toBe(250);
    expect(ok.surchargePct).toBe(0);
  });
  test('panier vide : refusé', () => {
    expect(checkBasket({ kind: 'standard', totalHt: 1000, lineCount: 0 }, RULES).errors.map((e) => e.code)).toEqual(['no_lines']);
  });
  test('urgente : pas de minimum, mais UNE par jour', () => {
    const first = checkBasket({ kind: 'urgente', totalHt: 12.5, lineCount: 1, orderedToday: 0 }, RULES);
    expect(first.ok).toBe(true);
    expect(first.minHt).toBe(0);
    const second = checkBasket({ kind: 'urgente', totalHt: 900, lineCount: 1, orderedToday: 1 }, RULES);
    expect(second.ok).toBe(false);
    expect(second.errors).toEqual([{ code: 'daily_limit', max: 1 }]);
  });
  test('réglage modifié dans Paramètres suivi (minimum 300, deux urgentes par jour)', () => {
    const rules = RULES.map((r) => (r.code === 'standard' ? { ...r, minHt: 300 } : r.code === 'urgente' ? { ...r, maxPerDay: 2 } : r));
    expect(checkBasket({ kind: 'standard', totalHt: 260, lineCount: 1 }, rules).ok).toBe(false);
    expect(checkBasket({ kind: 'urgente', totalHt: 1, lineCount: 1, orderedToday: 1 }, rules).ok).toBe(true);
  });
  test('codes de règle en majuscules (écran Paramètres) : reconnus quand même', () => {
    const upper = RULES.map((r) => ({ ...r, code: r.code.toUpperCase() }));
    expect(checkBasket({ kind: 'standard', totalHt: 100, lineCount: 1 }, upper).errors[0]?.code).toBe('below_min');
  });
  test('démo : la règle « excel » sert (pas de minimum par panier, le classeur a le sien)', () => {
    expect(checkBasket({ kind: 'demo', totalHt: 10, lineCount: 1 }, RULES).ok).toBe(true);
  });
  test('lignes sans prix d achat : avis, pas blocage', () => {
    const r = checkBasket({ kind: 'standard', totalHt: 300, lineCount: 2, noPa: 1 }, RULES);
    expect(r.ok).toBe(true);
    expect(r.notices).toEqual([{ code: 'no_pa', count: 1 }]);
  });
});

describe('urgente : +12 % (M-78)', () => {
  test('supplément lu dans Paramètres : urgente 12 %, standard 0 %', () => {
    expect(basketSurchargePct('urgente', RULES)).toBe(12);
    expect(basketSurchargePct('standard', RULES)).toBe(0);
  });
  test('appliqué au prix de vente des lignes commandées POUR UN CLIENT, jamais au prix d achat', () => {
    const forClient = line({ contactId: 'c1', contactLabel: 'DUPONT JEAN', salePriceHt: 100, purchasePrice: 60 });
    const forStock = line({ contactId: null, salePriceHt: 100, purchasePrice: 60 });
    expect(clientSalePriceHt(forClient, 12)).toBe(112);
    expect(clientSalePriceHt(forStock, 12)).toBe(100);
    expect(clientSalePriceHt(forClient, 0)).toBe(100);
    expect(lineAmountHt(forClient)).toBe(120); // total du panier au PA, inchangé
  });
});

describe('totaux du panier', () => {
  test('au prix d achat, sinon au prix de vente (signalé)', () => {
    const t = basketTotals([line({ qty: 2, purchasePrice: 10 }), line({ id: 'x', qty: 1, purchasePrice: null, salePriceHt: 50, contactId: 'c' })]);
    expect(t.totalHt).toBe(70);
    expect(t.lineCount).toBe(2);
    expect(t.qty).toBe(3);
    expect(t.noPa).toBe(1);
    expect(t.forClients).toBe(1);
  });
});

describe('fichier ExportDucati.xls (carte 2)', () => {
  const lines = [
    { reference: '79110931A', qty: 2, contactLabel: 'DUPONT JEAN' },
    { reference: '67090871A', qty: 1, contactLabel: null },
    { reference: '79110931A', qty: 3, contactLabel: 'VAN DAMME LUC' },
  ];
  const date = new Date(2026, 10, 3); // 3 novembre 2026

  test('lignes : numéro 1..n, référence, jour / mois / année en nombres, quantité, client en majuscules', () => {
    const rows = exportRows(lines, date);
    expect(rows.map((r) => r.lineNumber)).toEqual([1, 2, 3]);
    expect(rows[0]).toEqual({ lineNumber: 1, productCode: '79110931A', day: 3, month: 11, year: 2026, quantity: 2, client: 'DUPONT JEAN' });
    expect(rows[1].client).toBeNull();
  });
  test('grille : en-têtes en ligne 1, lignes 2 et 3 vides, données dès la ligne 4', () => {
    const grid = exportGrid(exportRows(lines, date));
    expect(grid[0]).toEqual([...EXPORT_HEADERS]);
    expect(grid[1]).toEqual([]);
    expect(grid[2]).toEqual([]);
    expect(EXPORT_FIRST_ROW).toBe(4);
    expect(grid[3]).toEqual([1, '79110931A', 3, 11, 2026, 2, 'DUPONT JEAN']);
    expect(grid[4]).toEqual([2, '67090871A', 3, 11, 2026, 1]);
  });
  test('nom du fichier : ExportDucati.xls (standard) / ExportDucati_URGENTE.xls (urgente)', () => {
    expect(exportFileName('standard')).toBe('ExportDucati.xls');
    expect(exportFileName('urgente')).toBe('ExportDucati_URGENTE.xls');
  });
  test('colonne G : NOM PRENOM en majuscules, société sinon, vide pour le stock', () => {
    expect(exportClientName({ lastName: 'Dupont', firstName: 'Jean' })).toBe('DUPONT JEAN');
    expect(exportClientName({ lastName: null, firstName: null, companyName: 'Moto Shop sprl' })).toBe('MOTO SHOP SPRL');
    expect(exportClientName(null)).toBeNull();
  });
  test('le fichier est un vrai .xls Excel 97 (BIFF8, conteneur OLE) relu cellule par cellule', () => {
    const bytes = buildExportBytes(lines, date);
    // Signature du conteneur OLE2 (Excel 97-2003), pas un zip (.xlsx)
    expect([...bytes.slice(0, 8)]).toEqual([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual([EXPORT_SHEET_NAME]);
    const ws = wb.Sheets[EXPORT_SHEET_NAME];
    const v = (addr: string) => ws[addr]?.v;
    // Ligne 1 : en-têtes A-F, rien en G
    expect(['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].map(v)).toEqual(['Line Number', 'Product Code', 'Day', 'Month', 'Year', 'Quantity']);
    expect(v('G1')).toBeUndefined();
    // Lignes 2 et 3 vides
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) { expect(v(`${col}2`)).toBeUndefined(); expect(v(`${col}3`)).toBeUndefined(); }
    // Ligne 4 : première pièce, pour un client
    expect(v('A4')).toBe(1); expect(ws.A4.t).toBe('n');
    expect(v('B4')).toBe('79110931A'); expect(ws.B4.t).toBe('s');
    expect(v('C4')).toBe(3); expect(v('D4')).toBe(11); expect(v('E4')).toBe(2026);
    expect(ws.E4.t).toBe('n');
    expect(v('F4')).toBe(2);
    expect(v('G4')).toBe('DUPONT JEAN');
    // Ligne 5 : pour le stock, colonne G vide
    expect(v('A5')).toBe(2); expect(v('B5')).toBe('67090871A'); expect(v('F5')).toBe(1); expect(v('G5')).toBeUndefined();
    // Ligne 6 : même référence, autre client
    expect(v('A6')).toBe(3); expect(v('B6')).toBe('79110931A'); expect(v('F6')).toBe(3); expect(v('G6')).toBe('VAN DAMME LUC');
    expect(v('A7')).toBeUndefined();
    expect(ws['!ref']).toBe('A1:G6');
  });
  test('classeur sans ligne : en-têtes seulement', () => {
    const wb = buildExportWorkbook([], date);
    expect(wb.Sheets[EXPORT_SHEET_NAME]['!ref']).toBe('A1:F1');
  });
});

describe('numéro DCS et statuts (M-79)', () => {
  test('le numéro DCS se saisit après la validation seulement', () => {
    expect(canSetDcsNumber('ouvert')).toBe(false);
    expect(canSetDcsNumber('commande')).toBe(true);
    expect(canSetDcsNumber('recu')).toBe(true);
    expect(canSetDcsNumber('annule')).toBe(false);
  });
  test('les lignes ne se modifient que sur un panier ouvert', () => {
    expect(canEditLines('ouvert')).toBe(true);
    expect(canEditLines('commande')).toBe(false);
  });
});

describe('« Toutes nos commandes » : filtres et totaux', () => {
  const b = (p: Partial<SupplierBasket>): SupplierBasket => ({
    id: 'b', company_id: 'c', kind: 'standard', label: 'x', status: 'ouvert', dcs_order_number: null, ordered_at: null, ordered_by: null,
    received_at: null, cancelled_at: null, file_path: null, file_attachment_id: null, total_ht: 0, surcharge_pct: 0, notes: null,
    created_by: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', ...p,
  });
  const rows = [
    b({ id: '1', status: 'ouvert', total_ht: 100 }),
    b({ id: '2', status: 'commande', kind: 'urgente', ordered_at: '2026-11-03T09:00:00Z', total_ht: 80 }),
    b({ id: '3', status: 'recu', ordered_at: '2026-10-20T09:00:00Z', total_ht: 300 }),
    b({ id: '4', status: 'annule', total_ht: 50 }),
  ];
  test('par statut, type et période (date de commande, sinon de création)', () => {
    expect(filterBaskets(rows, { status: 'commande' }).map((r) => r.id)).toEqual(['2']);
    expect(filterBaskets(rows, { kind: 'urgente' }).map((r) => r.id)).toEqual(['2']);
    expect(filterBaskets(rows, { from: '2026-11-01', to: '2026-11-30' }).map((r) => r.id)).toEqual(['1', '2', '4']);
    expect(filterBaskets(rows, { status: 'all', kind: 'all' }).length).toBe(4);
  });
  test('compteurs et total des paniers commandés ou reçus (pas les ouverts ni les annulés)', () => {
    const c = countBaskets(rows);
    expect(c.byStatus).toEqual({ ouvert: 1, commande: 1, recu: 1, annule: 1 });
    expect(c.byKind).toEqual({ standard: 3, urgente: 1 });
    expect(c.totalHt).toBe(380);
  });
});
