/**
 * Rattrapage G8 (18/11/2026, lot parc) — affichettes : modeles enregistres (`poster_templates`,
 * migration 20261118142000, absente de types.ts : acces non type) et donnees des motos / articles.
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import type { PosterArticle, PosterKind, PosterVehicle } from './poster-rules';
import { isMissingSchemaError } from './fiche-g8-api';

type PgErr = { code?: string; message: string };
type Res = { data?: unknown; error: PgErr | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

export type PosterTemplate = { id: string; kind: PosterKind; name: string; body: string; per_page: 1 | 2; is_default: boolean };

/** Modeles de la societe ; [] si la migration n'est pas encore appliquee (le modele d'office sert). */
export async function listPosterTemplates(companyId: string, kind: PosterKind): Promise<{ rows: PosterTemplate[]; ready: boolean }> {
  const { data, error }: Res = await db.from('poster_templates').select('id, kind, name, body, per_page, is_default')
    .eq('company_id', companyId).eq('kind', kind).order('name', { ascending: true });
  if (error) {
    if (isMissingSchemaError(error)) return { rows: [], ready: false };
    throw new Error(error.message);
  }
  return { rows: (data ?? []) as PosterTemplate[], ready: true };
}

export async function savePosterTemplate(companyId: string, p: { id?: string | null; kind: PosterKind; name: string; body: string; perPage: 1 | 2 }): Promise<string> {
  const row = { company_id: companyId, kind: p.kind, name: p.name.trim(), body: p.body, per_page: p.perPage };
  const q = p.id
    ? db.from('poster_templates').update(row).eq('id', p.id).select('id').single()
    : db.from('poster_templates').insert(row).select('id').single();
  const { data, error }: Res = await q;
  if (error) throw new Error(isMissingSchemaError(error) ? t('parcG8.migrationMissing') : error.message);
  return String((data as { id: string }).id);
}

export async function deletePosterTemplate(id: string): Promise<void> {
  const { error }: Res = await db.from('poster_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export type PosterVehicleRow = PosterVehicle & { id: string; article_id: string | null; mgmt_type: string | null };

const VEHICLE_COLS = 'id, article_id, reference, brand, model, vin, display_price, mileage, first_registration_date, model_year, displacement, power_kw, power_cv, color, color_code, energy, antipollution, cylinders, category, plate, engine_number, type_mine, genre, fiscal_power, police_book_number, exposition_code, warranty_type';

export async function loadPosterVehicles(ids: string[]): Promise<PosterVehicleRow[]> {
  if (!ids.length) return [];
  // warranty_months : colonne de la migration 20261118141000, lue a part (tolerante).
  const { data, error }: Res = await db.from('vehicles').select(`${VEHICLE_COLS}, warranty_months, article:article_id(mgmt_type)`).in('id', ids);
  let rows = data as (PosterVehicle & { id: string; article_id: string | null; article?: { mgmt_type: string | null } | null })[] | null;
  if (error) {
    const retry: Res = await db.from('vehicles').select(`${VEHICLE_COLS}, article:article_id(mgmt_type)`).in('id', ids);
    if (retry.error) throw new Error(retry.error.message);
    rows = retry.data as typeof rows;
  }
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ ...r, mgmt_type: r.article?.mgmt_type ?? null }));
}

export type PosterArticleRow = PosterArticle & { id: string };

export async function loadPosterArticles(ids: string[]): Promise<PosterArticleRow[]> {
  if (!ids.length) return [];
  const { data, error }: Res = await db.from('articles').select('id, reference, designation, brand, sale_price_ttc, sale_price_ht, vat_rate').in('id', ids);
  if (error) throw new Error(error.message);
  // Code-barres principal (table article_barcodes) pour la balise [CODEBARRE].
  const bc: Res = await db.from('article_barcodes').select('article_id, barcode, is_primary').in('article_id', ids);
  const barcodes = new Map<string, string>();
  for (const b of ((bc.data ?? []) as { article_id: string; barcode: string; is_primary: boolean }[])) {
    if (!barcodes.has(b.article_id) || b.is_primary) barcodes.set(b.article_id, b.barcode);
  }
  const byId = new Map(((data ?? []) as PosterArticleRow[]).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is PosterArticleRow => !!r)
    .map((r) => ({
      ...r, barcode: barcodes.get(r.id) ?? null,
      sale_price_ttc: r.sale_price_ttc != null ? Number(r.sale_price_ttc) : null,
      sale_price_ht: r.sale_price_ht != null ? Number(r.sale_price_ht) : null,
    }));
}
