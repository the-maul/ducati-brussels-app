/**
 * M8 — Lecture des paramètres de frais de devis atelier (reference_values 'workshop_quote_fee')
 * + repli du tarif horaire sur l'article « MO » (main-d'œuvre, type T). Voir quote-fees.ts.
 */
import { supabase } from '@/integrations/supabase/client';
import { listRef } from '@/modules/settings/reference-api';
import { QUOTE_FEE_TABLE_KEY, resolveQuoteFeeParams, type QuoteFeeParams } from './quote-fees';

export async function loadQuoteFeeParams(companyId: string): Promise<QuoteFeeParams> {
  // Parametres lus dans la lecture groupee des tables de parametres (lot perf 2).
  const [ref, mo] = await Promise.all([
    listRef(companyId, QUOTE_FEE_TABLE_KEY).then((rows) => ({ data: rows, error: null }), (error: unknown) => ({ data: null, error })),
    supabase.from('articles').select('sale_price_ht')
      .eq('company_id', companyId).eq('reference', 'MO').eq('mgmt_type', 'T').maybeSingle(),
  ]);
  if (ref.error) throw ref.error;
  const moPrice = mo.data?.sale_price_ht != null ? Number(mo.data.sale_price_ht) : null;
  return resolveQuoteFeeParams(ref.data ?? [], moPrice);
}
