/**
 * M2 — Persistance du paramétrage d'import (article_import_settings),
 * des règles PV/PPC (ppc_price_rules) et du plancher de prix société.
 *
 * RÉSILIENCE : tant que la migration 20260714 n'est pas appliquée à la base
 * (tables/colonnes absentes), tout bascule sur un stockage LOCAL (par poste,
 * localStorage) — le paramétrage et les règles restent 100 % fonctionnels.
 * Écriture « write-through » : la base est tentée d'abord, le local toujours
 * tenu à jour ; dès la migration passée, la base reprend la main sans migration
 * de données à faire (re-sauvegarder une fois suffit).
 */
import { supabase } from '@/integrations/supabase/client';
import {
  DEFAULT_IMPORT_SETTINGS, DEFAULT_DISCOUNT_CLASSES, normalizeDiscountCode,
  type ImportSettings, type PpcRule, type FloorMode, type DiscountClass,
} from './rules';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

/** Erreur « schéma manquant » : table absente (PGRST205/42P01) ou colonne absente (42703). */
export function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01' || code === '42703';
}

// ── Stockage local (repli par poste) ─────────────────────────────────────────

const canStore = () => typeof window !== 'undefined' && !!window.localStorage;

function readLocal<T>(key: string): T | null {
  if (!canStore()) return null;
  try {
    const s = window.localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch { return null; }
}

function writeLocal(key: string, value: unknown): void {
  if (!canStore()) return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

const kSettings = (companyId: string) => `ducati.import-settings.${companyId}`;
const kRules = (companyId: string) => `ducati.ppc-rules.${companyId}`;
const kFloor = (companyId: string) => `ducati.price-floor.${companyId}`;
const kClasses = (companyId: string) => `ducati.discount-classes.${companyId}`;

/**
 * Le schéma requis par l'import est-il présent en base ? (bannière migration)
 * Sonde la table de config ET les colonnes récentes (articles.year_from) : un
 * client ayant appliqué un ancien blob SQL doit revoir le bandeau pour la suite.
 */
export async function checkImportConfigSchema(): Promise<boolean> {
  const [cfg, yearCol] = await Promise.all([
    raw.from('article_import_settings').select('company_id').limit(1),
    raw.from('articles').select('year_from').limit(1),
  ]);
  const missing = (e: unknown) =>
    isMissingSchema(e) || (e as { code?: string } | null)?.code === 'PGRST204';
  if (cfg.error && missing(cfg.error)) return false;
  if (yearCol.error && missing(yearCol.error)) return false;
  return true; // autre erreur (RLS…) : le schéma existe
}

// ── Réglages d'intégration ────────────────────────────────────────────────────

function coerceSettings(d: Record<string, unknown>): ImportSettings {
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
    translate_designations: Boolean(d.translate_designations),
  };
}

export async function getImportSettings(companyId: string): Promise<ImportSettings> {
  try {
    const { data, error } = await raw
      .from('article_import_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw error;
    if (data) return coerceSettings(data as Record<string, unknown>);
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
  }
  const local = readLocal<Record<string, unknown>>(kSettings(companyId));
  return local ? coerceSettings(local) : { ...DEFAULT_IMPORT_SETTINGS };
}

export async function saveImportSettings(companyId: string, s: ImportSettings): Promise<void> {
  writeLocal(kSettings(companyId), s); // toujours — le paramétrage fonctionne même sans migration
  try {
    const { error } = await raw
      .from('article_import_settings')
      .upsert({ company_id: companyId, ...s, updated_at: new Date().toISOString() }, { onConflict: 'company_id' });
    if (error) throw error;
  } catch (e) {
    if (!isMissingSchema(e)) throw e; // schéma manquant : le local a déjà pris le relais
  }
}

// ── Règles PV / PPC ──────────────────────────────────────────────────────────

export type PpcRuleRow = PpcRule & { id: string; company_id: string };

const localRules = (companyId: string): PpcRuleRow[] => readLocal<PpcRuleRow[]>(kRules(companyId)) ?? [];

export async function listPpcRules(companyId: string): Promise<PpcRuleRow[]> {
  try {
    const { data, error } = await raw
      .from('ppc_price_rules')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as PpcRuleRow[]) ?? [];
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
    return localRules(companyId);
  }
}

export async function addPpcRule(companyId: string, rule: PpcRule): Promise<void> {
  const clean = {
    supplier_name: rule.supplier_name?.trim() || null,
    category_path: rule.category_path?.trim() || null,
    brand: rule.brand?.trim() || null,
    pct: rule.pct,
    round_mode: rule.round_mode ?? 'none',
    is_active: rule.is_active ?? true,
  };
  try {
    const { error } = await raw.from('ppc_price_rules').insert({ company_id: companyId, ...clean });
    if (error) throw error;
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
    const rules = localRules(companyId);
    rules.push({ id: `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, company_id: companyId, ...clean });
    writeLocal(kRules(companyId), rules);
  }
}

export async function updatePpcRule(companyId: string, id: string, patch: Partial<PpcRule>): Promise<void> {
  if (!id.startsWith('local-')) {
    try {
      const { error } = await raw.from('ppc_price_rules').update(patch).eq('id', id);
      if (error) throw error;
      return;
    } catch (e) {
      if (!isMissingSchema(e)) throw e;
    }
  }
  const rules = localRules(companyId).map((r) => (r.id === id ? { ...r, ...patch } : r));
  writeLocal(kRules(companyId), rules);
}

export async function deletePpcRule(companyId: string, id: string): Promise<void> {
  if (!id.startsWith('local-')) {
    try {
      const { error } = await raw.from('ppc_price_rules').delete().eq('id', id);
      if (error) throw error;
      return;
    } catch (e) {
      if (!isMissingSchema(e)) throw e;
    }
  }
  writeLocal(kRules(companyId), localRules(companyId).filter((r) => r.id !== id));
}

// ── Classes de remise → prix d'achat (table supplier_discount_classes) ──────

export type DiscountClassRow = DiscountClass & { id: string; company_id: string };

/**
 * Repli par poste tant que la migration 20261030120000 n'est pas appliquee :
 * la grille G8 par defaut, modifiable localement.
 */
const localClasses = (companyId: string): DiscountClassRow[] =>
  readLocal<DiscountClassRow[]>(kClasses(companyId))
  ?? DEFAULT_DISCOUNT_CLASSES.map((c, i) => ({ ...c, is_active: c.is_active ?? true, id: `local-default-${i}`, company_id: companyId }));

const sortClasses = (rows: DiscountClassRow[]): DiscountClassRow[] =>
  [...rows].sort((a, b) => (a.supplier_name ?? '').localeCompare(b.supplier_name ?? '') || a.code.localeCompare(b.code));

/** La grille de la societe (une seule lecture par analyse d'import). */
export async function listDiscountClasses(companyId: string): Promise<DiscountClassRow[]> {
  try {
    const { data, error } = await raw
      .from('supplier_discount_classes')
      .select('*')
      .eq('company_id', companyId);
    if (error) throw error;
    return sortClasses(((data as DiscountClassRow[]) ?? []).map((r) => ({ ...r, discount_pct: Number(r.discount_pct) })));
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
    return sortClasses(localClasses(companyId));
  }
}

function cleanClass(c: DiscountClass): DiscountClass {
  const pct = Number(c.discount_pct);
  return {
    supplier_name: c.supplier_name?.trim() || null,
    code: normalizeDiscountCode(c.code),
    discount_pct: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0,
    is_active: c.is_active ?? true,
  };
}

export async function addDiscountClass(companyId: string, c: DiscountClass): Promise<void> {
  const clean = cleanClass(c);
  try {
    const { error } = await raw.from('supplier_discount_classes').insert({ company_id: companyId, ...clean });
    if (error) throw error;
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
    const rows = localClasses(companyId).filter(
      (r) => !(normalizeDiscountCode(r.code) === clean.code && (r.supplier_name ?? null) === clean.supplier_name),
    );
    rows.push({ id: `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, company_id: companyId, ...clean });
    writeLocal(kClasses(companyId), rows);
  }
}

export async function updateDiscountClass(companyId: string, id: string, patch: Partial<DiscountClass>): Promise<void> {
  const p: Partial<DiscountClass> = { ...patch };
  if (p.code != null) p.code = normalizeDiscountCode(p.code);
  if (p.discount_pct != null) p.discount_pct = Math.min(100, Math.max(0, Number(p.discount_pct) || 0));
  if (!id.startsWith('local-')) {
    try {
      const { error } = await raw.from('supplier_discount_classes').update(p).eq('id', id);
      if (error) throw error;
      return;
    } catch (e) {
      if (!isMissingSchema(e)) throw e;
    }
  }
  writeLocal(kClasses(companyId), localClasses(companyId).map((r) => (r.id === id ? { ...r, ...p } : r)));
}

export async function deleteDiscountClass(companyId: string, id: string): Promise<void> {
  if (!id.startsWith('local-')) {
    try {
      const { error } = await raw.from('supplier_discount_classes').delete().eq('id', id);
      if (error) throw error;
      return;
    } catch (e) {
      if (!isMissingSchema(e)) throw e;
    }
  }
  writeLocal(kClasses(companyId), localClasses(companyId).filter((r) => r.id !== id));
}

// ── Plancher de prix (réglage société) ───────────────────────────────────────

// Le seuil et le montant, plus la facon de l'appliquer : 'min' remonte au
// minimum, 'cents' garde les centimes et repart du minimum (choix du client le
// 28/10/2026 : 0,25 EUR donne 2,25 EUR et 1,74 EUR donne 2,74 EUR).
export type PriceFloor = { threshold: number; min: number; mode: FloorMode };

/** Reglage du client : sous 2 EUR, on repart de 2 EUR en gardant les centimes. */
const DEFAULT_FLOOR: PriceFloor = { threshold: 2, min: 2, mode: 'cents' };

export async function getPriceFloor(companyId: string): Promise<PriceFloor> {
  try {
    const { data, error } = await raw
      .from('companies')
      .select('price_floor_threshold, price_floor_min, price_floor_mode')
      .eq('id', companyId)
      .maybeSingle();
    if (error) throw error;
    return {
      threshold: Number(data?.price_floor_threshold ?? DEFAULT_FLOOR.threshold),
      min: Number(data?.price_floor_min ?? DEFAULT_FLOOR.min),
      mode: (data?.price_floor_mode as FloorMode) ?? DEFAULT_FLOOR.mode,
    };
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
    return readLocal<PriceFloor>(kFloor(companyId)) ?? { ...DEFAULT_FLOOR };
  }
}

export function saveLocalPriceFloor(companyId: string, floor: PriceFloor): void {
  writeLocal(kFloor(companyId), floor);
}
