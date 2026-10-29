/**
 * M2 — Traduction des designations a l'entree (I18N002, decision client du 30/10/2026).
 *
 * Chaque nouvelle designation passe par le moteur a deux etages :
 *   1. glossaire mecanique, ici meme, sans reseau (engine.ts) ;
 *   2. Edge Function translate-designations (memoire de traduction, puis Claude)
 *      pour ce que le glossaire ne couvre pas, par lots de 50.
 *
 * Resultat sur l'article : designation = FR (affichee par l'app), designation_i18n =
 * les quatre langues, designation_source = l'original tel que recu, designation_translated_at.
 * Si l'etage 2 echoue (fonction pas deployee, reseau, cle), l'article est quand meme
 * cree avec l'original et designation_translated_at reste NULL : relance possible.
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingSchema, updateArticle, type ArticleInsert, type ArticleUpdate } from '../api';
import { translateWithGlossary, type I18n, type Lang } from './engine';

export type TranslationResult = {
  lang: Lang | '?';
  i18n: I18n;
  from: 'glossaire' | 'memoire' | 'claude';
};

export type TranslateOutcome = {
  /** Texte (tel que donne) -> traduction. Absent = pas traduit (relance possible). */
  results: Map<string, TranslationResult>;
  /** Nombre de textes distincts sans traduction. */
  failed: number;
  /** Raison lisible du premier echec de l'etage 2 (null si tout a reussi). */
  error: string | null;
};

export type TranslateProgress = (done: number, total: number) => void;

const BATCH = 50;
const CONCURRENCY = 3;

type FnItem = { text: string; lang: Lang | '?'; covered: boolean; from: 'glossaire' | 'memoire' | 'claude' | 'aucune'; i18n: I18n | null };
type FnResponse = { data?: FnItem[]; error?: string; detail?: string };

/** Un lot vers l'Edge Function. Jette en cas d'erreur de transport ou de refus. */
async function callFunction(items: { text: string; lang: Lang | null }[], companyId: string): Promise<FnItem[]> {
  const { data, error } = await supabase.functions.invoke('translate-designations', {
    body: { items, companyId },
  });
  if (error) throw new Error(error.message ?? String(error));
  const r = data as FnResponse | null;
  if (!r || !Array.isArray(r.data)) throw new Error(r?.detail ?? r?.error ?? 'translate_failed');
  if (r.error && r.error !== 'incomplete') {
    // La fonction a repondu avec ce qu'elle avait (glossaire, memoire) : on garde, mais on le dit.
    const partial = r.data.filter((d) => d.i18n);
    if (!partial.length) throw new Error(r.detail ?? r.error);
  }
  return r.data;
}

/**
 * Traduit une liste de designations (doublons tolerés). Etage 1 ici, etage 2 par lots.
 * Ne jette jamais : les echecs sont comptes et expliques dans `error`.
 */
