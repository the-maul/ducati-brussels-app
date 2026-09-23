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
