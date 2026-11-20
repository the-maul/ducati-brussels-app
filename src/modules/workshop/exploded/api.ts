/**
 * M8 — Vues éclatées depuis l'OR (lot E, 19/11/2026) : accès base.
 *
 * Lecture : catalogue Ducati (ducati_catalog_*, RLS : comptes de l'équipe), articles de la société
 * active, moto de l'OR / de la picking list. Écriture : uniquement « Réserver »
 * (workshop_reservation_add, migration 20261119280000), le mécanisme de réservation existant.
 * Les images restent chez Ducati (liens e-catalog.ducati.com) : rien n'est copié ici.
 */
import { supabase } from '@/integrations/supabase/client';
import type { CatalogOrLine, DrawingOrder, LineHit, Location, PricedArticle, ReserveLineResult, ReserveResult } from './rules';
import { locateInDrawings, normalizeCatalogReference } from './rules';

type Res<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;
type Q<T> = Res<T> & {
  select: (c: string) => Q<T>; eq: (c: string, v: unknown) => Q<T>; in: (c: string, v: readonly unknown[]) => Q<T>;
  or: (f: string) => Q<T>; not: (c: string, op: string, v: unknown) => Q<T>; order: (c: string, o?: { ascending?: boolean }) => Q<T>;
  limit: (n: number) => Q<T>; maybeSingle: () => Res<T>;
};
const sb = supabase as unknown as {
  from: <T = unknown>(t: string) => Q<T>;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

/** Fonction absente (migration non appliquée). */
export function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = String((e as { message?: string } | null)?.message ?? '');
  return ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'].includes(code) || /Could not find|does not exist|schema cache/i.test(msg);
}

export type ModelYearInfo = { id: string; year: number | null; code: string | null; model: string | null };

/** Modèle et année d'un modèle-année du catalogue (titre de la fenêtre). */
export async function getModelYearInfo(modelYearId: string): Promise<ModelYearInfo | null> {
  const { data, error } = await sb.from<{ id: string; year: number | null; code: string | null; model: { description: string | null } | null }>('ducati_catalog_model_years')
    .select('id, year, code, model:ducati_catalog_models(description)').eq('id', modelYearId).maybeSingle();
  if (error) throw new Error(error.message);
  const d = data as unknown as { id: string; year: number | null; code: string | null; model: { description: string | null } | null } | null;
  return d ? { id: d.id, year: d.year, code: d.code, model: d.model?.description ?? null } : null;
}

/**
 * Où est la référence dans les vues éclatées du modèle-année ? Deux lectures : les vues du
 * modèle-année (ordre du catalogue), puis leurs lignes portant la référence ou une référence
 * remplacée (index unique (drawing_id, line_no)).
 */
export async function locateReference(modelYearId: string, reference: string): Promise<Location[]> {
  const ref = normalizeCatalogReference(reference);
  if (!ref) return [];
  const { data: order, error } = await sb.from<DrawingOrder[]>('ducati_catalog_model_year_drawings')
    .select('drawing_id, group_sort, sort').eq('model_year_id', modelYearId).order('group_sort').order('sort');
  if (error) throw new Error(error.message);
  const rows = (order ?? []) as DrawingOrder[];
  const ids = [...new Set(rows.map((r) => r.drawing_id))];
  const hits: LineHit[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error: e2 } = await sb.from<LineHit[]>('ducati_catalog_drawing_lines')
      .select('drawing_id, position, line_no, reference_norm, replaced_part')
      .in('drawing_id', ids.slice(i, i + 150))
      .or(`reference_norm.eq.${ref},replaced_part.not.is.null`);
    if (e2) throw new Error(e2.message);
    hits.push(...((data ?? []) as LineHit[]));
  }
  return locateInDrawings(ref, hits, rows);
}

/**
 * Références à chercher pour un article du DMS : sa référence, puis les références Ducati qui
 * lui sont reliées (article_links « lié », décision M-25 : elles peuvent différer), puis les
 * anciennes références qu'il remplace. Sans doublon, dans cet ordre.
 */
