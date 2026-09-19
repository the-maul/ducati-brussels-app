/**
 * M6 — Accessoire trouvé dans l'e-catalog Ducati (mission 05, carte 4). Règles pures, testées.
 *
 * Pas d'API Ducati (décision du 19/09) : le vendeur colle une référence brute
 * (ex. 96680574A, 96782291BA) ou un lien copié depuis e-catalog.ducati.com.
 * On n'appelle jamais le site : la référence est lue dans le texte ou dans l'URL.
 *
 * Format réel des liens e-catalog (EPC) connu du projet (migration
 * 20260612800000_articles_catalog_url) : https://e-catalog.ducati.com/EPC/parts/106/125/298/…/45968?lang=fr-FR
 * — le chemin est une arborescence d'identifiants internes, la référence n'y figure en
 * général PAS. On la cherche quand même (paramètre de requête, segment, ancre) ; sinon
 * l'écran la demande au vendeur.
 */

export const ECATALOG_HOME = 'https://e-catalog.ducati.com/EPC/?lang=fr-FR';

/**
 * Forme d'une référence Ducati : 8 à 11 chiffres suivis de 0 à 3 lettres
 * (96680574A, 96782291BA, 981069403, 59810361A). Les identifiants de l'arborescence
 * EPC (106, 45968…) sont plus courts et ne sont donc jamais pris pour une référence.
 */
const DUCATI_REF_RE = /^\d{8,11}[A-Z]{0,3}$/;
const DUCATI_REF_IN_TEXT_RE = /(?:^|[^A-Z0-9])(\d{8,11}[A-Z]{0,3})(?![A-Z0-9])/;
/** Référence brute acceptée : lettres/chiffres (+ - . /), au moins un chiffre. */
const RAW_REF_RE = /^[A-Z0-9][A-Z0-9.\-/]{2,39}$/;
/** Paramètres d'URL susceptibles de porter une référence. */
const REF_PARAM_RE = /^(part(_?(number|no|code|id))?|pn|partnumber|ref(erence)?|code|sku|search|searchterm|q|query|keyword|term|article)$/i;

/** Normalise une référence : sans espaces (ni insécables), en majuscules. */
export function normalizeReference(input: string | null | undefined): string {
  return String(input ?? '').replace(/[\s  ]+/g, '').toUpperCase();
}

/** Vrai si la référence a la forme d'une référence Ducati (voir DUCATI_REF_RE). */
export function looksLikeDucatiReference(ref: string | null | undefined): boolean {
  return DUCATI_REF_RE.test(normalizeReference(ref));
}

function isValidRawReference(ref: string): boolean {
  return RAW_REF_RE.test(ref) && /\d/.test(ref);
}

/** Vrai si le texte ressemble à un lien (http(s)://, www., ou domaine e-catalog). */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  return /^https?:\/\//i.test(s) || /^www\./i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ducati\.com(\/|$)/i.test(s);
}

export function isEcatalogUrl(input: string): boolean {
  const u = toUrl(input);
  return !!u && /(^|\.)e-catalog\.ducati\.com$/i.test(u.hostname);
}

function toUrl(input: string): URL | null {
  const s = input.trim();
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

/** Cherche une référence Ducati dans un morceau de texte (segment, valeur…). */
function ducatiRefIn(piece: string): string | null {
  const up = safeDecode(piece).toUpperCase();
  const whole = normalizeReference(up);
  if (DUCATI_REF_RE.test(whole)) return whole;
  const m = DUCATI_REF_IN_TEXT_RE.exec(up);
  return m ? m[1] : null;
}

/** Référence lue dans une URL (paramètres, puis segments du chemin, puis ancre), ou null. */
export function extractReferenceFromUrl(input: string): string | null {
  const u = toUrl(input);
  if (!u) return null;
  // 1. Paramètres nommés comme une référence : valeur brute acceptée (pas seulement le format Ducati).
  for (const [k, v] of u.searchParams) {
    if (!REF_PARAM_RE.test(k)) continue;
    const ref = normalizeReference(v);
    if (isValidRawReference(ref)) return ref;
  }
  // 2. Autres paramètres, segments du chemin (du plus précis au plus général), ancre : format Ducati seulement.
  for (const [, v] of u.searchParams) {
    const ref = ducatiRefIn(v);
    if (ref) return ref;
  }
  const segments = u.pathname.split('/').filter(Boolean).reverse();
  for (const seg of segments) {
    const ref = ducatiRefIn(seg);
    if (ref) return ref;
  }
  if (u.hash) {
    const ref = ducatiRefIn(u.hash.slice(1));
    if (ref) return ref;
  }
  return null;
}

export type EcatalogInput =
  | { kind: 'empty' }
  /** Référence trouvée (collée telle quelle ou lue dans un lien). */
  | { kind: 'reference'; reference: string; url: string | null }
  /** Lien sans référence lisible : l'écran demande la référence. */
  | { kind: 'url_without_reference'; url: string }
  /** Texte inexploitable. */
  | { kind: 'invalid' };

/** Analyse ce que le vendeur a collé (référence brute, texte contenant une référence, ou lien). */
export function parseEcatalogInput(input: string | null | undefined): EcatalogInput {
  const s = String(input ?? '').trim();
  if (!s) return { kind: 'empty' };
  if (looksLikeUrl(s)) {
    const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const ref = extractReferenceFromUrl(s);
    return ref ? { kind: 'reference', reference: ref, url } : { kind: 'url_without_reference', url };
  }
  const tokens = s.split(/\s+/);
  // Une référence collée seule, éventuellement coupée par des espaces (« 9668 0574 A ») :
  // aucun mot de 4 lettres ou plus (sinon c'est une désignation).
  const whole = normalizeReference(s);
  if (isValidRawReference(whole) && !tokens.some((w) => /^[A-Z]{4,}$/i.test(w))) {
    return { kind: 'reference', reference: whole, url: null };
  }
  // Texte copié avec la désignation (« 96680574A Silencieux racing ») : on garde la référence Ducati,
  // à défaut le premier mot qui a la forme d'une référence.
  const inText = ducatiRefIn(s);
  if (inText) return { kind: 'reference', reference: inText, url: null };
  const first = normalizeReference(tokens[0]);
  if (isValidRawReference(first)) return { kind: 'reference', reference: first, url: null };
  return { kind: 'invalid' };
}

/**
 * Lien « Voir dans l'e-catalog » d'une ligne : l'URL exacte enregistrée sur l'article si elle
 * existe, sinon l'accueil du catalogue (aucun format d'URL de recherche par référence n'est
 * documenté : l'écran copie la référence pour la coller dans la recherche du catalogue).
 */
export function ecatalogLinkFor(catalogUrl?: string | null): string {
  const u = (catalogUrl ?? '').trim();
  return u && isEcatalogUrl(u) ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : ECATALOG_HOME;
}

/** Prix HT et TTC d'un article créé depuis une vente, selon la convention de la ligne (HT ou TTC). */
export function salePricesFrom(price: number, mode: 'ht' | 'ttc', vatRate = 21): { ht: number; ttc: number } {
  const p = Number.isFinite(price) && price > 0 ? price : 0;
  const f = 1 + vatRate / 100;
  if (mode === 'ttc') return { ttc: Math.round(p * 100) / 100, ht: Math.round((p / f) * 10000) / 10000 };
  return { ht: Math.round(p * 10000) / 10000, ttc: Math.round(p * f * 100) / 100 };
}
