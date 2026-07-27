/**
 * M2 — Accès données Articles (RLS : filtré par société).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Article = Database['public']['Tables']['articles']['Row'];
export type ArticleInsert = Database['public']['Tables']['articles']['Insert'];
export type ArticleUpdate = Database['public']['Tables']['articles']['Update'];
export type ArticleMgmtType = Database['public']['Enums']['article_mgmt_type'];
export type KitBillingMode = Database['public']['Enums']['kit_billing_mode'];

/** Libellés des types de gestion (B1). */
export const MGMT_TYPES: { value: ArticleMgmtType; label: string }[] = [
  { value: 'A', label: 'A — Pièce stockée' },
  { value: 'M', label: 'M — Non stockée' },
  { value: 'F', label: 'F — Texte' },
  { value: 'N', label: 'N — Composant forfait' },
  { value: 'V', label: 'V — Véhicule neuf' },
  { value: 'O', label: 'O — Occasion particulier (TVA marge)' },
  { value: 'P', label: 'P — Occasion pro' },
  { value: 'D', label: 'D — Dépôt-vente' },
  { value: 'R', label: 'R — Référence de reprise' },
  { value: 'T', label: "T — Main d'œuvre" },
];

function sanitize(term: string): string {
  // \ est l'échappement LIKE Postgres : retiré, sinon « 1098S\ » ne matche plus rien.
  return term.replace(/[,()%*\\]/g, ' ').trim();
}

/**
 * Colonnes récentes absentes tant que la migration SQL n'est pas appliquée
 * (bandeau « Copier le SQL » sur l'écran d'import). Les écritures retirent la
 * colonne manquante NOMMÉE par l'erreur et réessaient plutôt que d'échouer en bloc.
 */
const OPTIONAL_NEW_COLS = ['bin_location2', 'year_from', 'year_to'] as const;

export function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  // PGRST204/42703 : colonne absente · PGRST205/42P01 : table absente ·
  // PGRST202/42883 : fonction RPC absente (ex. article_facets pas encore migrée)
  return code === 'PGRST205' || code === '42P01' || code === '42703'
    || code === 'PGRST204' || code === 'PGRST202' || code === '42883';
}

/**
 * Colonne nommée par une erreur « colonne manquante » :
 * PGRST204 « Could not find the 'year_from' column of 'articles'… » /
 * 42703 « column "year_from" does not exist ». Sinon null.
 */
export function missingColumn(e: unknown): string | null {
  const err = e as { code?: string; message?: string } | null;
  if (!err || (err.code !== 'PGRST204' && err.code !== '42703')) return null;
  const msg = err.message ?? '';
  const m = /'([A-Za-z0-9_]+)' column/.exec(msg) ?? /column "?([A-Za-z0-9_.]+)"?/.exec(msg);
  const col = m?.[1] ?? null;
  return col ? col.split('.').pop() ?? null : null;
}

export function stripOptionalCols<T extends Record<string, unknown>>(input: T): T {
  const copy: Record<string, unknown> = { ...input };
  for (const k of OPTIONAL_NEW_COLS) delete copy[k];
  return copy as T;
}

/**
 * Retire du payload la colonne optionnelle manquante nommée par l'erreur.
 * Retourne null si rien ne peut être retiré (erreur non récupérable telle quelle) —
 * en dernier recours l'appelant peut retirer tout le groupe (stripOptionalCols).
 */
export function stripMissingCol<T extends Record<string, unknown>>(input: T, e: unknown): T | null {
  const col = missingColumn(e);
  if (col && (OPTIONAL_NEW_COLS as readonly string[]).includes(col) && col in input) {
    const copy: Record<string, unknown> = { ...input };
    delete copy[col];
    return copy as T;
  }
  return null;
}

/** Article + réf. de remplacement embarquée (self-join sur superseded_by_id). */
export type ArticleWithReplacement = Article & { replacement?: { id: string; reference: string } | null };

export type SupplierAvailability = 'green' | 'yellow' | 'red';

