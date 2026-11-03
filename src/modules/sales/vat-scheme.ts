/**
 * M6/M7/M12 — Regime de TVA d un document de vente (B2, VEN006, COM006 ; decision M-89 du
 * 03/11/2026). Logique pure, testee dans `tests/tva-marge.test.ts`.
 *
 * Deux regimes :
 *  - `normal` : TVA par ligne (21 %, 6 %, detaxe export via `taxExempt`) ;
 *  - `marge`  : moto d occasion rachetee a un particulier (article de type **O**). Loi belge
 *    (art. 58 §4 CTVA, AR n° 53) : AUCUNE TVA sur la facture (ni taux, ni montant), prix TTC =
 *    prix convenu, mention legale obligatoire. La TVA due se calcule **globalement par periode
 *    de declaration** (ventes marge − achats marge de la periode, marge negative reportee), hors
 *    facture, dans le registre de la marge (M12, `vo_margin_periods`).
 *
 * Regle de melange (la plus sure, documentee dans M06 §4) : **une moto O = un document a part**.
 * Un document qui porte une ligne d article O ne peut porter que des lignes d articles O (plus
 * des lignes texte / vides) ; pieces, main-d oeuvre, port ou tout autre article a 21 % sont
 * refuses : ils se facturent sur un document separe. Pas d exception « frais hors marge » :
 * le vendeur ne peut pas se tromper, le comptable retrouve une facture marge pure.
 *
 * Base fiscale (decision client) : prix d achat = prix de reprise paye au particulier, SEUL.
 * Les pieces et la main-d oeuvre de la remise en etat (ORO) sont des achats ordinaires a TVA
 * deductible, jamais ajoutes. La rentabilite B3 (PV − reprise − ORO − frais) est une autre
 * notion, inchangee (fiche VIN).
 */
import type { LineInput, PiedInput } from './write-api';

/** Meme regle que `lineHasAmount` (write-api), redite ici pour ne pas creer d import circulaire. */
const lineHasAmount = (l: Pick<LineInput, 'line_type'>): boolean => l.line_type !== 'texte' && l.line_type !== 'vide';

export type VatScheme = 'normal' | 'marge';
export const VAT_SCHEMES: readonly VatScheme[] = ['normal', 'marge'];

/** Types de gestion vendus sous le regime de la marge (B1 : O = occasion particulier). */
export const MARGIN_MGMT_TYPES: readonly string[] = ['O'];
export const isMarginMgmtType = (mgmtType: string | null | undefined): boolean =>
  !!mgmtType && MARGIN_MGMT_TYPES.includes(mgmtType);

/** Documents sur lesquels le prix de reprise doit etre connu et fige (vente effective). */
export const MARGIN_SALE_DOC_TYPES: readonly string[] = ['FAC', 'TIK'];

/** Taux legal applique a la marge (TVA comprise dans la marge : TVA = marge × taux / (100 + taux)). */
export const MARGIN_DEFAULT_RATE = 21;

export type ArticleVatInfo = { mgmt_type: string | null; purchase_price: number | null };

/** Lignes a montant rattachees a un article (seules elles comptent pour le regime). */
function amountLines(lines: LineInput[]): LineInput[] {
  return lines.filter((l) => lineHasAmount(l) && Math.abs(Number(l.quantity)) > 0);
}

/**
 * Regime d un document d apres ses lignes : `marge` des qu une ligne porte un article de
 * type O, `normal` sinon. Les lignes sans article (texte libre) ne changent rien.
 */
export function detectVatScheme(lines: LineInput[], articles: Map<string, ArticleVatInfo>): VatScheme {
  return amountLines(lines).some((l) => l.article_id && isMarginMgmtType(articles.get(l.article_id)?.mgmt_type)) ? 'marge' : 'normal';
}

export type VatSchemeError = 'margeMixed' | 'margeShipping' | 'margeNoPurchasePrice';

