/**
 * Tests d'intégration des tarifs officiels Ducati (PARTS / ACCESSORIES / APPAREL
 * _ListPrice_BE_FR.xlsx) — mapping auto des 12 colonnes, montants, remplacements,
 * traduction FR. CLAUDE.md règle 7. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { guessMapping, parseNum, buildRows, type ParsedCsv } from '../src/modules/articles/import/parse';
import { diffRow, buildDiff, applyPpcRules, type ExistingArticle, type ImportRow } from '../src/modules/articles/import/rules';
import { translateDesignation, translateRows } from '../src/modules/articles/import/translate';

// En-têtes EXACTS des tarifs Ducati 2026 (PARTS_ListPrice_09_BE_FR.xlsx)
const DUCATI_HEADERS = [
  'Matériel', 'Description matériel', 'État', 'Nombre colis', 'Classe de remise',
  'Hiérarchie des produits', 'Remplacement', 'Prix au détail', 'Devise',
  'Poids net', 'Unité de mesure', 'Code Intrastat',
];

test('mapping auto des colonnes du tarif Ducati', () => {
  const m = guessMapping(DUCATI_HEADERS);
  expect(m.reference).toBe(0);        // Matériel
  expect(m.designation).toBe(1);      // Description matériel
  expect(m.pack_qty).toBe(3);         // Nombre colis
  expect(m.category_path).toBe(5);    // Hiérarchie des produits
  expect(m.replacement_ref).toBe(6);  // Remplacement
  expect(m.ppc_ttc).toBe(7);          // Prix au détail → PPC
  expect(m.sale_price_ttc).toBeUndefined(); // pas de PV direct dans ce tarif
  expect(m.purchase_price).toBeUndefined();
});

test("mapping auto des colonnes de l'export G8 (inchangé)", () => {
  const m = guessMapping(['Référence', 'Désignation', 'Prix T.T.C.', 'P.P.C. T.T.C.', 'Fournisseur', 'Réf Fournisseur', 'Code TVA', 'Code barre', 'Casier', 'Remplacement', 'Rayon']);
  expect(m.reference).toBe(0);
  expect(m.designation).toBe(1);
  expect(m.sale_price_ttc).toBe(2);   // Prix T.T.C. (≠ P.P.C.)
  expect(m.ppc_ttc).toBe(3);          // P.P.C. T.T.C.
  expect(m.supplier_name).toBe(4);    // Fournisseur (nom)
  expect(m.supplier_ref).toBe(5);     // Réf Fournisseur
  expect(m.vat_rate).toBe(6);
  expect(m.barcode).toBe(7);
  expect(m.bin_location).toBe(8);
  expect(m.replacement_ref).toBe(9);
  expect(m.category_path).toBe(10);
});

test('parseNum : formats européens, €, %, insécables', () => {
  expect(parseNum('0,15')).toBe(0.15);
  expect(parseNum('49,11 €')).toBe(49.11);
  expect(parseNum('21,0 %')).toBe(21);
  expect(parseNum('1.234,56')).toBe(1234.56);
  expect(parseNum('')).toBeNull();
  expect(parseNum('EUR')).toBeNull();
});

test('buildRows : ligne Ducati complète (remplacement + PPC)', () => {
  const parsed: ParsedCsv = {
    headers: DUCATI_HEADERS,
    rows: [['000001199', 'JOINT TORIQUE 11.11X1.78', 'E', '10', 'C', 'R11', '88641161A', '0,15', 'EUR', '0,001', 'KG', '87141090']],
  };
  const rows = buildRows(parsed, guessMapping(DUCATI_HEADERS));
  expect(rows[0].reference).toBe('000001199');
  expect(rows[0].designation).toBe('JOINT TORIQUE 11.11X1.78');
  expect(rows[0].pack_qty).toBe(10);
  expect(rows[0].category_path).toBe('R11');
  expect(rows[0].replacement_ref).toBe('88641161A');
  expect(rows[0].ppc_ttc).toBe(0.15);
});

const existing = (over: Partial<ExistingArticle> = {}): ExistingArticle => ({
  id: 'a1', reference: '000001199', designation: 'JOINT', brand: null, category_path: null,
  supplier_ref: null, purchase_price: 0, sale_price_ttc: 0.1, coefficient: null,
  superseded_by_id: null, is_library: false, ...over,
});

test('remplacement : article existant → patch _replace_with_ref + anomalie explicative', () => {
  const row: ImportRow = { reference: '000001199', replacement_ref: '88641161A', rowIndex: 2 };
  const r = diffRow(row, existing());
  expect(r.action).toBe('update');
  expect(r.patch._replace_with_ref).toBe('88641161A');
  expect(r.anomalies.some((a) => a.includes('88641161A'))).toBe(true);
});

test('remplacement : pas de re-marquage si superseded déjà posé', () => {
  const row: ImportRow = { reference: '000001199', replacement_ref: '88641161A', rowIndex: 2 };
  const r = diffRow(row, existing({ superseded_by_id: 'a2' }));
  expect(r.patch._replace_with_ref).toBeUndefined();
});

test('remplacement : nouvelle référence créée porte aussi le lien', () => {
  const row: ImportRow = { reference: 'OLD1', replacement_ref: 'NEW1', rowIndex: 2 };
  const r = diffRow(row, null);
  expect(r.action).toBe('create');
  expect(r.patch._replace_with_ref).toBe('NEW1');
});

test('PPC + règle % : PV = PPC × (1 + pct/100), arrondi 2 déc.', () => {
  const rows: ImportRow[] = [
    { reference: 'A', ppc_ttc: 106.3, category_path: 'R11', rowIndex: 2 },
    { reference: 'B', ppc_ttc: 100, category_path: 'R13', rowIndex: 3 },
  ];
  const n = applyPpcRules(rows, [
    { supplier_name: null, category_path: 'R11', brand: null, pct: -6 },
    { supplier_name: null, category_path: null, brand: null, pct: 0 },
  ]);
  expect(n).toBe(2);
  expect(rows[0].sale_price_ttc).toBe(99.92); // 106,30 × 0,94
  expect(rows[1].sale_price_ttc).toBe(100);   // règle générique 0 %
});

test('plancher de prix : PV sous le seuil remonté au minimum', () => {
  const row: ImportRow = { reference: 'NEW2', sale_price_ttc: 0.15, rowIndex: 2 };
  const r = diffRow(row, null, { floorThreshold: 1, floorMin: 2 });
  expect(r.patch.sale_price_ttc).toBe(2);
});

test('traduction FR : apparel italien → français, inconnus conservés', () => {
  expect(translateDesignation('CAPPELLINO NERO CHILI')).toBe('CASQUETTE NOIR CHILI');
  expect(translateDesignation('FELPA CON CAPPUCCIO UOMO')).toBe('SWEAT À CAPUCHE HOMME');
  expect(translateDesignation('T-SHIRT MANICHE LUNGHE DONNA')).toBe('T-SHIRT MANCHES LONGUES FEMME');
  // FR déjà correct → inchangé
  expect(translateDesignation('JOINT TORIQUE 11.11X1.78')).toBe('JOINT TORIQUE 11.11X1.78');
});

test('translateRows : compte les lignes réellement modifiées', () => {
  const rows = [
    { designation: 'CAPPELLINO ROSSO' },
    { designation: 'JOINT TORIQUE' },
    { designation: null },
  ];
  expect(translateRows(rows)).toBe(1);
  expect(rows[0].designation).toBe('CASQUETTE ROUGE');
});

test('diff complet Ducati : création en librairie avec PPC, pack et hiérarchie', () => {
  const rows = buildRows(
    { headers: DUCATI_HEADERS, rows: [['96981391AA', 'KIT CARTER', 'E', '1', 'C', 'R11', '', '250,00', 'EUR', '1,2', 'KG', '']] },
    guessMapping(DUCATI_HEADERS),
  );
  const d = buildDiff(rows, new Map());
  expect(d[0].action).toBe('create');
  expect(d[0].patch.ppc_ttc).toBe(250);
  expect(d[0].patch.pack_qty).toBe(1);
  expect(d[0].patch.category_path).toBe('R11');
  expect(d[0].patch.is_library).toBe(true);
});
