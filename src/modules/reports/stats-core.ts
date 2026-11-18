/**
 * M13 — Statistiques façon G8 : logique pure (testée dans tests/statistiques-g8.test.ts).
 *
 * G8 (docs/g8-inventaire 08-compta-stats.md) : axes fournisseur / marque / rayon / client /
 * opérateur / cessions, classement sur 4 niveaux + article, onglets ventes, meilleures ventes,
 * remises, achats, mois par mois, cessions, documents en cours, indicateurs, exercices comparés,
 * export Excel. Les calculs lourds sont en base (`stats_query`, migration 20261118181000) ; ici :
 * périodes prédéfinies, arbre de classement avec sous-totaux, pourcentages (poids du CA, marge,
 * remise, évolution N-1), libellés des clés et lignes d'export.
 *
 * Aucune dépendance au client Supabase ni à React : importable par les tests.
 */
import { familyLabels, rayonByCode } from '../articles/product-families';

export type StatsSource = 'sales' | 'purchases' | 'cessions';

export type StatsDim =
  | 'supplier' | 'brand' | 'rayon' | 'sousrayon' | 'categorie' | 'client' | 'operator'
  | 'article' | 'month' | 'day' | 'year' | 'doctype' | 'cession';

/** Axes proposés par source (G8 : « Fournisseurs · Marques · Rayons · Clients · Opérateurs · Cessions »). */
export const DIMS_BY_SOURCE: Record<StatsSource, StatsDim[]> = {
  sales: ['supplier', 'brand', 'rayon', 'sousrayon', 'categorie', 'client', 'operator', 'article', 'month', 'day', 'year', 'doctype'],
  purchases: ['supplier', 'brand', 'rayon', 'sousrayon', 'categorie', 'article', 'month', 'day', 'year'],
  cessions: ['cession', 'brand', 'rayon', 'sousrayon', 'categorie', 'operator', 'article', 'month', 'day', 'year'],
};

/** G8 : 4 niveaux de classement, puis un dernier niveau « article ». */
export const MAX_LEVELS = 4;

/** Axes chronologiques : triés par date, pas par chiffre d'affaires. */
const CHRONO_DIMS: StatsDim[] = ['month', 'day', 'year'];

/**
 * Niveaux envoyés à la base : les niveaux choisis (sans doublon, sans vide, 4 au plus) puis
 * l'article en dernier niveau si demandé et pas déjà présent.
 */
export function effectiveLevels(levels: (StatsDim | '' | null | undefined)[], withArticle: boolean, source: StatsSource = 'sales'): StatsDim[] {
  const allowed = new Set(DIMS_BY_SOURCE[source]);
  const out: StatsDim[] = [];
  for (const l of levels) {
    if (!l || !allowed.has(l) || out.includes(l)) continue;
    if (out.length >= MAX_LEVELS) break;
    out.push(l);
  }
  if (withArticle && !out.includes('article')) out.push('article');
  return out;
}

// ---------------------------------------------------------------- périodes prédéfinies

export type PeriodPreset =
  | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth'
  | 'thisQuarter' | 'lastQuarter' | 'thisYear' | 'lastYear' | 'last30Days' | 'last12Months';

export const PERIOD_PRESETS: PeriodPreset[] = [
  'today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth',
  'thisQuarter', 'lastQuarter', 'thisYear', 'lastYear', 'last30Days', 'last12Months',
];

const pad = (n: number) => String(n).padStart(2, '0');
/** Date locale → « AAAA-MM-JJ » (jamais toISOString : décalage UTC le soir). */
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (y: number, m: number, d: number) => new Date(y, m, d);

