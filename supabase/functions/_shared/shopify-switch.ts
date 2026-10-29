// Mission 03 — Une reference remplacee bascule sur la nouvelle, sur le site (decision client 29-30/10/2026).
//
// Module PUR (aucun acces reseau ni base) : partage par la fonction serveur shopify-publish
// (action « switch ») et par les tests (`bun test`).
//
// Quand A est remplacee par B (articles.superseded_by_id, fin de chaine = article_final_replacement)
// et que A est reliee a un produit du site :
//   1. B est publiee (ou remise en ligne, ou mise a jour) ; A est retiree (brouillon, jamais supprimee) ;
//      une redirection Shopify /products/<handle A> -> /products/<handle B> garde les liens et le referencement.
//   2. Si B n'a ni photo ni texte web dans le DMS, le DMS importe d'abord ceux du produit Shopify de A
//      dans la fiche de B (regle « ne jamais ecraser » de shopify-content.ts), puis publie B avec.
//   3. La fiche produit de B porte la mention « Remplace aussi la reference 14622167AA » dans le corps
//      de la description : en francais, generee par le DMS, idempotente (jamais dupliquee).
//
// Tout ce qui DECIDE est ici : le plan de bascule (etapes a faire / deja faites / bloquees selon le mode),
// le texte exact de la mention et son application sans doublon, les mutations de redirection.

import { normalizeMode, writeAllowed, type SyncMode } from './shopify-push.ts';

// ─── Mention « Remplace aussi … » ─────────────────────────────────────────────────────

/** Classe posee sur le paragraphe pour le retrouver (Shopify garde les attributs class du body_html). */
export const NOTICE_CLASS = 'dms-remplace';