/** Colonne ajoutée par la migration 20260726 — pas encore dans les types générés. */
export function getSupplierAvailability(a: Article): SupplierAvailability | null {
  const v = (a as { supplier_availability?: string | null }).supplier_availability;
  return v === 'green' || v === 'yellow' || v === 'red' ? v : null;
}

/** Filtres de la recherche multicritères (page Pièces & Accessoires). */
export type ArticleFilters = {
  search?: string;
  /** contacts type fournisseur (articles.main_supplier_id) */
  supplierId?: string;
  /** année couverte par la plage [year_from, year_to] de l'article */
  year?: number;
  /** codes familles (UID category_path RR-SS-CC) */
  rayon?: string;
  sousRayon?: string;
  categorie?: string;
  brand?: string;
  size?: string;
  color?: string;
  paLocked?: boolean;
  pvLocked?: boolean;
  /** plafond de lignes (défaut 500 ; élargi quand le filtre stock croise côté client) */
  limit?: number;
};

export async function listArticles(companyId: string, filters: ArticleFilters | string = {}): Promise<ArticleWithReplacement[]> {
  const f: ArticleFilters = typeof filters === 'string' ? { search: filters } : filters;
  let q = supabase
    .from('articles')
    .select('*, replacement:superseded_by_id(id, reference)')
    .eq('company_id', companyId)
    .order('designation', { ascending: true })
    .limit(f.limit ?? 500);

  const s = f.search ? sanitize(f.search) : '';
  if (s) {
    q = q.or(
      [`reference.ilike.%${s}%`, `designation.ilike.%${s}%`, `brand.ilike.%${s}%`, `supplier_ref.ilike.%${s}%`].join(','),
    );
  }
  if (f.supplierId) q = q.eq('main_supplier_id', f.supplierId);
  // Familles : catégorie exacte > préfixe sous-rayon > préfixe rayon (UID RR-SS-CC)
  if (f.rayon && f.sousRayon && f.categorie) q = q.eq('category_path', `${f.rayon}-${f.sousRayon}-${f.categorie}`);
  else if (f.rayon && f.sousRayon) q = q.like('category_path', `${f.rayon}-${f.sousRayon}-%`);
  else if (f.rayon) q = q.like('category_path', `${f.rayon}-%`);
  // ilike sans joker = égalité insensible à la casse (les valeurs libres varient : « Ducati »/« DUCATI »).
  // % et _ s'échappent ; * est un alias PostgREST de % SANS échappement possible →
  // pour une valeur contenant *, on retombe sur une égalité stricte (.eq).
  const likeExact = (v: string) => v.replace(/([%_\\])/g, '\\$1').trim();
  const matchExact = (col: 'brand' | 'size' | 'color', v: string) => {
    q = v.includes('*') ? q.eq(col, v.trim()) : q.ilike(col, likeExact(v));
  };
  if (f.brand) matchExact('brand', f.brand);
  if (f.size) matchExact('size', f.size);
  if (f.color) matchExact('color', f.color);
  if (f.paLocked) q = q.eq('price_purchase_locked', true);
  if (f.pvLocked) q = q.eq('price_sale_locked', true);
  // Année : la plage de l'article couvre l'année demandée (bornes nulles = ouvertes,
  // mais au moins une borne renseignée pour ne pas tout matcher).
  if (f.year != null) {
    q = q
      .or(`year_from.lte.${f.year},year_from.is.null`)
      .or(`year_to.gte.${f.year},year_to.is.null`)
      .or('year_from.not.is.null,year_to.not.is.null');
  }

  const { data, error } = await q;
  if (error) {
    if (f.year != null && isMissingSchema(error)) {
      throw new Error('Filtre « Année » indisponible : appliquez la migration SQL (bandeau sur l\'écran Importer un tarif).');
    }
    throw error;
  }
  return (data ?? []) as unknown as ArticleWithReplacement[];
}

/** Valeurs distinctes pour les menus de la recherche multicritères. */
export type ArticleFacets = { brands: string[]; sizes: string[]; colors: string[]; years: number[] };

