// Mission 03 — Règle de liaison AUTOMATIQUE produit Shopify ↔ article du DMS (décision W-6, 19/09).
//
// On ne relie d'office que si l'on retrouve EXACTEMENT le bon article :
//   - SKU de la variante = référence de l'article (après trim + majuscules), et un seul article trouvé ;
//   - à défaut de SKU correspondant : code-barres de la variante = code-barres de l'article, un seul article ;
//   - SKU et code-barres ne désignent pas deux articles différents ;
//   - l'article n'est visé que par UNE variante (sinon on ne sait pas laquelle est la bonne) ;
//   - l'article n'est pas déjà relié à la main à une autre variante.
// Tout le reste part « à valider » (jamais de liaison devinée). Fonction pure, sans dépendance :
// importée par la fonction serveur shopify-sync-products et testée par tests/shopify-match.test.ts.

export type MatchVia = 'sku' | 'barcode';

export interface VariantToMatch {
  variant_id: string;
  sku: string | null;
  barcode: string | null;
}

/** Article candidat renvoyé par la base (égalité exacte déjà filtrée côté SQL, revérifiée ici). */
export interface MatchCandidate {
  variant_id: string;
  article_id: string;
  article_reference: string | null;
  article_barcode: string | null;
  via: MatchVia;
  /** Article déjà relié à la main (statut « valide ») à une AUTRE variante. */
  taken?: boolean;
}

export type ReviewReason =
  | 'no_sku'          // ni SKU ni code-barres
  | 'no_match'        // aucun article avec exactement ce SKU / code-barres
  | 'ambiguous'       // plusieurs articles répondent au même SKU (ou au même code-barres)
  | 'conflict'        // le SKU désigne un article, le code-barres un autre
  | 'shared_article'  // plusieurs variantes Shopify visent le même article
  | 'article_taken';  // l'article est déjà relié à la main à une autre variante

export type MatchDecision =
  | { kind: 'auto'; article_id: string; via: MatchVia }
  | { kind: 'review'; reason: ReviewReason };

/** Clé de comparaison : espaces de début/fin retirés, majuscules. Chaîne vide → null. */
export function normalizeKey(v: string | null | undefined): string | null {
  if (v == null) return null;
  const k = String(v).trim().toUpperCase();
  return k === '' ? null : k;
}

export function decideAutoLinks(
  variants: VariantToMatch[],
  candidates: MatchCandidate[],
): Map<string, MatchDecision> {
  const byVariant = new Map<string, MatchCandidate[]>();
  for (const c of candidates) {
    const list = byVariant.get(c.variant_id) ?? [];
    list.push(c);
    byVariant.set(c.variant_id, list);
  }

  const out = new Map<string, MatchDecision>();
  for (const v of variants) {
    const sku = normalizeKey(v.sku);
    const bc = normalizeKey(v.barcode);
    if (!sku && !bc) { out.set(v.variant_id, { kind: 'review', reason: 'no_sku' }); continue; }

    const cands = byVariant.get(v.variant_id) ?? [];
    // Revérification stricte : seule l'égalité exacte compte, quoi qu'ait renvoyé la base.
    const skuHits = sku ? cands.filter((c) => c.via === 'sku' && normalizeKey(c.article_reference) === sku) : [];
    const bcHits = bc ? cands.filter((c) => c.via === 'barcode' && normalizeKey(c.article_barcode) === bc) : [];
    const skuIds = [...new Set(skuHits.map((c) => c.article_id))];
    const bcIds = [...new Set(bcHits.map((c) => c.article_id))];

    let pick: { id: string; via: MatchVia } | null = null;
    let reason: ReviewReason | null = null;
    if (skuIds.length > 1) reason = 'ambiguous';
    else if (skuIds.length === 1) {
      if (bcIds.length > 0 && !(bcIds.length === 1 && bcIds[0] === skuIds[0])) reason = 'conflict';
      else pick = { id: skuIds[0], via: 'sku' };
    } else if (bcIds.length > 1) reason = 'ambiguous';
    else if (bcIds.length === 1) pick = { id: bcIds[0], via: 'barcode' };
    else reason = 'no_match';

    if (pick && [...skuHits, ...bcHits].some((c) => c.article_id === pick!.id && c.taken)) {
      reason = 'article_taken';
      pick = null;
    }
    out.set(v.variant_id, pick ? { kind: 'auto', article_id: pick.id, via: pick.via } : { kind: 'review', reason: reason! });
  }

  // Unicité côté article : un article visé par plusieurs variantes n'est relié à aucune.
  const perArticle = new Map<string, string[]>();
  for (const [vid, d] of out) {
    if (d.kind !== 'auto') continue;
    perArticle.set(d.article_id, [...(perArticle.get(d.article_id) ?? []), vid]);
  }
  for (const vids of perArticle.values()) {
    if (vids.length > 1) for (const vid of vids) out.set(vid, { kind: 'review', reason: 'shared_article' });
  }
  return out;
}
