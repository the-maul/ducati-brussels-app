/**
 * « Article DMS = pivot » (missions 03 + 06, décision M-25) — règles pures du rapprochement.
 *
 * La base fait foi (fonction SQL article_links_refresh, migration 20260921200000) ; ces règles
 * en sont le miroir testé (tests/article-links.test.ts) et servent à l'écran (libellés, scores,
 * familles de l'aperçu « créer les articles manquants »).
 */
import { normalizeCatalogReference } from '@/modules/catalog/reference';

export type LinkKind = 'ducati_part' | 'ducati_product' | 'shopify_variant' | 'g8';
export type LinkStatus = 'lie' | 'a_valider' | 'rejete';
export type LinkMethod =
  | 'ref_exacte'
  | 'prefixe_suffixe'
  | 'revision'
  | 'remplacement_dms'
  | 'sku_exact'
  | 'code_barres'
  | 'sku_normalise'
  | 'code_barres_ref'
  | 'ref_dans_titre'
  | 'manuel'
  | 'occasion'
  | 'sku_ambigu'
  | 'creation'
  | 'creation_sans_sku'
  | 'import_g8';

/** Forme compacte d'une référence : majuscules, uniquement A-Z0-9 (= ducati_catalog_norm_ref). */
export const normRef = normalizeCatalogReference;

/**
 * Méthodes reliées d'emblée : correspondances exactes (automatique sûr) et lien posé à la main.
 * Toutes les autres sont proposées « à valider ».
 */
const LINKED_METHODS: ReadonlySet<LinkMethod> = new Set([
  'ref_exacte', 'sku_exact', 'code_barres', 'manuel', 'occasion', 'creation', 'import_g8',
]);

/** Score de confiance (0-100) de chaque méthode, identique à la base. */
export const METHOD_SCORE: Record<LinkMethod, number> = {
  ref_exacte: 100,
  sku_exact: 100,
  code_barres: 100,
  manuel: 100,
  creation: 100,
  import_g8: 100,
  occasion: 95,
  sku_normalise: 90,
  sku_ambigu: 90,
  code_barres_ref: 85,
  ref_dans_titre: 80,
  remplacement_dms: 60,
  revision: 50,
  creation_sans_sku: 60,
  prefixe_suffixe: 40,
};

/**
 * Score d'un candidat. Un produit Shopify « copié » (titre « (Copie) … », « Copie de … ») garde souvent
 * la référence de l'original : score abaissé à 60. Le remplacement vaut 70 côté Shopify (le produit
 * cite l'ancienne référence d'un article du DMS), 60 côté catalogue Ducati. Une révision n'est à 50
 * que si les deux références finissent par UNE lettre (indice) ; deux ou trois lettres désignent
 * souvent une couleur (AA, AK, AW…) : 35.
 */
export function candidateScore(
  method: LinkMethod,
  opts: { copy?: boolean; kind?: LinkKind; articleRef?: string; catalogRef?: string } = {},
): number {
  if (method === 'ref_dans_titre' && opts.copy) return 60;
  if (method === 'remplacement_dms' && opts.kind === 'shopify_variant') return 70;
  if (method === 'revision' && opts.articleRef && opts.catalogRef) {
    const oneLetter = (r: string) => /\d[A-Z]$/.test(normRef(r));
    return oneLetter(opts.articleRef) && oneLetter(opts.catalogRef) ? 50 : 35;
  }
  return METHOD_SCORE[method];
}

export function initialStatus(method: LinkMethod): LinkStatus {
  return LINKED_METHODS.has(method) ? 'lie' : 'a_valider';
}

/** Ton du badge de score (charte : couleur + icône + libellé ; jamais le rouge marque). */
export function scoreTone(score: number): 'success' | 'info' | 'warning' {
  if (score >= 90) return 'success';
  if (score >= 70) return 'info';
  return 'warning';
}

