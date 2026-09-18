/**
 * M8 — Lecture des paramètres de frais de devis atelier (reference_values 'workshop_quote_fee')
 * + repli du tarif horaire sur l'article « MO » (main-d'œuvre, type T). Voir quote-fees.ts.
 */
import { supabase } from '@/integrations/supabase/client';
import { QUOTE_FEE_TABLE_KEY, resolveQuoteFeeParams, type QuoteFeeParams } from './quote-fees';

export async function loadQuoteFeeParams(companyId: string): Promise<QuoteFeeParams> {
  const [ref, mo] = await Promise.all([
    supabase.from('reference_values').select('code, is_active, extra')
      .eq('company_id', companyId).eq('table_key', QUOTE_FEE_TABLE_KEY),
    supabase.from('articles').select('sale_price_ht')
      .eq('company_id', companyId).eq('reference', 'MO').eq('mgmt_type', 'T').maybeSingle(),
  ]);
  if (ref.error) throw ref.error;
  const moPrice = mo.data?.sale_price_ht != null ? Number(mo.data.sale_price_ht) : null;
  return resolveQuoteFeeParams(ref.data ?? [], moPrice);
}