/**
 * Controles d un document en regime de la marge. Retourne la cle du message (`sales.<cle>`)
 * ou null :
 *  - `margeMixed`          : une ligne a montant n est pas un article O (piece, MO, texte avec
 *                            prix…) → document a part ;
 *  - `margeShipping`       : des frais de port (taxes a 21 %) sont poses sur le document ;
 *  - `margeNoPurchasePrice`: facture ou ticket (vente effective) sans prix de reprise connu
 *                            (`requirePurchasePrice`) → impossible de tenir le registre.
 */
export function vatSchemeError(p: {
  lines: LineInput[]; pied?: PiedInput; articles: Map<string, ArticleVatInfo>; requirePurchasePrice: boolean;
  /** Prix de reprise deja fige (avoir d une vente marge) : dispense la lecture des articles. */
  knownPurchasePrice?: number | null;
}): VatSchemeError | null {
  if (detectVatScheme(p.lines, p.articles) !== 'marge') return null;
  const sold = amountLines(p.lines);
  if (sold.some((l) => !l.article_id || !isMarginMgmtType(p.articles.get(l.article_id)?.mgmt_type))) return 'margeMixed';
  if ((p.pied?.shippingHt ?? 0) > 0) return 'margeShipping';
  if (p.requirePurchasePrice) {
    const known = p.knownPurchasePrice != null && p.knownPurchasePrice > 0;
    if (!known && marginPurchasePrice(p.lines, p.articles) == null) return 'margeNoPurchasePrice';
  }
  return null;
}

/**
 * Prix d achat a figer sur le document (somme des prix de reprise des motos O vendues, une moto
 * par ligne). `null` si une des motos n a pas de prix de reprise connu (> 0) : la vente est
 * refusee tant que la reprise n est pas chiffree (garde-fou de la decision client).
 */
export function marginPurchasePrice(lines: LineInput[], articles: Map<string, ArticleVatInfo>): number | null {
  let total = 0;
  for (const l of amountLines(lines)) {
    if (!l.article_id) continue;
    const a = articles.get(l.article_id);
    if (!isMarginMgmtType(a?.mgmt_type)) continue;
    const pp = Number(a?.purchase_price ?? 0);
    if (!(pp > 0)) return null;
    total += pp * Math.abs(Number(l.quantity));
  }
  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Base globale par periode (AR 53 art. 3) — meme calcul que la fonction SQL `vo_margin_periods`.
// ---------------------------------------------------------------------------------------------

export type MarginPeriodInput = {
  /** Cle de periode (ex. `2026-01` ou `2026-T1`), ordre chronologique attendu. */
  period: string;
  /** Ventes marge de la periode, TTC, signees (avoir = negatif). */
  sales: number;
  /** Achats marge de la periode (prix de reprise payes aux particuliers). */
  purchases: number;
};
export type MarginPeriodRow = MarginPeriodInput & {
  carriedIn: number; margin: number; baseHt: number; vatDue: number; carriedOut: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * TVA due sur une marge globale positive : la TVA est comprise dans la marge
 * (base = marge × 100 / (100 + taux), TVA = marge − base). Marge ≤ 0 : rien du.
 */
export function marginVat(margin: number, rate = MARGIN_DEFAULT_RATE): { baseHt: number; vatDue: number } {
  if (margin <= 0) return { baseHt: 0, vatDue: 0 };
  const baseHt = r2((margin * 100) / (100 + rate));
  return { baseHt, vatDue: r2(margin - baseHt) };
}

/**
 * Enchaine les periodes : marge = ventes − achats + report entrant ; une marge negative ne
 * donne aucune TVA et se reporte entierement sur la periode suivante (report sortant ≤ 0).
 */
export function marginPeriods(inputs: MarginPeriodInput[], rate = MARGIN_DEFAULT_RATE): MarginPeriodRow[] {
  let carry = 0;
  return inputs.map((p) => {
    const carriedIn = carry;
    const margin = r2(p.sales - p.purchases + carriedIn);
    const { baseHt, vatDue } = marginVat(margin, rate);
    const carriedOut = margin < 0 ? margin : 0;
    carry = carriedOut;
    return { ...p, carriedIn, margin, baseHt, vatDue, carriedOut };
  });
}

/** Cle i18n de la mention legale imprimee sur tout document en regime de la marge. */
export const MARGIN_MENTION_KEY = 'salesPdf.margeMention';