export async function articleCatalogRefs(articleId: string): Promise<string[]> {
  const a = await getPricedArticle(articleId);
  const refs = a?.reference ? [a.reference] : [];
  const { data, error } = await sb.from<{ target_ref: string }[]>('article_links')
    .select('target_ref').eq('article_id', articleId).eq('target_kind', 'ducati_part').eq('status', 'lie');
  if (!error) refs.push(...((data ?? []) as { target_ref: string }[]).map((l) => l.target_ref));
  // Les vues Ducati montrent souvent l'ANCIENNE référence (« remplacée » sans la nouvelle, 19/11) :
  // on cherche aussi les articles que celui-ci remplace (superseded_by_id), deux niveaux.
  let current = [articleId];
  for (let level = 0; level < 2 && current.length; level++) {
    const { data: olds, error: e3 } = await sb.from<{ id: string; reference: string }[]>('articles')
      .select('id, reference').in('superseded_by_id', current).limit(20);
    if (e3) break;
    const rows = (olds ?? []) as { id: string; reference: string }[];
    refs.push(...rows.map((o) => o.reference));
    current = rows.map((o) => o.id);
  }
  const seen = new Set<string>();
  return refs.filter((r) => { const k = normalizeCatalogReference(r); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** Première référence de la liste retrouvée dans les vues du modèle-année (sinon : aucune). */
export async function locateFirst(modelYearId: string, refs: readonly string[]): Promise<{ reference: string | null; locations: Location[] }> {
  for (const r of refs) {
    const locations = await locateReference(modelYearId, r);
    if (locations.length) return { reference: r, locations };
  }
  return { reference: refs[0] ?? null, locations: [] };
}

/** État au tarif Ducati des articles (green / yellow remplacée / red fin de série). */
export async function articleSupply(ids: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await sb.from<{ id: string; supplier_availability: string | null }[]>('articles')
      .select('id, supplier_availability').in('id', uniq.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as { id: string; supplier_availability: string | null }[]) out.set(a.id, a.supplier_availability ?? null);
  }
  return out;
}

/** L'article à chiffrer (ligne d'OR). */
export async function getPricedArticle(articleId: string): Promise<PricedArticle | null> {
  const { data, error } = await sb.from<PricedArticle>('articles')
    .select('id, reference, designation, sale_price_ht, sale_price_ttc, vat_rate').eq('id', articleId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PricedArticle | null) ?? null;
}

/** « Réserver » une pièce pour l'OR (migration 20261119280000). `null` = fonction absente. */
export async function reserveForOr(orId: string, articleId: string, qty: number): Promise<ReserveResult | null> {
  const { data, error } = await sb.rpc('workshop_reservation_add', { _or: orId, _article: articleId, _qty: qty, _source: 'vue_eclatee' });
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    already: d.already === true, qtyNeeded: n(d.qty_needed), qtyReserved: n(d.qty_reserved), qtyToOrder: n(d.qty_to_order),
    basketKind: d.basket_kind == null ? null : String(d.basket_kind), orderBlocked: d.order_blocked === true,
  };
}

/**
 * Q59 (20/11/2026) : « Reserver » + ligne de l'OR en une transaction (migration 20261120103000).
 * `null` = fonction absente (migration non appliquee) : l'ecran reserve seulement, comme avant.
 */
export async function reserveForOrWithLine(orId: string, articleId: string, qty: number, line: CatalogOrLine | null): Promise<ReserveLineResult | null> {
  const { data, error } = await sb.rpc('workshop_reservation_add_line', {
    _or: orId, _article: articleId, _qty: qty, _source: 'vue_eclatee',
    _line: line ? { designation: line.designation, unit_price_ht: line.unit_price_ht, vat_rate: line.vat_rate, discount_pct: line.discount_pct } : null,
  });
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const l = d.line as Record<string, unknown> | null | undefined;
  const st = String(d.line_status ?? 'kept');
  return {
    already: d.already === true, qtyNeeded: n(d.qty_needed), qtyReserved: n(d.qty_reserved), qtyToOrder: n(d.qty_to_order),
    basketKind: d.basket_kind == null ? null : String(d.basket_kind), orderBlocked: d.order_blocked === true,
    lineStatus: st === 'created' || st === 'adjusted' ? st : 'kept', lineQty: n(d.line_qty),
    line: l ? {
      kind: 'piece', article_id: articleId, designation: String(l.designation ?? ''), quantity: n(l.quantity),
      unit_price_ht: n(l.unit_price_ht), vat_rate: n(l.vat_rate), discount_pct: n(l.discount_pct), is_warranty: l.is_warranty === true,
    } : null,
  };
}

/** Moto d'une picking list (OR, RDV ou document de vente) → son modèle-année du catalogue. */
export async function pickingModelYear(pickingId: string): Promise<string | null> {
  const { data: p, error } = await sb.from<Record<string, string | null>>('picking_lists').select('*').eq('id', pickingId).maybeSingle();
  if (error || !p) return null;
  const row = p as Record<string, string | null>;
  const from = async (table: string, id: string | null | undefined) => {
    if (!id) return null;
    const { data } = await sb.from<{ vehicle_id: string | null }>(table).select('vehicle_id').eq('id', id).maybeSingle();
    return (data as { vehicle_id: string | null } | null)?.vehicle_id ?? null;
  };
  const vehicleId = (await from('repair_orders', row.repair_order_id))
    ?? (await from('workshop_appointments', row.appointment_id))
    ?? (await from('documents', row.document_id));
  if (!vehicleId) return null;
  const { data: v } = await sb.from<{ ducati_model_year_id: string | null }>('vehicles').select('ducati_model_year_id').eq('id', vehicleId).maybeSingle();
  return (v as { ducati_model_year_id: string | null } | null)?.ducati_model_year_id ?? null;
}
