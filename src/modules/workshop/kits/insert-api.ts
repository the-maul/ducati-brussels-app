/**
 * Rattrapage G8 (18/11/2026, lot parc) — insertion d'un kit / forfait en lignes, remplacement
 * d'une reference dans tous les kits. Lecture des kits existants (kits d'entretien + forfaits
 * d'article) ; ecriture du remplacement par `kits_replace_article` (migration 20261118143000).
 */
import { supabase } from '@/integrations/supabase/client';
import { getKitDetail, listKits } from './api';
import type { KitComponent, PricedArticle } from './insert-rules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };
type Res = { data?: unknown; error: { code?: string; message: string } | null };

export type KitChoice = {
  source: 'entretien' | 'forfait';
  id: string;                 // id du kit d'entretien, ou id de l'article forfait
  label: string;
  detail: string;             // famille moteur, ou reference du forfait
  forMoto: boolean;           // kit rattache au modele-annee de la moto
  forfaitPriceTtc: number | null;
};

/** Kits d'entretien (ceux de la moto en tete) + forfaits d'article, filtres par la recherche. */
export async function listKitChoices(companyId: string, search: string, modelYearId?: string | null): Promise<KitChoice[]> {
  const out: KitChoice[] = [];
  let motoKits = new Set<string>();
  if (modelYearId) {
    const r: Res = await db.from('maintenance_kit_model_years').select('kit_id').eq('model_year_id', modelYearId);
    if (!r.error) motoKits = new Set(((r.data ?? []) as { kit_id: string }[]).map((x) => x.kit_id));
  }
  try {
    const kits = await listKits(companyId, search.trim() || null);
    for (const k of kits) {
      if (k.status !== 'actif') continue;
      out.push({
        source: 'entretien', id: k.id, label: k.serviceLabel, detail: k.engineFamilyLabel,
        forMoto: motoKits.has(k.id), forfaitPriceTtc: null,
      });
    }
  } catch { /* kits d'entretien indisponibles (migration) : les forfaits restent proposes */ }

  const f: Res = await db.from('article_kit_items')
    .select('kit_id, kit:kit_id(id, reference, designation, company_id, sale_price_ttc)').limit(5000);
  if (!f.error) {
    const seen = new Set<string>();
    const q = search.trim().toUpperCase();
    for (const row of (f.data ?? []) as { kit: { id: string; reference: string; designation: string; company_id: string; sale_price_ttc: number | null } | null }[]) {
      const k = row.kit;
      if (!k || k.company_id !== companyId || seen.has(k.id)) continue;
      if (q && !`${k.reference} ${k.designation}`.toUpperCase().includes(q)) continue;
      seen.add(k.id);
      out.push({
        source: 'forfait', id: k.id, label: k.designation, detail: k.reference, forMoto: false,
        forfaitPriceTtc: k.sale_price_ttc != null && Number(k.sale_price_ttc) > 0 ? Number(k.sale_price_ttc) : null,
      });
    }
  }
  return out.sort((a, b) => Number(b.forMoto) - Number(a.forMoto) || a.label.localeCompare(b.label)).slice(0, 200);
}

/** Composants d'un kit choisi. */
export async function kitComponents(choice: Pick<KitChoice, 'source' | 'id'>): Promise<KitComponent[]> {
  if (choice.source === 'entretien') {
    const lines = await getKitDetail(choice.id);
    return lines.map((l) => ({ articleId: l.articleId, reference: l.reference, designation: l.designation, quantity: l.quantity }));
  }
  // Ordre de la fiche (sort_order, migration 20261119140000 : forfaits G8 repris dans l'ordre de G8).
  const r: Res = await db.from('article_kit_items').select('quantity, sort_order, component:component_id(id, reference, designation)')
    .eq('kit_id', choice.id).order('sort_order', { ascending: true });
  if (r.error) throw new Error(r.error.message);
  return ((r.data ?? []) as { quantity: number; component: { id: string; reference: string; designation: string } | null }[])
    .filter((x) => x.component)
    .map((x) => ({ articleId: x.component!.id, reference: x.component!.reference, designation: x.component!.designation, quantity: Number(x.quantity) }));
}

/** Prix et type des articles (composants et forfait). */
export async function pricedArticles(ids: string[]): Promise<Map<string, PricedArticle>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const r: Res = await db.from('articles').select('id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate').in('id', uniq);
  if (r.error) throw new Error(r.error.message);
  return new Map(((r.data ?? []) as PricedArticle[]).map((a) => [a.id, {
    ...a, sale_price_ht: a.sale_price_ht != null ? Number(a.sale_price_ht) : null,
    sale_price_ttc: a.sale_price_ttc != null ? Number(a.sale_price_ttc) : null, vat_rate: a.vat_rate != null ? Number(a.vat_rate) : null,
  }]));
}

export type ReplaceResult = { applique: boolean; kits_entretien: number; fusionnes_entretien: number; forfaits: number; fusionnes_forfaits: number; ancienne: string; nouvelle: string };

/** Remplace une reference dans tous les kits (apercu si `apply` = false). */
export async function replaceArticleInKits(companyId: string, oldId: string, newId: string, apply: boolean): Promise<ReplaceResult> {
  const r: Res = await db.rpc('kits_replace_article', { _company: companyId, _old: oldId, _new: newId, _apply: apply });
  if (r.error) throw new Error(r.error.message);
  return r.data as ReplaceResult;
}