/** Période d'un raccourci, semaine du lundi au dimanche (Belgique). */
export function presetRange(preset: PeriodPreset, today: Date = new Date()): { from: string; to: string } {
  const y = today.getFullYear(); const m = today.getMonth(); const d = today.getDate();
  const dow = (today.getDay() + 6) % 7; // lundi = 0
  const q = Math.floor(m / 3);
  switch (preset) {
    case 'today': return { from: isoDate(today), to: isoDate(today) };
    case 'yesterday': { const x = at(y, m, d - 1); return { from: isoDate(x), to: isoDate(x) }; }
    case 'thisWeek': return { from: isoDate(at(y, m, d - dow)), to: isoDate(at(y, m, d - dow + 6)) };
    case 'lastWeek': return { from: isoDate(at(y, m, d - dow - 7)), to: isoDate(at(y, m, d - dow - 1)) };
    case 'thisMonth': return { from: isoDate(at(y, m, 1)), to: isoDate(at(y, m + 1, 0)) };
    case 'lastMonth': return { from: isoDate(at(y, m - 1, 1)), to: isoDate(at(y, m, 0)) };
    case 'thisQuarter': return { from: isoDate(at(y, q * 3, 1)), to: isoDate(at(y, q * 3 + 3, 0)) };
    case 'lastQuarter': return { from: isoDate(at(y, q * 3 - 3, 1)), to: isoDate(at(y, q * 3, 0)) };
    case 'thisYear': return { from: isoDate(at(y, 0, 1)), to: isoDate(at(y, 11, 31)) };
    case 'lastYear': return { from: isoDate(at(y - 1, 0, 1)), to: isoDate(at(y - 1, 11, 31)) };
    case 'last30Days': return { from: isoDate(at(y, m, d - 29)), to: isoDate(today) };
    case 'last12Months': return { from: isoDate(at(y, m - 11, 1)), to: isoDate(today) };
  }
}

/** Même période un an plus tôt (exercices comparés, G8 « Exercices comparés »). */
export function previousYearRange(from: string, to: string): { from: string; to: string } {
  const shift = (s: string) => {
    const [yy, mm, dd] = s.split('-').map(Number);
    // 29 février → 28 février (comme `date - interval '1 year'` en base)
    const last = new Date(yy - 1, mm, 0).getDate();
    return `${yy - 1}-${pad(mm)}-${pad(Math.min(dd, last))}`;
  };
  return { from: shift(from), to: shift(to) };
}

// ---------------------------------------------------------------- lignes de la base

/** Une ligne renvoyée par `stats_query` (un groupe au niveau le plus fin). */
export type StatsRow = {
  keys: string[]; labels: (string | null)[];
  qty: number; gross_ht: number; ca_ht: number; cost: number; docs: number; credit_notes: number;
  qty_n1: number; ca_ht_n1: number; cost_n1: number;
  stock: number | null; available: number | null; on_order: number | null;
};

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v));

export function parseStatsRows(json: unknown): StatsRow[] {
  const rows = (json && typeof json === 'object' && Array.isArray((json as { rows?: unknown }).rows))
    ? (json as { rows: unknown[] }).rows : Array.isArray(json) ? json : [];
  return rows.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      keys: Array.isArray(o.keys) ? o.keys.map((k) => String(k ?? '')) : [],
      labels: Array.isArray(o.labels) ? o.labels.map((l) => (l === null || l === undefined ? null : String(l))) : [],
      qty: num(o.qty), gross_ht: num(o.gross_ht), ca_ht: num(o.ca_ht), cost: num(o.cost),
      docs: num(o.docs), credit_notes: num(o.credit_notes),
      qty_n1: num(o.qty_n1), ca_ht_n1: num(o.ca_ht_n1), cost_n1: num(o.cost_n1),
      stock: numOrNull(o.stock), available: numOrNull(o.available), on_order: numOrNull(o.on_order),
    };
  });
}

// ---------------------------------------------------------------- arbre de classement

export type Metrics = {
  qty: number; gross: number; ca: number; cost: number; docs: number | null;
  qtyN1: number; caN1: number; costN1: number;
  stock: number | null; available: number | null; onOrder: number | null;
};

export type StatsNode = {
  id: string;            // chemin de clés, unique dans l'arbre
  depth: number;         // 0 = premier niveau
  dim: StatsDim;
  key: string;
  label: string | null;  // libellé de la base (nom du client, de l'article...)
  m: Metrics;
  children: StatsNode[];
};

const emptyMetrics = (): Metrics => ({ qty: 0, gross: 0, ca: 0, cost: 0, docs: 0, qtyN1: 0, caN1: 0, costN1: 0, stock: null, available: null, onOrder: null });

function addInto(t: Metrics, r: StatsRow) {
  t.qty += r.qty; t.gross += r.gross_ht; t.ca += r.ca_ht; t.cost += r.cost;
  t.qtyN1 += r.qty_n1; t.caN1 += r.ca_ht_n1; t.costN1 += r.cost_n1;
}

