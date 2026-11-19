/**
 * M8 — Prix des lignes d'un OR : LA fonction de calcul des lignes (pieces et main-d'oeuvre).
 * Lot accident-expert (19/11/2026, T4) ; logique PURE, testee dans tests/or-tarif-assureur.test.ts.
 *
 * Le calcul lui-meme est celui du moteur unique des tarifs (src/modules/sales/customer-pricing.ts,
 * vente / caisse / devis / OR) : on ne fait ici que choisir la base et appeler le « pricer ».
 * Le pricer de l'OR porte deja le bon tarif : celui du cabinet d'assurance sur un OR accident
 * (G8 : « code tarif associe automatiquement aux O.R. assurance »), sinon celui du client.
 *
 * - Piece (ou MO) liee a un article : base = prix catalogue de l'article, tarif applique.
 * - Main-d'oeuvre sans article : base = taux horaire de l'atelier ; le tarif s'applique comme a
 *   l'article MO_ATELIER de G8 (regles « tout le catalogue », ou par reference MO_ATELIER).
 * - Texte, piece libre sans article : prix saisi, jamais touche.
 *
 * Taux horaire atelier (decision Q48 du 18/11, lot decisions-atelier) : standard 109,74 HT = la base
 * de la MO (Parametres -> Tables -> Frais de devis atelier) ; VIP 90,00 HT = tarif client « VIP » dont
 * la ligne vise l'article MO de la societe, applique par `priceLabour` ; une MO de forfait (article MO
 * sans prix) se tarife pareil (`pricedAsLabour`).
 */
import type { ResolvedSalePrice } from '@/modules/sales/customer-pricing';

export { LABOUR_PRICING_REFERENCE } from '@/modules/sales/customer-pricing';

/** Ce que l'OR attend du moteur de tarifs (CustomerPricer). */
export type OrLinePricer = {
  price(articleId: string, baseHt: number, qty?: number): Promise<ResolvedSalePrice>;
  priceLabour(baseHt: number, qty?: number): Promise<ResolvedSalePrice>;
};

export type PriceableLine = {
  kind: 'piece' | 'mo' | 'texte';
  article_id?: string | null;
  quantity: number;
  unit_price_ht: number;
  discount_pct: number;
};

export type OrLinePrice = { unit_price_ht: number; discount_pct: number; ruled: boolean; listCode: string | null };

const pos = (n: unknown): number => { const x = Number(n); return Number.isFinite(x) && x > 0 ? x : 0; };

/** La ligne se tarife-t-elle ? (texte et piece libre : non) */
export const isPriceableLine = (l: PriceableLine): boolean =>
  l.kind !== 'texte' && (!!l.article_id || l.kind === 'mo');

/**
 * Prix d'une ligne d'OR pour une base HT donnee ; null = ligne non tarifee (texte, piece libre, base nulle).
 * `asLabour` : la ligne est de la main-d'oeuvre AU TAUX DE L'ATELIER (MO sans article, ou article MO de
 * type T sans prix propre, ex. la MO d'un forfait) : elle se tarife comme la MO (`priceLabour`, tarif
 * client « VIP » compris — decision Q48 du 18/11, lot decisions-atelier). Par defaut : sans article.
 */
export async function priceOrLine(pricer: OrLinePricer, line: PriceableLine, baseHt: number, asLabour = !line.article_id): Promise<OrLinePrice | null> {
  if (!isPriceableLine(line) || !(pos(baseHt) > 0)) return null;
  const qty = pos(line.quantity) || 1;
  const r = line.article_id && !(asLabour && line.kind === 'mo') ? await pricer.price(line.article_id, baseHt, qty) : await pricer.priceLabour(baseHt, qty);
  return { unit_price_ht: r.unitPriceHt, discount_pct: r.discountPct, ruled: !!r.rule, listCode: r.listCode };
}

type Bases = { articleBaseHt: ReadonlyMap<string, number>; labourRateHt: number | null | undefined };

/** MO au taux de l'atelier : sans article, ou article (type T) sans prix catalogue propre (decision Q48). */
export function pricedAsLabour(line: PriceableLine, bases: Bases): boolean {
  return line.kind === 'mo' && (!line.article_id || !(pos(bases.articleBaseHt.get(line.article_id)) > 0));
}

/** Base de la ligne : catalogue de l'article ; MO au taux atelier : taux de l'atelier (sinon le prix saisi). */
export function lineBaseHt(line: PriceableLine, bases: Bases): number {
  if (line.article_id && !pricedAsLabour(line, bases)) return pos(bases.articleBaseHt.get(line.article_id));
  if (line.kind === 'mo') return pos(bases.labourRateHt) || pos(line.unit_price_ht);
  return 0;
}

/**
 * Re-tarife toutes les lignes (cabinet d'assurance choisi, change ou retire) : chaque ligne
 * tarifable repart de sa base et prend le tarif du pricer. Les autres champs sont gardes.
 */
export async function repriceOrLines<L extends PriceableLine>(
  lines: readonly L[], pricer: OrLinePricer,
  bases: { articleBaseHt: ReadonlyMap<string, number>; labourRateHt: number | null | undefined },
): Promise<{ lines: L[]; changed: number }> {
  let changed = 0;
  const out = await Promise.all(lines.map(async (l) => {
    const p = await priceOrLine(pricer, l, lineBaseHt(l, bases), pricedAsLabour(l, bases));
    if (!p) return l;
    if (Math.abs(p.unit_price_ht - l.unit_price_ht) < 0.005 && Math.abs(p.discount_pct - (l.discount_pct || 0)) < 0.005) return l;
    changed += 1;
    return { ...l, unit_price_ht: p.unit_price_ht, discount_pct: p.discount_pct };
  }));
  return { lines: out, changed };
}

/**
 * Faut-il re-tarifer l'OR ? Oui quand le tarif assureur effectif n'est pas celui avec lequel les
 * lignes ont ete calculees. `applied` undefined = colonne absente (migration non appliquee) : non.
 * OR facture : jamais (ses lignes ne bougent plus).
 */
export function insurerRepriceNeeded(p: { applied: string | null | undefined; effective: string | null | undefined; invoiced: boolean }): boolean {
  if (p.applied === undefined || p.effective === undefined || p.invoiced) return false;
  return (p.applied ?? null) !== (p.effective ?? null);
}