export async function translateDesignations(
  texts: (string | null | undefined)[],
  companyId: string,
  opts: { onProgress?: TranslateProgress; sourceLang?: Lang | null } = {},
): Promise<TranslateOutcome> {
  const results = new Map<string, TranslationResult>();
  const distinct = [...new Set(texts.map((t) => (t ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const pending: { text: string; lang: Lang | null }[] = [];
  for (const text of distinct) {
    const g = translateWithGlossary(text, opts.sourceLang ?? null);
    if (g.covered) results.set(text, { lang: g.lang, i18n: g.i18n, from: 'glossaire' });
    else pending.push({ text, lang: opts.sourceLang ?? (g.lang !== '?' ? g.lang : null) });
  }
  const total = distinct.length;
  let done = total - pending.length;
  opts.onProgress?.(done, total);

  let error: string | null = null;
  let stop = false;
  const batches: { text: string; lang: Lang | null }[][] = [];
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH));

  let idx = 0;
  const worker = async () => {
    while (idx < batches.length && !stop) {
      const batch = batches[idx++];
      try {
        const out = await callFunction(batch, companyId);
        for (const d of out) {
          if (d.i18n && d.from !== 'aucune') results.set(d.text, { lang: d.lang, i18n: d.i18n, from: d.from });
        }
      } catch (e) {
        // Premier echec : on arrete d'insister (fonction absente, cle manquante, reseau).
        error = error ?? (e instanceof Error ? e.message : String(e));
        stop = true;
      } finally {
        done += batch.length;
        opts.onProgress?.(Math.min(done, total), total);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  const failed = distinct.filter((t) => !results.has(t)).length;
  return { results, failed, error };
}

/** Traduit UN libelle (saisie manuelle, fiche). */
export async function translateOne(text: string, companyId: string, sourceLang?: Lang | null): Promise<TranslationResult | null> {
  const r = await translateDesignations([text], companyId, { sourceLang });
  return r.results.get(text.replace(/\s+/g, ' ').trim()) ?? null;
}

export type DesignationFields = {
  designation: string;
  designation_source: string;
  designation_source_lang: string | null;
  designation_i18n: I18n | Record<string, never>;
  designation_translated_at: string | null;
};

/**
 * Champs a ecrire sur l'article pour un libelle d'origine et son eventuelle traduction.
 * Sans traduction : designation = original, designation_translated_at = NULL (a relancer).
 */
export function designationFields(source: string, r: TranslationResult | null | undefined, now = new Date().toISOString()): DesignationFields {
  const original = source.replace(/\s+/g, ' ').trim();
  if (!r) {
    return {
      designation: original, designation_source: original, designation_source_lang: null,
      designation_i18n: {}, designation_translated_at: null,
    };
  }
  return {
    designation: r.i18n.fr || original,
    designation_source: original,
    designation_source_lang: r.lang,
    designation_i18n: r.i18n,
    designation_translated_at: now,
  };
}

/**
 * Prepare une creation / modification d'article : la designation saisie passe par le
 * moteur. `preserveSource` garde l'original fournisseur deja en base quand on corrige
 * le libelle FR a la main (l'original n'est jamais reecrit par une correction).
 */
export async function withTranslatedDesignation<T extends ArticleInsert | ArticleUpdate>(
  payload: T,
  companyId: string,
  opts: { preserveSource?: boolean } = {},
): Promise<T> {
  const text = (payload.designation ?? '').trim();
  if (!text) return payload;
  const r = await translateOne(text, companyId);
  const fields = designationFields(text, r);
  const out: Record<string, unknown> = { ...payload, designation: fields.designation, designation_i18n: fields.designation_i18n, designation_translated_at: fields.designation_translated_at };
  if (!opts.preserveSource) {
    out.designation_source = fields.designation_source;
    out.designation_source_lang = fields.designation_source_lang;
  }
  return out as T;
}

export type PendingResult = { translated: number; failed: number; error: string | null };

type PendingRow = { id: string; designation: string; designation_source: string | null; designation_source_lang: string | null };

/**
 * Traduit les articles de la societe qui n'ont pas encore de traduction
 * (designation_translated_at NULL), les plus recents d'abord. Sert apres la creation
 * d'articles par le catalogue Ducati / le site Shopify (fonction SQL
 * article_links_create_missing) et comme relance. Silencieux tant que la migration
 * n'est pas appliquee (colonnes absentes).
 */
export async function translatePendingArticles(
  companyId: string,
  opts: { max?: number; onProgress?: TranslateProgress } = {},
): Promise<PendingResult> {
  const max = opts.max ?? 200;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('articles')
    .select('id, designation, designation_source, designation_source_lang')
    .eq('company_id', companyId)
    .is('designation_translated_at', null)
    .order('created_at', { ascending: false })
    .limit(max);
  if (error) {
    if (isMissingSchema(error)) return { translated: 0, failed: 0, error: null };
    throw error;
  }
  const rows = (data ?? []) as PendingRow[];
  if (!rows.length) return { translated: 0, failed: 0, error: null };

  const sourceOf = (r: PendingRow) => (r.designation_source ?? r.designation ?? '').replace(/\s+/g, ' ').trim();
  const outcome = await translateDesignations(rows.map(sourceOf), companyId, { onProgress: opts.onProgress });

  let translated = 0;
  let failed = 0;
  const queue = rows.slice();
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const row = queue.shift()!;
      const src = sourceOf(row);
      const r = outcome.results.get(src);
      if (!r) { failed++; continue; }
      const f = designationFields(src, r);
      const patch: Record<string, unknown> = {
        designation: f.designation, designation_i18n: f.designation_i18n, designation_translated_at: f.designation_translated_at,
        designation_source_lang: f.designation_source_lang,
      };
      if (!row.designation_source) patch.designation_source = f.designation_source;
      try {
        await updateArticle(row.id, patch as ArticleUpdate);
        translated++;
      } catch {
        failed++;
      }
    }
  });
  await Promise.all(workers);
  return { translated, failed, error: outcome.error };
}

/** Retraduit UN article depuis son original (bouton de la fiche). */
export async function retranslateArticle(
  companyId: string,
  article: { id: string; designation: string; designation_source?: string | null },
): Promise<TranslationResult | null> {
  const src = (article.designation_source ?? article.designation ?? '').replace(/\s+/g, ' ').trim();
  if (!src) return null;
  const r = await translateOne(src, companyId);
  if (!r) return null;
  const f = designationFields(src, r);
  await updateArticle(article.id, {
    designation: f.designation, designation_source: f.designation_source, designation_source_lang: f.designation_source_lang,
    designation_i18n: f.designation_i18n, designation_translated_at: f.designation_translated_at,
  } as ArticleUpdate);
  return r;
}
