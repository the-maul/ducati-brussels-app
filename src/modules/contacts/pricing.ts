/**
 * M1/M2 — Tarifs clients : règles de prix (remise %, coefficient, paliers quantitatifs)
 * + résolveur de prix pour un client/article/quantité (utilisé au POS et en simulation).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type PriceRule = Database['public']['Tables']['customer_price_rules']['Row'];
export type Tier = { min_qty: number; discount_pct: number };
export type ResolvedPrice = { unit_price_ht: number; unit_price_ttc: number; rule_kind: string; discount_pct: number };

/** Résout le prix d'un article pour un client à une quantité donnée (règle la plus spécifique). */
export async function resolveCustomerPrice(companyId: string, contactId: string, articleId: string, qty = 1): Promise<ResolvedPrice | null> {
  const { data, error } = await supabase.rpc('resolve_customer_price', { _company: companyId, _contact: contactId, _article: articleId, _qty: qty });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as ResolvedPrice | undefined;
  return r ? { unit_price_ht: Number(r.unit_price_ht), unit_price_ttc: Number(r.unit_price_ttc), rule_kind: r.rule_kind, discount_pct: Number(r.discount_pct) } : null;
}

export async function listPriceRules(companyId: string, contactId: string): Promise<PriceRule[]> {
  const { data, error } = await supabase.from('customer_price_rules').select('*').eq('company_id', companyId).eq('contact_id', contactId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addPriceRule(companyId: string, rule: { contact_id: string; article_id?: string | null; category_id?: string | null; kind: string; value?: number; tiers?: Tier[] | null; label?: string }): Promise<void> {
  const { error } = await supabase.from('customer_price_rules').insert({
    company_id: companyId, contact_id: rule.contact_id, article_id: rule.article_id ?? null, category_id: rule.category_id ?? null,
    kind: rule.kind, value: rule.value ?? 0, tiers: (rule.tiers as unknown) ?? null, label: rule.label ?? null,
  });
  if (error) throw error;
}

export async function deletePriceRule(id: string): Promise<void> {
  const { error } = await supabase.from('customer_price_rules').delete().eq('id', id);
  if (error) throw error;
}