/**
 * Numéro de pièce sans son indice de révision (1 à 3 lettres finales après un chiffre) :
 * 48018871AA → 48018871 ; 4801C181AA → 4801C181 ; 981090260 → null (pas d'indice).
 */
export function refBase(ref: string | null | undefined): string | null {
  const n = normRef(ref);
  const m = n.match(/^(.*\d)[A-Z]{1,3}$/);
  return m ? m[1] : null;
}

/**
 * Candidat « même pièce, autre indice de révision » (miroir de l'étape C du rapprochement) :
 * l'article n'est pas dans le catalogue, son numéro sans indice fait au moins 7 caractères,
 * ce n'est pas une notice (913…, une lettre = une langue), et UNE seule référence Ducati
 * porte ce numéro (plusieurs = couleurs ou langues différentes : pas de proposition).
 */
export function revisionCandidate(articleRef: string, catalogRefs: readonly string[]): string | null {
  const n = normRef(articleRef);
  const catalog = catalogRefs.map(normRef);
  if (catalog.includes(n)) return null;
  const b = refBase(n);
  if (!b || b.length < 7 || b.startsWith('913')) return null;
  const same = catalog.filter((c) => refBase(c) === b);
  return same.length === 1 ? same[0] : null;
}

/** Pièce d'occasion vendue sur le site (SKU contenant « OCC », « occ. » / « occasion » dans le titre). */
export function isUsedPart(sku: string | null | undefined, title?: string | null, variantTitle?: string | null): boolean {
  if (/OCC/.test(normRef(sku))) return true;
  const txt = `${title ?? ''} ${variantTitle ?? ''}`;
  return /(^|[^a-z0-9])occ([^a-z0-9]|$)|occasion/i.test(txt);
}

