/**
 * M5 — Stock & inventaire : lecture du triple stock (réel/réservé/disponible),
 * valeur PAMP, historique des mouvements. Tout est une somme de stock_moves (B4/B7).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type StockRow = {
  article_id: string; reference: string; designation: string; mgmt_type: string;
  category_path: string | null; bin_location: string | null; supplier_id: string | null;
  real_qty: number; reserved_qty: number; available_qty: number;
  pamp: number; stock_value: number; stock_min: number;
};
export type StockMove = Database['public']['Tables']['stock_moves']['Row'];

/**
 * Portée de la lecture du stock (paramètre `_stock` de `article_stock_list`).
 * `actif` = les articles qui ont un mouvement OU un stock mini : c'est le stock
 * du magasin (~1 200 lignes). Les autres sont à zéro partout et ne changent
 * aucun total.
 */
export type StockScope = 'actif' | 'all' | 'pos' | 'neg' | 'zero';

/** Plafond PostgREST du projet : toute réponse est coupée à 1 000 lignes. */
const PAGE = 1000;

/** Garde-fou : au-delà, on préfère une erreur lisible à une liste fausse. */
const MAX_ROWS = 20000;

export class StockTooLargeError extends Error {
  constructor() {
    super('Trop d\'articles à charger d\'un coup pour cet écran — affinez les critères.');
  }
}

/**
 * Stock valorisé de la société, **paginé**.
 *
 * PIÈGE HISTORIQUE (corrigé le 23/09/2026) : cette fonction demandait tout le
 * stock en un appel. PostgREST coupe à 1 000 lignes sans le dire, donc sur
 * 93 000 articles on ne recevait que les 1 000 premières références — aucune
 * n'ayant de mouvement. Les écrans affichaient alors des totaux à zéro et la
 * liste Pièces ne trouvait jamais un seul article en stock.
 */
export async function listStock(companyId: string, scope: StockScope = 'actif'): Promise<StockRow[]> {
  const out: StockRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc('article_stock_list', {
      _company: companyId, _stock: scope, _limit: PAGE, _offset: offset,
    } as never);
    if (error) throw error;
    const rows = (data ?? []) as {
      article_id: string; reference: string; designation: string; mgmt_type: string;
      category_path: string | null; bin_location: string | null; supplier_id: string | null;
      real_qty: number; reserved_qty: number; available_qty: number;
      pamp: number; stock_value: number; stock_min: number;
    }[];
    out.push(...rows.map((r) => ({
      article_id: r.article_id, reference: r.reference, designation: r.designation, mgmt_type: r.mgmt_type,
      category_path: r.category_path, bin_location: r.bin_location, supplier_id: r.supplier_id,
      real_qty: Number(r.real_qty), reserved_qty: Number(r.reserved_qty), available_qty: Number(r.available_qty),
      pamp: Number(r.pamp), stock_value: Number(r.stock_value), stock_min: Number(r.stock_min),
    })));
    if (rows.length < PAGE) return out;
    if (out.length >= MAX_ROWS) throw new StockTooLargeError();
  }
}

// ---------------------------------------------------------------------------------------------
// Ecran Stock / Depreciations pagine en base (perf 2, 20/11/2026, migration 20261120113000)
// ---------------------------------------------------------------------------------------------

/** Filtres des ecrans Stock et Depreciations (memes regles en base et dans le repli ci-dessous). */
export type StockScreenFilters = {
  q?: string; only_stocked?: boolean; below_min?: boolean; reorder?: boolean; dormant?: boolean;
  supplier_id?: string; rayon_code?: string; rayon_label?: string;
  /** Seulement ces articles (disponibilite des lignes d'un document). */
  article_ids?: string[];
};
export type StockScreenPage = { rows: StockRow[]; total: number; value: number };

/** Lignes par page a l'ecran ; l'export lit par pages de 1 000 (plafond d'une reponse). */
export const STOCK_SCREEN_PAGE = 100;
const EXPORT_PAGE = 1000;

/**
 * Filtre d'ecran, version JavaScript : celle d'avant (ecran /stock), gardee comme repli tant que
 * la migration n'est pas posee. `stock_screen_page` applique exactement les memes regles.
 */
export function filterStockRows(rows: StockRow[], f: StockScreenFilters): StockRow[] {
  const q = (f.q ?? '').trim().toLowerCase();
  const code = (f.rayon_code ?? '').toLowerCase();
  const label = (f.rayon_label ?? '').toLowerCase();
  return rows.filter((r) => {
    if (f.only_stocked && Math.abs(r.real_qty) < 0.0001) return false;
    if (f.below_min && !(r.stock_min > 0 && r.available_qty < r.stock_min)) return false;
    if (f.supplier_id && r.supplier_id !== f.supplier_id) return false;
    if (code) {
      const cp = (r.category_path ?? '').toLowerCase();
      if (!r.category_path || !(cp.startsWith(`${code}-`) || (!!label && cp.includes(label)))) return false;
    }
    if (f.dormant && !(r.available_qty > 0)) return false;
    if (q && !(`${r.reference ?? ''} ${r.designation ?? ''} ${r.bin_location ?? ''}`.toLowerCase().includes(q))) return false;
    if (f.reorder && !((r.stock_min > 0 && r.available_qty < r.stock_min) || r.available_qty < 0)) return false;
    if (f.article_ids && !f.article_ids.includes(r.article_id)) return false;
    return true;
  });
}