/** References nettoyees : majuscules, sans doublon, sans vide, ordre conserve. */
export function cleanReferences(refs: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    const v = String(r ?? '').trim().toUpperCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Texte brut de la mention (sans HTML) ; '' si aucune ancienne reference. */
export function replacementNoticeText(oldReferences: string[]): string {
  const refs = cleanReferences(oldReferences);
  if (!refs.length) return '';
  if (refs.length === 1) return `Remplace aussi la r\u00e9f\u00e9rence ${refs[0]}.`;
  const list = `${refs.slice(0, -1).join(', ')} et ${refs[refs.length - 1]}`;
  return `Remplace aussi les r\u00e9f\u00e9rences ${list}.`;
}

/** Paragraphe HTML de la mention ; '' si aucune ancienne reference. */
export function replacementNoticeHtml(oldReferences: string[]): string {
  const txt = replacementNoticeText(oldReferences);
  return txt ? `<p class="${NOTICE_CLASS}">${escapeHtml(txt)}</p>` : '';
}

/**
 * Retire toute mention deja presente (par la classe, ou par le texte si Shopify a retire l'attribut),
 * puis ajoute la mention a la fin. Appliquer deux fois donne le meme resultat.
 */
export function applyReplacementNotice(descriptionHtml: string | null | undefined, oldReferences: string[]): string {
  const base = stripReplacementNotice(descriptionHtml);
  const notice = replacementNoticeHtml(oldReferences);
  if (!notice) return base;
  return base ? `${base}\n${notice}` : notice;
}

/** La description sans la mention (pour comparer ou reprendre un texte propre). */
export function stripReplacementNotice(descriptionHtml: string | null | undefined): string {
  if (!descriptionHtml) return '';
  return String(descriptionHtml)
    .replace(new RegExp(`\\s*<p[^>]*\\bclass="${NOTICE_CLASS}"[^>]*>[\\s\\S]*?<\\/p>\\s*`, 'gi'), '\n')
    .replace(/\s*<p[^>]*>\s*Remplace aussi (?:la r\u00e9f\u00e9rence|les r\u00e9f\u00e9rences) [^<]*<\/p>\s*/gi, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// ─── Plan de bascule ───────────────────────────────────────────────────────────────────

export type SwitchLink = { product_id: string | null; product_status: string | null; handle: string | null } | null;

export type SwitchArticle = {
  article_id: string;
  reference: string;
  is_active: boolean;
  in_trial: boolean;
  /** Prix TTC qui partirait sur le site (shopifyTtc) ; null = pas de prix. */
  ttc: number | null;
  web_title: string | null;
  web_description: string | null;
  photo_count: number;
  link: SwitchLink;
};

export type SwitchStepName = 'contenu' | 'publication' | 'remise_en_ligne' | 'mise_a_jour' | 'retrait' | 'redirection';
export type SwitchStepStatus = 'a_faire' | 'deja_fait' | 'bloque';
export type SwitchStep = { step: SwitchStepName; status: SwitchStepStatus; detail: string | null };

export type SwitchReason =
  | 'not_replaced' | 'old_not_linked' | 'sync_stopped' | 'not_in_trial' | 'inactive' | 'no_price' | 'no_handle';

export type SwitchPlan = {
  ok: boolean;
  reason: SwitchReason | null;
  steps: SwitchStep[];
  /** Mention qui sera posee sur la fiche produit de la nouvelle reference. */
  notice: string;
  old_references: string[];
  next_reference: string;
};

export type SwitchInput = {
  mode: unknown;
  old: SwitchArticle;
  next: SwitchArticle;
  /** Toutes les anciennes references de la chaine qui mene a `next` (A, et celles avant A). */
  old_references: string[];
  /** Une redirection de A vers B est deja enregistree dans le DMS. */
  redirect_done: boolean;
};

const blank = (s: string | null | undefined) => (s ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim() === '';

/** Ce que la fiche de B n'a pas encore et qui sera repris du produit de A. */
export function contentToImport(next: Pick<SwitchArticle, 'web_title' | 'web_description' | 'photo_count'>): ('titre' | 'description' | 'photos')[] {
  const out: ('titre' | 'description' | 'photos')[] = [];
  if (blank(next.web_title)) out.push('titre');
  if (blank(next.web_description)) out.push('description');
  if (next.photo_count <= 0) out.push('photos');
  return out;
}

/** En mode Essai, l'ancienne ET la nouvelle reference doivent etre des articles d'essai. */
export function switchAllowed(mode: SyncMode, oldInTrial: boolean, nextInTrial: boolean): boolean {
  return writeAllowed(mode, oldInTrial && nextInTrial);
}

/**
 * Le plan : etapes dans l'ordre d'execution. `ok` = false si quelque chose bloque (la raison est donnee,
 * les etapes sont quand meme listees pour l'apercu).
 */
export function planSwitch(input: SwitchInput): SwitchPlan {
  const mode = normalizeMode(input.mode);
  const { old, next } = input;
  const old_references = cleanReferences([...input.old_references, old.reference].filter((r) => r.toUpperCase() !== next.reference.trim().toUpperCase()));
  const notice = replacementNoticeText(old_references);
  const steps: SwitchStep[] = [];
  let reason: SwitchReason | null = null;

  if (old.article_id === next.article_id) {
    return { ok: false, reason: 'not_replaced', steps, notice, old_references, next_reference: next.reference };
  }
  if (!old.link?.product_id) {
    return { ok: false, reason: 'old_not_linked', steps, notice, old_references, next_reference: next.reference };
  }
  if (!switchAllowed(mode, old.in_trial, next.in_trial)) {
    reason = mode === 'arrete' ? 'sync_stopped' : 'not_in_trial';
  }

  // 1. Contenu de B, repris de A si la fiche de B est vide.
  const missing = contentToImport(next);
  steps.push(missing.length
    ? { step: 'contenu', status: 'a_faire', detail: missing.join(', ') }
    : { step: 'contenu', status: 'deja_fait', detail: null });

  // 2. B sur le site.
  if (!next.link?.product_id) {
    if (!next.is_active) { steps.push({ step: 'publication', status: 'bloque', detail: 'article inactif' }); reason ??= 'inactive'; }
    else if (next.ttc == null) { steps.push({ step: 'publication', status: 'bloque', detail: 'pas de prix de vente dans le DMS' }); reason ??= 'no_price'; }
    else steps.push({ step: 'publication', status: 'a_faire', detail: notice || null });
  } else {
    if (next.link.product_status !== 'ACTIVE') steps.push({ step: 'remise_en_ligne', status: 'a_faire', detail: null });
    steps.push({ step: 'mise_a_jour', status: 'a_faire', detail: notice || null });
  }

  // 3. A retiree (brouillon).
  steps.push(old.link.product_status === 'ACTIVE'
    ? { step: 'retrait', status: 'a_faire', detail: null }
    : { step: 'retrait', status: 'deja_fait', detail: old.link.product_status === 'ARCHIVED' ? 'produit archive' : 'produit deja en brouillon' });

  // 4. Redirection /products/A -> /products/B.
  if (input.redirect_done) steps.push({ step: 'redirection', status: 'deja_fait', detail: null });
  else {
    const to = next.link?.handle ? redirectPath(next.link.handle) : '(adresse de la nouvelle fiche)';
    const from = old.link.handle ? redirectPath(old.link.handle) : null;
    steps.push({ step: 'redirection', status: 'a_faire', detail: `${from ?? '(adresse lue sur Shopify)'} -> ${to}` });
  }

  return { ok: reason == null, reason, steps, notice, old_references, next_reference: next.reference };
}

// ─── Redirections (Admin GraphQL 2026-07) ──────────────────────────────────────────────

/** Adresse d'une fiche produit du site a partir de son handle Shopify. */
export function redirectPath(handle: string): string {
  const h = String(handle ?? '').trim().replace(/^\/+|\/+$/g, '');
  return `/products/${h}`;
}

export const REDIRECT_LOOKUP_QUERY = `query Redirects($q: String!) {
  urlRedirects(first: 5, query: $q) { nodes { id path target } }
}`;

export const redirectSearch = (path: string) => `path:${path.replace(/["\\]/g, '')}`;

/** La redirection de Shopify qui porte exactement ce chemin, s'il y en a une. */
export function pickRedirect(nodes: { id: string; path: string; target: string }[], path: string) {
  const norm = (s: string) => String(s ?? '').trim().replace(/\/+$/, '').toLowerCase();
  return nodes.find((n) => norm(n.path) === norm(path)) ?? null;
}

export function buildRedirectCreate(fromHandle: string, toHandle: string) {
  return {
    query: `mutation CreateRedirect($redirect: UrlRedirectInput!) {
  urlRedirectCreate(urlRedirect: $redirect) { urlRedirect { id path target } userErrors { field message } }
}`,
    variables: { redirect: { path: redirectPath(fromHandle), target: redirectPath(toHandle) } },
  };
}

export function buildRedirectUpdate(redirectId: string, toHandle: string) {
  return {
    query: `mutation UpdateRedirect($id: ID!, $redirect: UrlRedirectInput!) {
  urlRedirectUpdate(id: $id, urlRedirect: $redirect) { urlRedirect { id path target } userErrors { field message } }
}`,
    variables: { id: redirectId, redirect: { target: redirectPath(toHandle) } },
  };
}

/** Lecture des deux handles sur Shopify (la base peut etre en retard sur le site). */
export const PRODUCT_HANDLES_QUERY = `query Handles($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { id handle status } }
}`;

/** Produit de A : titre, description et images, pour la reprise dans la fiche de B. */
export const PRODUCT_CONTENT_QUERY = `query ProductContent($id: ID!) {
  node(id: $id) {
    ... on Product {
      id title handle status descriptionHtml
      featuredMedia { id }
      media(first: 40) {
        nodes {
          id alt mediaContentType
          ... on MediaImage { image { url(transform: { maxWidth: 2048, maxHeight: 2048 }) altText } }
        }
      }
    }
  }
}`;

/** Ids des images d'un produit Shopify (reponse PRODUCT_CONTENT_QUERY). */
export function mediaIdsOf(product: { media?: { nodes?: { id?: string; mediaContentType?: string }[] } } | null | undefined): string[] {
  return (product?.media?.nodes ?? []).filter((m) => m?.mediaContentType === 'IMAGE' && m.id).map((m) => String(m.id));
}

/** Resume lisible d'une bascule pour le journal et l'evenement. */
export function summarizeSteps(steps: SwitchStep[]): string {
  return steps.map((s) => `${s.step}:${s.status}${s.detail ? ` (${s.detail})` : ''}`).join(' ; ').slice(0, 1000);
}
