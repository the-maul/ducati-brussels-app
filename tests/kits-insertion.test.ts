/**
 * Rattrapage G8 (18/11/2026, lot parc) — kits : insertion en lignes (OR / vente), remplacement
 * d'une reference dans tous les kits, devis de reparation et duplication d'un OR.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { kitInsertLines, insertLinesTotalHt, toRoLine, toSaleLine, replacementPreview, type PricedArticle } from '../src/modules/workshop/kits/insert-rules';
import { roLinesToQuoteLines, duplicateRoLines, type RoRowLike } from '../src/modules/workshop/or-copy-rules';

const arts = new Map<string, PricedArticle>([
  ['oil', { id: 'oil', reference: 'MOTUL', designation: 'Huile 4T', mgmt_type: 'A', sale_price_ht: null, sale_price_ttc: 24.2, vat_rate: 21 }],
  ['filter', { id: 'filter', reference: '44440312B', designation: 'Filtre a huile', mgmt_type: 'A', sale_price_ht: 15, sale_price_ttc: null, vat_rate: 21 }],
  ['mo', { id: 'mo', reference: 'MO_ATELIER', designation: 'Main-d oeuvre', mgmt_type: 'T', sale_price_ht: 63.47, vat_rate: 21 }],
  ['forfait', { id: 'forfait', reference: 'OIL1199', designation: 'OIL SERVICE 1199', mgmt_type: 'N', sale_price_ttc: 120.31, vat_rate: 21 }],
]);
const comps = [
  { articleId: 'oil', reference: 'MOTUL', designation: 'Huile', quantity: 3.4 },
  { articleId: 'filter', reference: '44440312B', designation: 'Filtre', quantity: 1 },
  { articleId: 'mo', reference: 'MO_ATELIER', designation: 'MO', quantity: 1.5 },
  { articleId: null, reference: null, designation: 'Joint de vidange (a confirmer)', quantity: 1 },
];

describe('kit en detail', () => {
  const lines = kitInsertLines({ title: 'Kit : Oil Service', components: comps, articles: arts });
  test('titre, une ligne par piece au prix de la piece, MO en main-d oeuvre, besoin sans article en texte', () => {
    expect(lines.map((l) => l.type)).toEqual(['texte', 'piece', 'piece', 'mo', 'texte']);
    expect(lines[1]).toMatchObject({ article_id: 'oil', quantity: 3.4, unit_price_ht: 20, vat_rate: 21 });
    expect(lines[2]).toMatchObject({ article_id: 'filter', unit_price_ht: 15 });
    expect(lines[3]).toMatchObject({ article_id: 'mo', quantity: 1.5, unit_price_ht: 63.47 });
    expect(lines[4]).toMatchObject({ article_id: null, quantity: 0, designation: 'Joint de vidange (a confirmer) x 1' });
  });
  test('total HT = somme des pieces et de la MO', () => {
    expect(insertLinesTotalHt(lines)).toBe(Math.round((3.4 * 20 + 15 + 1.5 * 63.47) * 100) / 100);
  });
  test('quantite du kit x 2 et arrondi catalogue applique', () => {
    const l2 = kitInsertLines({ title: '', components: comps.slice(0, 2), articles: arts, times: 2, effectiveHt: (ht) => Math.ceil(ht) });
    expect(l2.map((l) => [l.quantity, l.unit_price_ht])).toEqual([[6.8, 20], [2, 15]]);
  });
});

describe('forfait a son prix (G8 « prix forfait TTC »)', () => {
  test('une ligne au prix du forfait puis le contenu en texte', () => {
    const lines = kitInsertLines({ title: 'x', components: comps.slice(0, 2), articles: arts, mode: 'forfait', forfait: arts.get('forfait') });
    expect(lines[0]).toMatchObject({ type: 'piece', article_id: 'forfait', unit_price_ht: 99.43, quantity: 1 });
    expect(lines.slice(1).every((l) => l.type === 'texte' && l.quantity === 0)).toBe(true);
    expect(lines[1].designation).toBe('- MOTUL Huile x 3,4');
  });
});

describe('conversion en lignes', () => {
  const [title, oil, , mo] = kitInsertLines({ title: 'Kit', components: comps, articles: arts });
  test('OR', () => {
    expect(toRoLine(title)).toMatchObject({ kind: 'texte', quantity: 0, unit_price_ht: 0 });
    expect(toRoLine(oil)).toMatchObject({ kind: 'piece', article_id: 'oil', quantity: 3.4, is_warranty: false });
    expect(toRoLine(mo).kind).toBe('mo');
  });
  test('document de vente', () => {
    expect(toSaleLine(title).line_type).toBe('texte');
    expect(toSaleLine(oil)).toMatchObject({ line_type: 'article', reference: 'MOTUL' });
    expect(toSaleLine(mo).line_type).toBe('main_oeuvre');
  });
});

describe('remplacer une reference dans tous les kits', () => {
  const kits = [
    { kitId: 'k1', items: [{ articleId: 'old', quantity: 1 }, { articleId: 'x', quantity: 2 }] },
    { kitId: 'k2', items: [{ articleId: 'old', quantity: 1 }, { articleId: 'new', quantity: 2 }] },
    { kitId: 'k3', items: [{ articleId: 'x', quantity: 1 }] },
  ];
  test('kits touches ; fusion quand la nouvelle piece y est deja', () => {
    expect(replacementPreview(kits, 'old', 'new')).toEqual([
      { kitId: 'k1', merged: false, quantity: 1 },
      { kitId: 'k2', merged: true, quantity: 3 },
    ]);
  });
  test('meme reference : rien', () => {
    expect(replacementPreview(kits, 'old', 'old')).toEqual([]);
  });
  test('la fonction SQL fusionne aussi et fait une nouvelle version des kits d\'entretien', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261118143000_m8_kits_remplacer_reference.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/update public\.maintenance_kit_items set quantity = quantity \+ r\.quantity where id = keep/);
    expect(sql).toMatch(/update public\.article_kit_items set quantity = quantity \+ r\.quantity where id = keep/);
    expect(sql).toMatch(/_maintenance_kit_snapshot/);
    expect(sql).toMatch(/k\.status = 'actif'/);
  });
});

const ro = (o: Partial<RoRowLike>): RoRowLike => ({
  kind: 'piece', article_id: 'a', designation: 'Piece', quantity: 1, unit_price_ht: 10, vat_rate: 21, discount_pct: 0, is_warranty: false, ...o,
});

describe('devis de reparation depuis l\'OR', () => {
  test('recopie pieces, MO et textes ; garantie a 0 ; actions OK / reportees exclues', () => {
    const q = roLinesToQuoteLines([
      ro({}), ro({ kind: 'mo', article_id: 'mo', quantity: '1.5', unit_price_ht: '63.47' }), ro({ kind: 'texte', article_id: null, designation: 'Note', quantity: 0 }),
      ro({ is_warranty: true }), ro({ checkup_state: 'ok' }), ro({ checkup_state: 'reporte' }),
    ]);
    expect(q.map((l) => l.line_type)).toEqual(['article', 'main_oeuvre', 'texte', 'article']);
    expect(q[1]).toMatchObject({ quantity: 1.5, unit_price_ht: 63.47 });
    expect(q[2]).toMatchObject({ quantity: 0, unit_price_ht: 0, article_id: null });
    expect(q[3].unit_price_ht).toBe(0);
  });
  test('carte du check-up sans heures : texte', () => {
    expect(roLinesToQuoteLines([ro({ kind: 'mo', quantity: 0, checkup_state: 'a_faire' })])[0].line_type).toBe('texte');
  });
});

describe('dupliquer un OR', () => {
  test('memes lignes, sans garantie ni etat de check-up', () => {
    const d = duplicateRoLines([ro({ is_warranty: true, checkup_state: 'a_faire' }), ro({ checkup_state: 'reporte' }), ro({ kind: 'mo', quantity: 2 })]);
    expect(d.length).toBe(2);
    expect(d[0]).toEqual({ kind: 'piece', article_id: 'a', designation: 'Piece', quantity: 1, unit_price_ht: 10, vat_rate: 21, discount_pct: 0, is_warranty: false });
    expect(d[1].kind).toBe('mo');
    expect(Object.keys(d[0])).not.toContain('checkup_state');
  });
});
