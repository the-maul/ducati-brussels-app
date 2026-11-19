/**
 * M8 — Prix des lignes d'OR : acces base (lot accident-expert, 19/11/2026, T4).
 * Prix catalogue des articles (base du re-tarifage) et colonne `repair_orders.insurer_price_list_id`
 * (tarif assureur applique aux lignes, migration 20261119200000 : non typee dans types.ts).
 */
import { supabase } from '@/integrations/supabase/client';
import { effectiveSaleHt } from '@/lib/pricing';
import { articleVatRate } from '@/modules/sales/article-price';

/** Prix catalogue HT des articles (arrondi societe compris, comme a la saisie d'une ligne). */
export async function articleBasePrices(ids: readonly string[], roundUp: boolean): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await supabase.from('articles').select('id, sale_price_ht, vat_rate').in('id', uniq.slice(i, i + 200));
    if (error) throw error;
    for (const a of data ?? []) {
      const base = Number(a.sale_price_ht ?? 0) > 0 ? Number(a.sale_price_ht) : 0;
      out.set(a.id, effectiveSaleHt(base, articleVatRate(a), roundUp));
    }
  }
  return out;
}

let probe: Promise<boolean> | null = null;
/** true quand la migration 20261119200000 est appliquee (colonne repair_orders.insurer_price_list_id). */
export function insurerPricingSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const { error } = await supabase.from('repair_orders').select('insurer_price_list_id' as never).limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return probe;
}
