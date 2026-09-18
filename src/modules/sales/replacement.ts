/**
 * M6 — Référence remplacée : proposer automatiquement la dernière (mission 05, carte 3).
 * « Il faut prendre la dernière » (vidéo de Domenico, G8) : une référence Ducati peut être
 * remplacée plusieurs fois (A → B → C). On suit la chaîne `articles.superseded_by_id`
 * jusqu'au bout, en se protégeant des boucles (A → B → A) et des chaînes anormalement longues.
 * Les équivalents (`articles.equivalence_group`) sont listés à côté.
 */
import { supabase } from '@/integrations/supabase/client';
import { searchSaleArticles, type SaleArticle } from './write-api';

export const MAX_REPLACEMENT_HOPS = 30;

export type ReplacementChain = {
  /** Dernière référence de la chaîne (null si l'article n'est pas remplacé). */
  lastId: string | null;
  /** Identifiants parcourus, article de départ compris. */
  path: string[];
  /** Vrai si la chaîne revient sur une référence déjà vue (données à corriger). */
  loop: boolean;
};

/**
 * Suit la chaîne de remplacement depuis `startId`. `next(id)` renvoie la référence qui
 * remplace `id` (ou null / undefined). En cas de boucle, on s'arrête sur la dernière
 * référence avant de repasser par une référence déjà vue.
 */
export function followReplacementChain(
  startId: string,
  next: (id: string) => string | null | undefined,
  maxHops = MAX_REPLACEMENT_HOPS,
): ReplacementChain {
  const path = [startId];
  const seen = new Set(path);
  let current = startId;
  let loop = false;
  for (;;) {
    const n = next(current);
    if (!n) break;
    // boucle (A → B → A) ou chaîne anormalement longue : on s'arrête et on le signale
    if (seen.has(n) || path.length > maxHops) { loop = true; break; }
    path.push(n);
    seen.add(n);
    current = n;
  }
  return { lastId: path.length > 1 ? current : null, path, loop };
}

type ArticleLink = { id: string; reference: string; designation: string; superseded_by_id: string | null; sale_price_ht: number; vat_rate: number; mgmt_type: string | null };

async function fetchLink(companyId: string, id: string): Promise<ArticleLink | null> {
  const { data, error } = await supabase
    .from('articles')
    .select('id, reference, designation, superseded_by_id, sale_price_ht, vat_rate, mgmt_type')
    .eq('company_id', companyId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? { ...data, sale_price_ht: Number(data.sale_price_ht ?? 0), vat_rate: Number(data.vat_rate ?? 21) } : null;
}

/** Article de la chaîne sous la forme d'un résultat de recherche (avec stock si disponible). */
async function toSaleArticle(companyId: string, a: ArticleLink): Promise<SaleArticle> {
  const hit = (await searchSaleArticles(companyId, a.reference, 12)).find((x) => x.id === a.id);
  return hit ?? {
    id: a.id, reference: a.reference, designation: a.designation, sale_price_ht: a.sale_price_ht, vat_rate: a.vat_rate,
    mgmt_type: a.mgmt_type, real_qty: 0, reserved_qty: 0, on_order_qty: 0, bin_location: null,
    superseded_by_id: a.superseded_by_id, equivalence_group: null,
  };
}

export type ReplacementInfo = {
  /** Remplaçant direct (la référence indiquée sur la fiche). */
  direct: { id: string; reference: string } | null;
  /** Dernière référence de la chaîne, prête à être posée sur la ligne. */
  latest: SaleArticle | null;
  hops: number;
  loop: boolean;
  equivalents: SaleArticle[];
};

/** Remplacement et équivalents d'un article choisi sur une ligne de vente. */
export async function getReplacementInfo(companyId: string, articleId: string): Promise<ReplacementInfo> {
  const { data: start, error } = await supabase
    .from('articles').select('id, superseded_by_id, equivalence_group')
    .eq('company_id', companyId).eq('id', articleId).maybeSingle();
  if (error) throw error;
  const info: ReplacementInfo = { direct: null, latest: null, hops: 0, loop: false, equivalents: [] };
  if (!start) return info;

  if (start.superseded_by_id) {
    // Charge la chaîne maillon par maillon (une chaîne Ducati fait rarement plus de 3 maillons).
    const links = new Map<string, ArticleLink>();
    const nextOf = new Map<string, string | null>([[start.id, start.superseded_by_id]]);
    let cursor: string | null = start.superseded_by_id;
    while (cursor && !links.has(cursor) && links.size < MAX_REPLACEMENT_HOPS) {
      const l = await fetchLink(companyId, cursor);
      if (!l) { nextOf.set(cursor, null); break; }
      links.set(l.id, l);
      nextOf.set(l.id, l.superseded_by_id);
      cursor = l.superseded_by_id;
    }
    const known = (id: string | null | undefined) => !!id && (id === start.id || links.has(id));
    const chain = followReplacementChain(start.id, (id) => {
      const n = nextOf.get(id);
      return known(n) ? n : null;
    });
    const direct = links.get(start.superseded_by_id);
    info.direct = direct ? { id: direct.id, reference: direct.reference } : null;
    info.loop = chain.loop;
    info.hops = chain.path.length - 1;
    const last = chain.lastId ? links.get(chain.lastId) : null;
    if (last) info.latest = await toSaleArticle(companyId, last);
  }

  if (start.equivalence_group) {
    const { data: eq, error: ee } = await supabase
      .from('articles').select('id, reference, designation, superseded_by_id, sale_price_ht, vat_rate, mgmt_type')
      .eq('company_id', companyId).eq('equivalence_group', start.equivalence_group).neq('id', start.id)
      .eq('is_active', true).order('reference').limit(10);
    if (ee) throw ee;
    info.equivalents = await Promise.all((eq ?? []).map((a) => toSaleArticle(companyId, {
      ...a, sale_price_ht: Number(a.sale_price_ht ?? 0), vat_rate: Number(a.vat_rate ?? 21),
    })));
  }
  return info;
}