const looseRpc = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};
const isMissingFn = (e: { code?: string; message: string }) => e.code === 'PGRST202' || e.code === '42883' || /stock_screen_page/.test(e.message);
const toRow = (r: Record<string, unknown>): StockRow => ({
  article_id: String(r.article_id), reference: String(r.reference ?? ''), designation: String(r.designation ?? ''), mgmt_type: String(r.mgmt_type ?? ''),
  category_path: (r.category_path as string | null) ?? null, bin_location: (r.bin_location as string | null) ?? null, supplier_id: (r.supplier_id as string | null) ?? null,
  real_qty: Number(r.real_qty), reserved_qty: Number(r.reserved_qty), available_qty: Number(r.available_qty),
  pamp: Number(r.pamp), stock_value: Number(r.stock_value), stock_min: Number(r.stock_min),
});

/** Une page du stock filtre + nombre total + valeur totale (calcules en base). */
export async function stockScreenPage(companyId: string, filters: StockScreenFilters, limit = STOCK_SCREEN_PAGE, offset = 0): Promise<StockScreenPage> {
  const { data, error } = await looseRpc.rpc('stock_screen_page', { _company: companyId, _filters: filters, _limit: limit, _offset: offset });
  if (error) {
    if (!isMissingFn(error)) throw new Error(error.message);
    // Migration pas encore posee : ancienne lecture complete, filtree et decoupee ici.
    const all = filterStockRows(await listStock(companyId), filters);
    return {
      rows: all.slice(offset, offset + limit), total: all.length,
      value: Math.round(all.reduce((s, r) => s + r.stock_value, 0) * 100) / 100,
    };
  }
  const d = (data ?? {}) as { rows?: Record<string, unknown>[]; total?: number; value?: number };
  return { rows: (d.rows ?? []).map(toRow), total: Number(d.total ?? 0), value: Number(d.value ?? 0) };
}

/** Toutes les lignes du stock filtre (export complet), par pages de 1 000. */
export async function listStockScreenAll(companyId: string, filters: StockScreenFilters): Promise<StockRow[]> {
  const out: StockRow[] = [];
  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const page = await stockScreenPage(companyId, filters, EXPORT_PAGE, offset);
    out.push(...page.rows);
    if (page.rows.length < EXPORT_PAGE || out.length >= page.total) return out;
    if (out.length >= MAX_ROWS) throw new StockTooLargeError();
  }
}

/**
 * Stock (perimetre « actif », memes valeurs que listStock) de quelques articles seulement : la
 * disponibilite des lignes d'un document ne relit plus tout le stock de la societe.
 */
export async function listStockFor(companyId: string, articleIds: string[]): Promise<StockRow[]> {
  const ids = [...new Set(articleIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const out: StockRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(...await listStockScreenAll(companyId, { article_ids: ids.slice(i, i + 500) }));
  }
  return out;
}

/** Articles par identifiant (reference / designation des depreciations actives). */
export async function listArticleLabels(ids: string[]): Promise<Map<string, { reference: string; designation: string }>> {
  const out = new Map<string, { reference: string; designation: string }>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await supabase.from('articles').select('id, reference, designation').in('id', uniq.slice(i, i + 200));
    if (error) throw error;
    for (const a of data ?? []) out.set(a.id, { reference: a.reference, designation: a.designation });
  }
  return out;
}

export async function listStockHistory(articleId: string): Promise<StockMove[]> {
  const { data, error } = await supabase.rpc('article_stock_history', { _article: articleId });
  if (error) throw error;
  return (data ?? []) as StockMove[];
}

/** Cessions internes (sorties valorisées non facturables) : mouvements type 'cession'. */
export async function listCessions(companyId: string): Promise<StockMove[]> {
  const { data, error } = await supabase
    .from('stock_moves').select('*').eq('company_id', companyId).eq('move_type', 'cession')
    .order('occurred_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

/** Enregistre une cession interne typée (cadeau, démo, fournitures atelier, garantie…). */
export async function recordCession(articleId: string, qty: number, cessionType: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('record_stock_move', {
    // undefined : _unit_cost et _bin sont DEFAULT NULL cote SQL, les omettre equivaut a NULL.
    _article: articleId, _type: 'cession', _qty: -Math.abs(qty), _unit_cost: undefined,
    _is_reservation: false, _bin: undefined, _origin: 'cession', _ref: cessionType, _note: note || cessionType,
  });
  if (error) throw error;
}
