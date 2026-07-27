/**
 * M2 — Applicabilités articles (compatibilité modèle/année, pièces Ducati).
 * Table : article_applicabilities (migration 20260726). Hors types Supabase
 * auto-générés → casts localisés (pattern tradein/partners-api.ts).
 *
 * Format CSV attendu (ex. applicabilitiesList_<reference>.csv, séparateur ';',
 * encodage UTF-8 BOM) :
 *   1re ligne  : <reference>;<designation>;;
 *   lignes sv. : <gamme>;<annee>;<modele>;<quantite>
 * Un fichier = une référence article, avec N lignes de compatibilité.
 */
import { supabase } from '@/integrations/supabase/client';
import { parseCsv } from './import/parse';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

const CHUNK_SIZE = 500;

export type ArticleApplicability = {
  id: string;
  company_id: string;
  article_id: string | null;
  reference: string;
  gamme: string | null;
  model_year: number | null;
  model: string | null;
  quantity: number;
  created_at: string;
};

export type ApplicabilityImportResult = {
  reference: string;
  inserted: number;
  articleLinked: boolean;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Applicabilités déjà rattachées à un article (fiche article, article_id connu). */
export async function listApplicabilitiesForArticle(articleId: string): Promise<ArticleApplicability[]> {
  const { data, error } = await raw
    .from('article_applicabilities').select('*')
    .eq('article_id', articleId)
    .order('model_year', { ascending: true }).order('model', { ascending: true });
  if (error) throw error;
  return (data as ArticleApplicability[]) ?? [];
}

/** Repli par référence (import non encore rattaché à l'article_id au moment de l'import). */
export async function listApplicabilitiesByReference(companyId: string, reference: string): Promise<ArticleApplicability[]> {
  const { data, error } = await raw
    .from('article_applicabilities').select('*')
    .eq('company_id', companyId).eq('reference', reference)
    .order('model_year', { ascending: true }).order('model', { ascending: true });
  if (error) throw error;
  return (data as ArticleApplicability[]) ?? [];
}

/** Importe un CSV d'applicabilité (une référence par fichier). Réimport = remplacement (idempotence best-effort). */
export async function importApplicabilityCsv(companyId: string, csvText: string): Promise<ApplicabilityImportResult> {
  const { headers, rows } = parseCsv(csvText.replace(/^\uFEFF/, ''));
  const reference = (headers[0] ?? '').trim();
  if (!reference) throw new Error('Référence article introuvable en 1re ligne du CSV.');

  const { data: article, error: articleErr } = await raw
    .from('articles').select('id')
    .eq('company_id', companyId).eq('reference', reference).maybeSingle();
  if (articleErr) throw articleErr;
  const articleId: string | null = article?.id ?? null;

  const { error: delErr } = await raw
    .from('article_applicabilities').delete()
    .eq('company_id', companyId).eq('reference', reference);
  if (delErr) throw delErr;

  const entries = rows
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => ({
      company_id: companyId,
      article_id: articleId,
      reference,
      gamme: r[0]?.trim() || null,
      model_year: r[1]?.trim() ? Number(r[1].trim()) || null : null,
      model: r[2]?.trim() || null,
      quantity: r[3]?.trim() ? Number(r[3].trim().replace(',', '.')) || 1 : 1,
    }));

  for (const batch of chunk(entries, CHUNK_SIZE)) {
    const { error } = await raw.from('article_applicabilities').insert(batch);
    if (error) throw error;
  }

  return { reference, inserted: entries.length, articleLinked: articleId != null };
}