function sortNodes(nodes: StatsNode[]): StatsNode[] {
  for (const n of nodes) n.children = sortNodes(n.children);
  return nodes.sort((a, b) => {
    if (CHRONO_DIMS.includes(a.dim)) return a.key.localeCompare(b.key);
    if (b.m.ca !== a.m.ca) return b.m.ca - a.m.ca;
    if (b.m.cost !== a.m.cost) return b.m.cost - a.m.cost;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Construit l'arbre G8 : un nœud par valeur de chaque niveau, sous-totaux additionnés.
 * Le nombre de documents (factures + tickets) n'est exact qu'au niveau le plus fin (un document
 * peut tomber dans plusieurs groupes) : il est laissé vide sur les sous-totaux. Le stock n'existe
 * que sur les lignes article.
 */
export function buildTree(rows: StatsRow[], levels: StatsDim[]): StatsNode[] {
  const root: StatsNode[] = [];
  if (levels.length === 0) return root;
  for (const r of rows) {
    let siblings = root;
    let path = '';
    for (let depth = 0; depth < levels.length; depth++) {
      const key = r.keys[depth] ?? '';
      path += `${depth ? '|' : ''}${key}`;
      let node = siblings.find((n) => n.key === key);
      if (!node) {
        node = { id: path, depth, dim: levels[depth], key, label: r.labels[depth] ?? null, m: emptyMetrics(), children: [] };
        siblings.push(node);
      }
      if (node.label === null && r.labels[depth]) node.label = r.labels[depth];
      addInto(node.m, r);
      const leaf = depth === levels.length - 1;
      if (leaf) {
        node.m.docs = (node.m.docs ?? 0) + r.docs;
        if (r.stock !== null) { node.m.stock = r.stock; node.m.available = r.available; node.m.onOrder = r.on_order; }
      } else {
        node.m.docs = null;
      }
      siblings = node.children;
    }
  }
  return sortNodes(root);
}

export function totals(rows: StatsRow[]): Metrics {
  const t = emptyMetrics();
  for (const r of rows) addInto(t, r);
  t.docs = null; // un document peut tomber dans plusieurs groupes : pas de total additionné
  return t;
}

const round = (n: number, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };
const pct = (a: number, b: number) => (b === 0 ? null : round((100 * a) / b, 1));

/** Indicateurs dérivés d'une ligne (G8 : % poids CA, marge HT, % marge, % poids marge, remise, N-1). */
export function derived(m: Metrics, total: Metrics) {
  const margin = m.ca - m.cost;
  const totalMargin = total.ca - total.cost;
  const discount = m.gross - m.ca;
  return {
    margin: round(margin),
    marginPct: pct(margin, m.ca),
    weightCa: pct(m.ca, total.ca),
    weightMargin: pct(margin, totalMargin),
    discount: round(discount),
    discountPct: pct(discount, m.gross),
    marginN1: round(m.caN1 - m.costN1),
    evolutionCa: m.caN1 === 0 ? null : round((100 * (m.ca - m.caN1)) / Math.abs(m.caN1), 1),
  };
}

/** Nœuds visibles, dans l'ordre d'affichage (un nœud replié cache ses enfants). */
export function flattenTree(nodes: StatsNode[], expanded: (id: string) => boolean): StatsNode[] {
  const out: StatsNode[] = [];
  const walk = (list: StatsNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children.length && expanded(n.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// ---------------------------------------------------------------- libellés des clés

/** Les clés spéciales de la base (lignes sans article) : traduites par l'écran. */
export const SPECIAL_KEYS = ['#shipping', '#header', '#other', '#labour', '#article'] as const;

export type KeyLabeler = {
  none: string;                                  // clé vide : « (sans marque) », « (sans fournisseur) »...
  special: (k: (typeof SPECIAL_KEYS)[number]) => string;
};

/**
 * Libellé lisible d'une clé : familles G8 (codes RR-SS-CC → « ACCESSOIRES ET EQUIPEMENTS / ACC STM »),
 * lignes spéciales, puis le libellé fourni par la base, à défaut la clé elle-même.
 */
export function keyLabel(dim: StatsDim, key: string, label: string | null, l: KeyLabeler): string {
  if (!key) return l.none;
  if ((SPECIAL_KEYS as readonly string[]).includes(key)) return l.special(key as (typeof SPECIAL_KEYS)[number]);
  if (dim === 'rayon') return rayonByCode(key)?.label ? `${key} ${rayonByCode(key)!.label}` : key;
  if (dim === 'sousrayon') {
    const [r, s] = key.split('-');
    const sr = rayonByCode(r)?.sousRayons.find((x) => x.code === s);
    return sr ? `${key} ${sr.label}` : key;
  }
  if (dim === 'categorie') {
    const f = familyLabels(key);
    return f ? `${key} ${f.sousRayon} / ${f.cat}` : key;
  }
  if (dim === 'client' && key.startsWith('~')) return label ?? key.slice(1);
  return label?.trim() || key;
}

// ---------------------------------------------------------------- export Excel

export type ExportColumn = { header: string; value: (n: StatsNode, d: ReturnType<typeof derived>) => string | number | null };

/**
 * Lignes d'un export « comme à l'écran » : une colonne par niveau (le libellé n'est rempli qu'à la
 * profondeur du nœud, comme un tableau croisé), puis les colonnes de chiffres. Toutes les lignes de
 * l'arbre sont exportées (sous-totaux compris), dépliées ou non, suivies d'une ligne de total.
 */
export function exportTreeRows(
  nodes: StatsNode[], levels: StatsDim[], levelHeaders: string[], columns: ExportColumn[],
  labeler: KeyLabeler, total: Metrics, totalLabel: string,
): (string | number | null)[][] {
  const header = [...levelHeaders, ...columns.map((c) => c.header)];
  const out: (string | number | null)[][] = [header];
  const all = flattenTree(nodes, () => true);
  for (const n of all) {
    const cells: (string | number | null)[] = levels.map((_, i) => (i === n.depth ? keyLabel(n.dim, n.key, n.label, labeler) : null));
    const d = derived(n.m, total);
    out.push([...cells, ...columns.map((c) => c.value(n, d))]);
  }
  const totalNode: StatsNode = { id: '__total', depth: 0, dim: levels[0] ?? 'brand', key: '__total', label: totalLabel, m: total, children: [] };
  const td = derived(total, total);
  out.push([totalLabel, ...levels.slice(1).map(() => null), ...columns.map((c) => c.value(totalNode, td))]);
  return out;
}

/** Nom de fichier d'export : « statistiques-ventes-2026-01-01-au-2026-11-18.xlsx ». */
export function exportFileName(prefix: string, from: string, to: string): string {
  const slug = prefix.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${from}-au-${to}.xlsx`;
}

// ---------------------------------------------------------------- mois par mois

export type MonthStat = {
  month: number;
  ca_ht: number; ca_ht_n1: number; cost: number; cost_n1: number;
  qty_sold: number; qty_sold_n1: number; docs: number; docs_n1: number;
  purchases_ht: number; purchases_ht_n1: number; qty_bought: number;
  qty_in: number; qty_in_n1: number; qty_out: number; qty_out_n1: number;
};
export type MonthlyStats = { year: number; months: MonthStat[]; stock_qty: number; stock_value: number };

export function parseMonthly(json: unknown): MonthlyStats {
  const o = (json ?? {}) as Record<string, unknown>;
  const months = Array.isArray(o.months) ? o.months : [];
  const keys: (keyof MonthStat)[] = ['month', 'ca_ht', 'ca_ht_n1', 'cost', 'cost_n1', 'qty_sold', 'qty_sold_n1', 'docs', 'docs_n1',
    'purchases_ht', 'purchases_ht_n1', 'qty_bought', 'qty_in', 'qty_in_n1', 'qty_out', 'qty_out_n1'];
  const byMonth = new Map<number, MonthStat>();
  for (const raw of months) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const m = {} as MonthStat;
    for (const k of keys) m[k] = num(r[k]);
    byMonth.set(m.month, m);
  }
  // Toujours 12 mois, même si la base n'en renvoie qu'une partie.
  const full: MonthStat[] = [];
  for (let i = 1; i <= 12; i++) {
    const m = byMonth.get(i) ?? ({ month: i } as MonthStat);
    for (const k of keys) if (k !== 'month') m[k] = num(m[k]);
    full.push(m);
  }
  return { year: num(o.year), months: full, stock_qty: num(o.stock_qty), stock_value: num(o.stock_value) };
}

/** Ligne « Total » du tableau mois par mois. */
export function sumMonths(months: MonthStat[]): Omit<MonthStat, 'month'> {
  const t = { ca_ht: 0, ca_ht_n1: 0, cost: 0, cost_n1: 0, qty_sold: 0, qty_sold_n1: 0, docs: 0, docs_n1: 0,
    purchases_ht: 0, purchases_ht_n1: 0, qty_bought: 0, qty_in: 0, qty_in_n1: 0, qty_out: 0, qty_out_n1: 0 };
  for (const m of months) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += m[k];
  for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = round(t[k], 3);
  return t;
}

// ---------------------------------------------------------------- indicateurs et documents en cours

export type Indicator = {
  doc_type: string; created: number; created_ht: number; avg_basket: number; items_per_doc: number;
  open: number; open_ht: number; transformed: number; rate: number; value: number | null;
  targets: Record<string, number>;
};

export function parseIndicators(json: unknown): Indicator[] {
  const arr = Array.isArray(json) ? json : [];
  return arr.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const targets: Record<string, number> = {};
    if (r.targets && typeof r.targets === 'object') for (const [k, v] of Object.entries(r.targets as Record<string, unknown>)) targets[k] = num(v);
    return {
      doc_type: String(r.doc_type ?? ''), created: num(r.created), created_ht: num(r.created_ht), avg_basket: num(r.avg_basket),
      items_per_doc: num(r.items_per_doc), open: num(r.open), open_ht: num(r.open_ht), transformed: num(r.transformed),
      rate: num(r.rate), value: numOrNull(r.value), targets,
    };
  });
}

export type OpenDocStat = { doc_type: string; count: number; items: number; ca_ht: number; margin: number | null };
export function parseOpenDocs(json: unknown): OpenDocStat[] {
  const arr = Array.isArray(json) ? json : [];
  return arr.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return { doc_type: String(r.doc_type ?? ''), count: num(r.count), items: num(r.items), ca_ht: num(r.ca_ht), margin: numOrNull(r.margin) };
  });
}

// ---------------------------------------------------------------- statistiques d'un article (fiche)

export type ArticleMonthStat = {
  year: number; month: number; qty_sold: number; ca_ht: number; cost: number;
  qty_bought: number; amount_bought: number; qty_ceded: number; value_ceded: number;
};

export function parseArticleStats(json: unknown): ArticleMonthStat[] {
  const arr = Array.isArray(json) ? json : [];
  return arr.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      year: num(r.year), month: num(r.month), qty_sold: num(r.qty_sold), ca_ht: num(r.ca_ht), cost: num(r.cost),
      qty_bought: num(r.qty_bought), amount_bought: num(r.amount_bought), qty_ceded: num(r.qty_ceded), value_ceded: num(r.value_ceded),
    };
  });
}

export type ArticleMonthView = { month: number; qty: number; ca: number; margin: number; qtyBought: number };

/**
 * Une année de la fiche article, mois par mois (G8 : Quantité · C.A. H.T. · Marge H.T. · Qté achetées).
 * Case G8 « Exclure cession » décochée : les cessions comptent comme des sorties (quantité) et leur
 * coût vient en déduction de la marge (sortie sans chiffre d'affaires).
 */
export function articleYear(rows: ArticleMonthStat[], year: number, excludeCessions: boolean): ArticleMonthView[] {
  const out: ArticleMonthView[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = rows.find((x) => x.year === year && x.month === m);
    const ceded = r && !excludeCessions ? r.qty_ceded : 0;
    const cededValue = r && !excludeCessions ? r.value_ceded : 0;
    out.push({
      month: m,
      qty: round((r?.qty_sold ?? 0) + ceded, 3),
      ca: round(r?.ca_ht ?? 0),
      margin: round((r?.ca_ht ?? 0) - (r?.cost ?? 0) - cededValue),
      qtyBought: round(r?.qty_bought ?? 0, 3),
    });
  }
  return out;
}

/** Synthèse par année (onglet « Stat. cumulées ») : de la plus récente à la plus ancienne. */
export function articleYears(rows: ArticleMonthStat[], excludeCessions: boolean): { year: number; qty: number; ca: number; margin: number; marginPct: number | null; qtyBought: number }[] {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  return years.map((y) => {
    const months = articleYear(rows, y, excludeCessions);
    const qty = round(months.reduce((s, m) => s + m.qty, 0), 3);
    const ca = round(months.reduce((s, m) => s + m.ca, 0));
    const margin = round(months.reduce((s, m) => s + m.margin, 0));
    const qtyBought = round(months.reduce((s, m) => s + m.qtyBought, 0), 3);
    return { year: y, qty, ca, margin, marginPct: pct(margin, ca), qtyBought };
  });
}