/** Produit Shopify dupliqué (« (Copie) … », « Copie de … », « Copy of … »). */
export function isCopiedProduct(title: string | null | undefined): boolean {
  return /^\s*\(?\s*cop(ie|y)/i.test(title ?? '');
}

/**
 * Références citées dans le titre d'un produit Shopify : mots de 7 à 12 caractères A-Z0-9
 * commençant par un chiffre, hors « …OCC » (occasion). Même découpage que la base.
 */
export function titleRefTokens(title: string | null | undefined, variantTitle?: string | null): string[] {
  const txt = `${title ?? ''} ${variantTitle ?? ''}`.toUpperCase();
  const out = new Set<string>();
  for (const tok of txt.split(/[^A-Z0-9]+/)) {
    if (tok.length >= 7 && tok.length <= 12 && /^[0-9]/.test(tok) && !/OCC$/.test(tok)) out.add(tok);
  }
  return [...out];
}

/**
 * Désignation « nue » pour comparaison : majuscules, sans accent, séparateurs réduits à un espace.
 * Miroir de la fonction SQL _al_norm_desig (migration 20260923140000).
 */
export function normDesignation(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Part des mots de `a` (3 lettres et plus) que l'on retrouve dans `b`, de 0 à 1.
 * Miroir de _al_desig_ratio. Asymétrique : on cherche la désignation DANS le titre du site.
 */
export function designationRatio(a: string | null | undefined, b: string | null | undefined): number {
  const words = (t: string | null | undefined) =>
    new Set(normDesignation(t).split(' ').filter((w) => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let n = 0;
  for (const w of wa) if (wb.has(w)) n += 1;
  return Math.round((n / wa.size) * 1000) / 1000;
}

/** Premier mot d'un titre de produit (les boutiques préfixent le titre par la référence). */
export function firstToken(title: string | null | undefined): string {
  return (title ?? '').toUpperCase().split(/[^A-Z0-9]+/).find((w) => w !== '') ?? '';
}

/** Écart de prix relatif (0,03 = 3 %). `null` si l'un des deux prix manque. */
export function priceGap(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.abs(a - b) / b;
}

/**
 * Faisceau d'indices d'un candidat Shopify (miroir de la règle R2 d'article_links_autoresolve,
 * migration 20260923140000). Étalon donné par Simon le 23/09 : référence 46010383A, SKU
 * 46010383A, même désignation, même prix → relié d'office, sans validation humaine.
 *
 * Relié d'office si : (SKU exact OU référence en tête du titre)
 *   ET (désignation retrouvée à 70 % dans le titre OU prix à 5 % près)
 *   ET aucun SKU ne désigne un autre article du DMS.
 * L'unicité (un seul candidat qualifié par variante et par article) est vérifiée par la base.
 */
export function bundleQualifies(v: {
  articleRef: string;
  designation?: string | null;
  salePriceTtc?: number | null;
  sku?: string | null;
  productTitle?: string | null;
  variantTitle?: string | null;
  shopPrice?: number | null;
  /** Un AUTRE article du DMS porte exactement ce SKU : le SKU l'emporte, on ne devine pas. */
  skuOfAnotherArticle?: boolean;
}): boolean {
  const ref = normRef(v.articleRef);
  if (!ref || v.skuOfAnotherArticle) return false;
  const bySku = !!normRef(v.sku) && normRef(v.sku) === ref;
  const byTitle = firstToken(v.productTitle) === ref;
  if (!bySku && !byTitle) return false;
  const ratio = designationRatio(v.designation, `${v.productTitle ?? ''} ${v.variantTitle ?? ''}`);
  const gap = priceGap(v.salePriceTtc, v.shopPrice);
  return ratio >= 0.7 || (gap !== null && gap <= 0.05);
}

/**
 * Arbitrage d'un SKU partagé par plusieurs produits du site (demande de Simon, 23/09) :
 * on prend le produit ACTIF s'il est le seul ; plusieurs produits actifs → à une personne.
 * Miroir de la règle R1 d'article_links_autoresolve.
 */
export function pickSharedSkuVariant<T extends { variantId: string; shopStatus?: string | null }>(
  variants: readonly T[],
): T | null {
  if (variants.length === 0) return null;
  if (variants.length === 1) return variants[0];
  const active = variants.filter((v) => (v.shopStatus ?? '').toUpperCase() === 'ACTIVE');
  return active.length === 1 ? active[0] : null;
}

/** Familles de l'aperçu « créer les articles manquants » (miroir d'article_links_creation_preview). */
export type CreationFamily =
  | 'moto'
  | 'sans_reference'
  | 'occasion'
  | 'article_deja_relie_ailleurs'
  | 'piece_ducati'
  | 'accessoire_vetement_ducati'
  | 'vetement_98'
  | 'accessoire_96_97'
  | 'autre_reference';

const MOTO_TYPES = new Set(["Moto d'occasion", 'Moto neuve', 'Motorcycles & Scooters', 'Voiture occasion']);

export function classifyShopifyForCreation(v: {
  sku?: string | null;
  productType?: string | null;
  price?: number | null;
  title?: string | null;
  variantTitle?: string | null;
  articleExists?: boolean;
  inDucatiParts?: boolean;
  inDucatiProducts?: boolean;
}): CreationFamily {
  const k = normRef(v.sku);
  if (MOTO_TYPES.has(v.productType ?? '') || (!k && (v.price ?? 0) >= 1500)) return 'moto';
  if (!k) return 'sans_reference';
  if (isUsedPart(v.sku, v.title, v.variantTitle)) return 'occasion';
  if (v.articleExists) return 'article_deja_relie_ailleurs';
  if (v.inDucatiParts) return 'piece_ducati';
  if (v.inDucatiProducts) return 'accessoire_vetement_ducati';
  if (k.startsWith('98')) return 'vetement_98';
  if (/^9[67]/.test(k)) return 'accessoire_96_97';
  return 'autre_reference';
}

/** Familles proposées à la création (les motos et produits sans référence ne le sont pas). */
export function isProposedForCreation(f: CreationFamily): boolean {
  return f !== 'moto' && f !== 'sans_reference' && f !== 'article_deja_relie_ailleurs';
}
