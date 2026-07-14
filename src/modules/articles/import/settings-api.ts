/**
 * M2 — Persistance du paramétrage d'import (article_import_settings),
 * des règles PV/PPC (ppc_price_rules) et lecture du plancher de prix société.
 * NB : tables créées par la migration 20260714090000 — pas encore dans les
 * types Supabase auto-générés, d'où les casts localisés.
 */
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_IMPORT_SETTINGS, type ImportSettings, type PpcRule } from './rules';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

// ── Réglages d'intégration ────────────────────────────────────────────────────

export async function getImportSettings(companyId: string): Promise<ImportSettings> {
  const { data, error } = await raw
    .from('article_import_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_IMPORT_SETTINGS };
  const d = data as Record<string, unknown>;
  return {
    accept_designation: Boolean(d.accept_designation),
    accept_purchase_price: Boolean(d.accept_purchase_price),
    purchase_price_3dec: Boolean(d.purchase_price_3dec),
    sale_price_mode: (d.sale_price_mode as ImportSettings['sale_price_mode']) ?? 'increase_only',
    keep_coefficient: Boolean(d.keep_coefficient),
    accept_supplier_ref: Boolean(d.accept_supplier_ref),
    accept_category: Boolean(d.accept_category),
    accept_brand: Boolean(d.accept_brand),
    no_recreate_replaced: Boolean(d.no_recreate_replaced),
    replaced_to_equivalences: Boolean(d.replaced_to_equivalences),
    new_refs_in_library: Boolean(d.new_refs_in_library),
    integrate_supplier_barcodes: Boolean(d.integrate_supplier_barcodes),
  };
}

export async function saveImportSettings(companyId: string, s: ImportSettings): Promise<void> {
  const { error } = await raw
    .from('article_import_settings')
    .upsert({ company_id: companyId, ...s, updated_at: new Date().toISOString() }, { onConflict: 'company_id' });
  if (error) throw error;
}

// ── Règles PV / PPC ──────────────────────────────────────────────────────────

export type PpcRuleRow = PpcRule & { id: string; company_id: string };

export async function listPpcRules(companyId: string): Promise<PpcRuleRow[]> {
  const { data, error } = await raw
    .from('ppc_price_rules')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as PpcRuleRow[]) ?? [];
}

export async function addPpcRule(companyId: string, rule: PpcRule): Promise<void> {
  const { error } = await raw.from('ppc_price_rules').insert({
    company_id: companyId,
    supplier_name: rule.supplier_name?.trim() || null,
    category_path: rule.category_path?.trim() || null,
    brand: rule.brand?.trim() || null,
    pct: rule.pct,
    is_active: rule.is_active ?? true,
  });
  if (error) throw error;
}

export async function updatePpcRule(id: string, patch: Partial<PpcRule>): Promise<void> {
  const { error } = await raw.from('ppc_price_rules').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deletePpcRule(id: string): Promise<void> {
  const { error } = await raw.from('ppc_price_rules').delete().eq('id', id);
  if (error) throw error;
}

// ── Plancher de prix (réglage société) ───────────────────────────────────────

export type PriceFloor = { threshold: number; min: number };

export async function getPriceFloor(companyId: string): Promise<PriceFloor> {
  const { data, error } = await raw
    .from('companies')
    .select('price_floor_threshold, price_floor_min')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw error;
  return {
    threshold: Number(data?.price_floor_threshold ?? 0),
    min: Number(data?.price_floor_min ?? 0),
  };
}
