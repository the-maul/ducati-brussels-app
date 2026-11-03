/**
 * M2 / M4 — Garde-fous de commande fournisseur (TAR008) : chargement des articles et de leur
 * chaine de remplacement, puis decision pure (supply-state.ts). Utilise par le panier de
 * commande Ducati (basket-api.ts) et les commandes de pieces (orders/api.ts).
 * Le meme controle existe cote base (migration 20261103280000) : celui-ci donne le message
 * avant l'appel, la base refuse si on passe a cote.
 */
import { supabase } from '@/integrations/supabase/client';
import { MAX_REPLACEMENT_HOPS } from '@/modules/sales/replacement-chain';
import { guardSupplierLinesPure, supplierOrderDecision, type SupplierOrderDecision, type SupplyArticle } from './supply-state';

/** Articles demandes + toute leur chaine de remplacement (quelques allers-retours au plus). */
export async function loadSupplyArticles(ids: string[]): Promise<Map<string, SupplyArticle>> {
  const byId = new Map<string, SupplyArticle>();
  let pending = [...new Set(ids.filter(Boolean))];
  for (let hop = 0; pending.length && hop <= MAX_REPLACEMENT_HOPS; hop++) {
    const { data, error } = await supabase
      .from('articles').select('id, reference, supplier_availability, superseded_by_id').in('id', pending);
    if (error) throw error;
    const next: string[] = [];
    for (const r of data ?? []) {
      byId.set(r.id, { id: r.id, reference: r.reference, supplier_availability: r.supplier_availability, superseded_by_id: r.superseded_by_id });
      // On ne suit la chaine que pour une piece « remplacee » au tarif (les autres ne changent pas de reference).
      if (r.supplier_availability === 'yellow' || (hop > 0 && r.superseded_by_id)) {
        if (r.superseded_by_id && !byId.has(r.superseded_by_id)) next.push(r.superseded_by_id);
      }
    }
    pending = [...new Set(next)];
  }
  return byId;
}

/** Lignes de panier filtrees : fin de serie retiree, remplacee commandee sous la derniere reference. */
export async function guardSupplierLines<L extends { article_id: string }>(lines: L[]) {
  const byId = await loadSupplyArticles(lines.map((l) => l.article_id));
  return guardSupplierLinesPure(lines, byId);
}

/** Decision pour un seul article (commande de pieces). */
export async function supplierOrderCheck(articleId: string): Promise<SupplierOrderDecision | null> {
  const byId = await loadSupplyArticles([articleId]);
  const a = byId.get(articleId);
  return a ? supplierOrderDecision(a, byId) : null;
}
