/**
 * M13 — Statistiques façon G8 (rattrapage G8 du 18/11/2026) : règles de calcul.
 *
 *  1. Chiffres justes (bloquant n° 8) : avoirs déduits, brouillons exclus, tickets comptés, facture
 *     d'acompte hors ventes, quantités signées — vérifiés sur le texte des migrations (les fonctions
 *     SQL elles-mêmes sont essayées à blanc : supabase/tests/m13_statistiques_g8.sql).
 *  2. Logique d'écran (stats-core.ts) : périodes prédéfinies, N-1, arbre 4 niveaux + article,
 *     pourcentages G8, libellés des familles, export, mois par mois, fiche article.
 * Exécution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  articleYear, articleYears, buildTree, derived, effectiveLevels, exportFileName, exportTreeRows, flattenTree, keyLabel,
  parseMonthly, parseStatsRows, presetRange, previousYearRange, sumMonths, totals, type StatsRow,
} from '../src/modules/reports/stats-core';
import { cleanFilters } from '../src/modules/reports/stats-filters';

const MIG = join(import.meta.dir, '..', 'supabase', 'migrations');
const fixes = readFileSync(join(MIG, '20261118180000_m13_chiffres_justes.sql'), 'utf8');
const module = readFileSync(join(MIG, '20261118181000_m13_statistiques_g8.sql'), 'utf8');

/** Corps d'une fonction SQL (du `create ... function public.<nom>(` jusqu'au `$$;` qui la ferme). */
function fnBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`));
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', sql.indexOf('$$', start) + 2);
  return sql.slice(start, end);
}

describe('chiffres justes : une seule règle de vente', () => {
  const isSale = fnBody(fixes, '_stats_is_sale');

  test('FAC, TIK et AVO comptent ; brouillon et annulé exclus', () => {
    expect(isSale).toContain("when _type = 'AVO' then _status not in ('brouillon', 'annulee')");
    expect(isSale).toContain("when _type in ('FAC', 'TIK') then");
  });
  test("la facture d'acompte (FAA) n'est pas une vente", () => {
    expect(isSale).toContain('else false');
    expect(isSale).not.toContain("'FAA'");
  });
  test('une facture encore « annulee » avec un avoir valide reste comptée (sinon double déduction)', () => {
    expect(isSale).toContain("av.doc_type = 'AVO'");
  });

  for (const fn of ['dashboard_kpis', 'monthly_revenue', 'report_indicators']) {
    test(`${fn} passe par _stats_is_sale (plus de « status <> 'annulee' » ni de FAC seules)`, () => {
      const body = fnBody(fixes, fn);
      expect(body).toContain('_stats_is_sale(');
      expect(body).not.toContain("status <> 'annulee'");
    });
  }
  for (const fn of ['top_articles', 'report_sales_by', 'report_period_compare']) {
    test(`${fn} lit les faits statistiques (avoirs, tickets, remise répartie)`, () => {
      expect(fnBody(fixes, fn)).toContain("_stats_facts(_company, 'sales'");
    });
  }
  test('le tableau de bord compte factures ET tickets', () => {
    expect(fnBody(fixes, 'dashboard_kpis')).toContain("doc_type in ('FAC', 'TIK')");
  });
  test('quantités signées : plus aucune valeur absolue dans les faits', () => {
    expect(fnBody(fixes, '_stats_facts')).not.toContain('abs(');
  });
  test('remise globale répartie et port à part', () => {
    const facts = fnBody(fixes, '_stats_facts');
    expect(facts).toContain('(d.total_ht - d.shipping_ht) / d.lines_ht');
    expect(facts).toContain("'shipping'");
  });
  test('coût figé sur la ligne (B5), PAMP courant en repli', () => {
    expect(fixes).toContain('add column if not exists unit_cost');
    expect(fnBody(fixes, '_stats_facts')).toContain('coalesce(l.unit_cost, a.pamp, 0)');
  });
  test("aucun rapport n'accepte plus un appel sans connexion", () => {
    expect(fixes + module).not.toContain('auth.uid() is null or public.is_member');
  });
  test('accès aux statistiques = grille signée (pas le mécanicien)', () => {
    const can = fnBody(fixes, '_stats_can_read');
    expect(can).toContain("'admin', 'comptable', 'vendeur', 'magasinier', 'chef_atelier', 'marketing'");
    expect(can).not.toContain('mecanicien');
  });
  test('les fonctions du module renvoient du JSON (pas de troncature à 1 000 lignes)', () => {
    for (const fn of ['stats_query', 'stats_monthly', 'stats_indicators', 'stats_open_documents', 'article_stats']) {
      expect(fnBody(module, fn)).toContain('returns jsonb');
    }
  });
});

describe('périodes prédéfinies', () => {
  const today = new Date(2026, 10, 18); // mercredi 18/11/2026
  test('jour, hier, semaine du lundi au dimanche', () => {
    expect(presetRange('today', today)).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-11-17', to: '2026-11-17' });
    expect(presetRange('thisWeek', today)).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(presetRange('lastWeek', today)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  });
  test('mois, trimestre, année', () => {
    expect(presetRange('thisMonth', today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('thisQuarter', today)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(presetRange('lastQuarter', today)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(presetRange('thisYear', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(presetRange('lastYear', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(presetRange('last12Months', today)).toEqual({ from: '2025-12-01', to: '2026-11-18' });
    expect(presetRange('last30Days', today)).toEqual({ from: '2026-10-20', to: '2026-11-18' });
  });
  test("trimestre précédent en janvier = octobre-décembre de l'année d'avant", () => {
    expect(presetRange('lastQuarter', new Date(2026, 0, 10))).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });
  test('exercice N-1 : même période, 29 février ramené au 28', () => {
    expect(previousYearRange('2026-01-01', '2026-11-18')).toEqual({ from: '2025-01-01', to: '2025-11-18' });
    expect(previousYearRange('2028-02-01', '2028-02-29')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });
});

describe('classement sur 4 niveaux + article', () => {
  test('niveaux : sans doublon, 4 au plus, article en dernier niveau', () => {
    expect(effectiveLevels(['brand', '', 'brand', 'client'], false)).toEqual(['brand', 'client']);
    expect(effectiveLevels(['supplier', 'brand', 'rayon', 'sousrayon', 'categorie'], true)).toEqual(['supplier', 'brand', 'rayon', 'sousrayon', 'article']);
    expect(effectiveLevels(['client'], false, 'purchases')).toEqual([]); // pas de client sur les achats
    expect(effectiveLevels(['cession'], true, 'cessions')).toEqual(['cession', 'article']);
  });

  const row = (keys: string[], ca: number, cost: number, extra: Partial<StatsRow> = {}): StatsRow => ({
    keys, labels: keys.map((k) => `L-${k}`), qty: 1, gross_ht: ca + 10, ca_ht: ca, cost, docs: 1, credit_notes: 0,
    qty_n1: 0, ca_ht_n1: 0, cost_n1: 0, stock: null, available: null, on_order: null, ...extra,
  });
  const rows = [
    row(['DUCATI', 'a1'], 100, 60, { stock: 5, available: 4, on_order: 2 }),
    row(['DUCATI', 'a2'], 300, 100),
    row(['', 'a3'], 50, 50),
    row(['AGV', 'a4'], 200, 150, { ca_ht_n1: 100, cost_n1: 80 }),
  ];
  const tree = buildTree(rows, ['brand', 'article']);

  test('sous-totaux additionnés, tri par CA décroissant', () => {
    expect(tree.map((n) => n.key)).toEqual(['DUCATI', 'AGV', '']);
    expect(tree[0].m.ca).toBe(400);
    expect(tree[0].m.cost).toBe(160);
    expect(tree[0].children.map((c) => c.key)).toEqual(['a2', 'a1']);
  });
  test('stock seulement sur la ligne article, documents seulement au niveau le plus fin', () => {
    const a1 = tree[0].children.find((c) => c.key === 'a1')!;
    expect(a1.m.stock).toBe(5);
    expect(a1.m.onOrder).toBe(2);
    expect(tree[0].m.stock).toBeNull();
    expect(tree[0].m.docs).toBeNull();
    expect(a1.m.docs).toBe(1);
  });
  test('% poids CA, marge, % marge, remise, évolution N-1', () => {
    const tot = totals(rows);
    expect(tot.ca).toBe(650);
    const d = derived(tree[0].m, tot);
    expect(d.margin).toBe(240);
    expect(d.marginPct).toBe(60);
    expect(d.weightCa).toBe(61.5);
    expect(d.discount).toBe(20);
    const agv = derived(tree[1].m, tot);
    expect(agv.evolutionCa).toBe(100);
    expect(agv.marginN1).toBe(20);
    expect(derived(tree[2].m, tot).evolutionCa).toBeNull();
  });
  test('un avoir (CA négatif) diminue le sous-total', () => {
    const t2 = buildTree([row(['X', 'a'], 100, 40), row(['X', 'a'], -45, -20)], ['brand', 'article']);
    expect(t2[0].m.ca).toBe(55);
    expect(t2[0].children[0].m.cost).toBe(20);
  });
  test('axe chronologique trié par date', () => {
    const t3 = buildTree([row(['2026-03'], 10, 0), row(['2026-01'], 999, 0), row(['2026-02'], 5, 0)], ['month']);
    expect(t3.map((n) => n.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
  test('replier un nœud cache ses enfants', () => {
    expect(flattenTree(tree, () => true)).toHaveLength(7);
    expect(flattenTree(tree, (id) => id !== 'DUCATI')).toHaveLength(5);
  });
  test('export : une colonne par niveau, sous-totaux et total', () => {
    const tot = totals(rows);
    const out = exportTreeRows(tree, ['brand', 'article'], ['Marque', 'Article'],
      [{ header: 'CA HT', value: (n) => n.m.ca }], { none: '(sans)', special: () => 'Port' }, tot, 'Total');
    expect(out[0]).toEqual(['Marque', 'Article', 'CA HT']);
    expect(out[1]).toEqual(['L-DUCATI', null, 400]);
    expect(out[2]).toEqual([null, 'L-a2', 300]);
    expect(out[out.length - 1]).toEqual(['Total', null, 650]);
    expect(exportFileName('Statistiques Ventes', '2026-01-01', '2026-11-18')).toBe('statistiques-ventes-2026-01-01-au-2026-11-18.xlsx');
  });
});

describe('libellés', () => {
  const l = { none: '(sans)', special: (k: string) => `spécial ${k}` };
  test('familles G8 (codes RR-SS-CC)', () => {
    expect(keyLabel('rayon', '01', null, l)).toBe('01 PRODUITS FINIS NEUFS');
    expect(keyLabel('sousrayon', '01-01', null, l)).toBe('01-01 MOTOS');
    expect(keyLabel('categorie', '01-01-01', null, l)).toBe('01-01-01 MOTOS / MONSTER');
    expect(keyLabel('rayon', 'ZZ', null, l)).toBe('ZZ');
  });
  test('clé vide, lignes spéciales, client repris de G8', () => {
    expect(keyLabel('brand', '', null, l)).toBe('(sans)');
    expect(keyLabel('article', '#shipping', null, l)).toBe('spécial #shipping');
    expect(keyLabel('client', '~C1234', 'C1234', l)).toBe('C1234');
    expect(keyLabel('client', 'uuid', 'DUPONT Jean', l)).toBe('DUPONT Jean');
  });
});

describe('lecture des réponses de la base', () => {
  test('lignes : nombres et nulls', () => {
    const r = parseStatsRows({ rows: [{ keys: ['A'], labels: [null], qty: '2', ca_ht: '10.5', cost: 3, stock: null }] });
    expect(r[0].qty).toBe(2);
    expect(r[0].ca_ht).toBe(10.5);
    expect(r[0].labels[0]).toBeNull();
    expect(r[0].stock).toBeNull();
    expect(parseStatsRows(null)).toEqual([]);
  });
  test('mois par mois : toujours 12 mois, total', () => {
    const m = parseMonthly({ year: 2026, months: [{ month: 6, ca_ht: 100, ca_ht_n1: 40, qty_in: 7 }], stock_qty: 3, stock_value: 30 });
    expect(m.months).toHaveLength(12);
    expect(m.months[5].ca_ht).toBe(100);
    expect(m.months[0].ca_ht).toBe(0);
    const t = sumMonths(m.months);
    expect(t.ca_ht).toBe(100);
    expect(t.qty_in).toBe(7);
  });
  test('filtres vides non envoyés', () => {
    expect(cleanFilters({ brand: ' DUCATI ', reference: '', vehicles: 'all', exclude_reprises: false })).toEqual({ brand: 'DUCATI' });
    expect(cleanFilters({ vehicles: 'only', exclude_reprises: true })).toEqual({ vehicles: 'only', exclude_reprises: true });
  });
});

describe('statistiques de la fiche article', () => {
  const rows = [
    { year: 2026, month: 3, qty_sold: 2, ca_ht: 100, cost: 40, qty_bought: 5, amount_bought: 50, qty_ceded: 1, value_ceded: 20 },
    { year: 2025, month: 3, qty_sold: 1, ca_ht: 60, cost: 20, qty_bought: 0, amount_bought: 0, qty_ceded: 0, value_ceded: 0 },
  ];
  test('« Exclure cession » : la cession sort de la quantité et de la marge', () => {
    const avec = articleYear(rows, 2026, false)[2];
    expect(avec).toEqual({ month: 3, qty: 3, ca: 100, margin: 40, qtyBought: 5 });
    const sans = articleYear(rows, 2026, true)[2];
    expect(sans).toEqual({ month: 3, qty: 2, ca: 100, margin: 60, qtyBought: 5 });
    expect(articleYear(rows, 2026, true)).toHaveLength(12);
  });
  test('stat. cumulées par année, la plus récente en premier', () => {
    const y = articleYears(rows, true);
    expect(y.map((x) => x.year)).toEqual([2026, 2025]);
    expect(y[1]).toEqual({ year: 2025, qty: 1, ca: 60, margin: 40, marginPct: 66.7, qtyBought: 0 });
  });
});