export async function listArticleFacets(companyId: string): Promise<ArticleFacets> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('article_facets', { _company: companyId });
  if (!error && data) {
    const d = data as Partial<ArticleFacets>;
    return {
      brands: Array.isArray(d.brands) ? d.brands : [],
      sizes: Array.isArray(d.sizes) ? d.sizes : [],
      colors: Array.isArray(d.colors) ? d.colors : [],
      years: Array.isArray(d.years) ? d.years : [],
    };
  }
  if (error && !isMissingSchema(error)) throw error;
  // Repli (fonction pas encore migrée) : distinct côté client sur les 1000 premiers articles.
  const { data: rows, error: e2 } = await supabase
    .from('articles').select('brand, size, color').eq('company_id', companyId).limit(1000);
  if (e2) throw e2;
  const uniq = (vals: (string | null)[]) =>
    [...new Set(vals.map((v) => (v ?? '').trim()).filter((v) => v !== ''))].sort((a, b) => a.localeCompare(b, 'fr'));
  return {
    brands: uniq((rows ?? []).map((r) => r.brand)),
    sizes: uniq((rows ?? []).map((r) => r.size)),
    colors: uniq((rows ?? []).map((r) => r.color)),
    years: [],
  };
}

export async function getArticle(id: string): Promise<Article | null> {
  const { data, error } = await supabase.from('articles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export type PredecessorArticle = Pick<Article, 'id' | 'reference' | 'designation'>;

/** Anciennes références remplacées PAR cet article (superseded_by_id = articleId) — onglet Équivalences. */
export async function listPredecessorArticles(articleId: string): Promise<PredecessorArticle[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('id, reference, designation')
    .eq('superseded_by_id', articleId)
    .order('reference', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Colonnes minimales pour le diff d'import (voir import/rules.ts ExistingArticle). */
export type ArticleLite = Pick<Article,
  'id' | 'reference' | 'designation' | 'brand' | 'category_path' | 'supplier_ref' |
  'purchase_price' | 'sale_price_ttc' | 'coefficient' | 'superseded_by_id' | 'is_library' |
  'ppc_ht' | 'ppc_ttc'> & { year_from?: number | null; year_to?: number | null };

const LITE_COLS = 'id, reference, designation, brand, category_path, supplier_ref, purchase_price, sale_price_ttc, coefficient, superseded_by_id, is_library, ppc_ht, ppc_ttc';

/**
 * Référentiel COMPLET (paginé par 1000) pour l'import de tarifs — listArticles
 * est plafonné à 500 et ne convient pas au croisement d'un gros fichier.
 * Les colonnes year_from/year_to sont incluses si la migration est appliquée.
 */
export async function listAllArticlesLite(companyId: string): Promise<ArticleLite[]> {
  const PAGE = 1000;
  const out: ArticleLite[] = [];
  let withYears = true;
  for (let from = 0; ; from += PAGE) {
    const page = (cols: string) => supabase
      .from('articles')
      .select(cols)
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    let res = await page(withYears ? `${LITE_COLS}, year_from, year_to` : LITE_COLS);
    if (res.error && withYears && isMissingSchema(res.error)) {
      withYears = false;
      res = await page(LITE_COLS);
    }
    if (res.error) throw res.error;
    const data = (res.data ?? []) as unknown as ArticleLite[];
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Écrit en retirant UNE À UNE les colonnes optionnelles manquantes nommées par
 * l'erreur (migration partielle : ne PAS jeter bin_location2 si seule year_from
 * manque). Repli « tout le groupe » uniquement si la colonne n'est pas identifiable.
 */
async function writeResilient(
  input: Record<string, unknown>,
  run: (payload: Record<string, unknown>) => PromiseLike<{ data: Article | null; error: { code?: string; message?: string } | null }>,
  onEmptyPayload: () => Promise<Article>,
): Promise<Article> {
  let payload = { ...input };
  for (let attempt = 0; attempt <= OPTIONAL_NEW_COLS.length; attempt++) {
    if (Object.keys(payload).length === 0) return onEmptyPayload();
    const res = await run(payload);
    if (!res.error) return res.data as Article;
    if (!isMissingSchema(res.error)) throw res.error;
    const narrowed = stripMissingCol(payload, res.error);
    if (narrowed) { payload = narrowed; continue; }
    const stripped = stripOptionalCols(payload);
    if (Object.keys(stripped).length === Object.keys(payload).length) throw res.error; // plus rien à retirer
    payload = stripped;
  }
  throw new Error('articles: colonnes manquantes irrécupérables (migration à appliquer)');
}

export async function createArticle(input: ArticleInsert): Promise<Article> {
  const created = await writeResilient(
    input as Record<string, unknown>,
    (p) => supabase.from('articles').insert(p as ArticleInsert).select().single(),
    async () => { throw new Error('createArticle: payload vide'); },
  );
  // La référence sert de code-barres par défaut (demande client) : best-effort, ne bloque
  // jamais la création (table article_barcodes pas encore migrée, doublon, etc.).
  try {
    await addBarcode(created.id, created.reference);
  } catch {
    // silencieux : la fiche reste utilisable sans code-barres par défaut
  }
  return created;
}

export async function updateArticle(id: string, input: ArticleUpdate): Promise<Article> {
  return writeResilient(
    input as Record<string, unknown>,
    (p) => supabase.from('articles').update(p as ArticleUpdate).eq('id', id).select().single(),
    async () => {
      // Il ne restait que des colonnes pas encore migrées : rien à écrire.
      const { data, error } = await supabase.from('articles').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
  );
}

/**
 * Modifie les prix d'un article en TRAÇANT l'origine (price_changes append-only, B7).
 * À utiliser pour toute modification de prix (cascade, fiche, import) au lieu d'un
 * UPDATE direct. N'écrit que les champs fournis.
 */
export async function recordPriceChange(
  articleId: string,
  p: { purchase?: number; saleHt?: number; saleTtc?: number; coef?: number; origin?: string },
): Promise<void> {
  const { error } = await supabase.rpc('record_price_change', {
    _article: articleId, _purchase: p.purchase ?? null, _sale_ht: p.saleHt ?? null,
    _sale_ttc: p.saleTtc ?? null, _coef: p.coef ?? null, _origin: p.origin ?? 'screen',
  });
  if (error) throw error;
}

export type PriceChange = Database['public']['Tables']['price_changes']['Row'];
/** Historique des changements de prix d'un article (le plus récent d'abord). */
export async function listPriceChanges(articleId: string): Promise<PriceChange[]> {
  const { data, error } = await supabase
    .from('price_changes').select('*').eq('article_id', articleId)
    .order('occurred_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

/** Ajoute un code-barres à un article (ignore les doublons). */
export async function addBarcode(articleId: string, barcode: string): Promise<void> {
  const { error } = await supabase
    .from('article_barcodes')
    .upsert({ article_id: articleId, barcode }, { onConflict: 'article_id,barcode', ignoreDuplicates: true });
  if (error) throw error;
}

async function nextCopyReference(companyId: string, baseReference: string): Promise<string> {
  const base = `${baseReference}-COPIE`;
  const { data, error } = await supabase
    .from('articles').select('reference').eq('company_id', companyId).ilike('reference', `${base}%`);
  if (error) throw error;
  const taken = new Set((data ?? []).map((r) => r.reference));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Duplique un article : copie les champs descriptifs/prix/classification/famille/
 * fournisseur, nouvelle référence (« -COPIE », suffixe numérique si déjà prise),
 * stock remis à zéro (aucun stock_move copié, B7). Retourne le nouvel id.
 */
export async function duplicateArticle(articleId: string): Promise<string> {
  const source = await getArticle(articleId);
  if (!source) throw new Error('duplicateArticle: article introuvable');
  const {
    id: _id, created_at: _createdAt, updated_at: _updatedAt, created_by: _createdBy, reference: _reference,
    pamp: _pamp, last_purchased_at: _lastPurchasedAt, last_sold_at: _lastSoldAt, last_tariff_at: _lastTariffAt,
    superseded_by_id: _supersededById, origin_reference_id: _originReferenceId,
    ...rest
  } = source;
  const reference = await nextCopyReference(source.company_id, source.reference);
  const created = await createArticle({ ...rest, reference } as ArticleInsert);
  return created.id;
}
