/**
 * Prix d'une ligne tiree d'un article (OR, check-up, documents de vente, caisse) — logique pure.
 *
 * Retour client du 03/11/2026 (ATE001b) : en choisissant un article sur l'OR, le PU HT restait a 0.
 * Cause : 81 089 articles sur 93 784 n'ont que leur PV TTC (tarif importe en TTC), `sale_price_ht`
 * vide ; la recherche renvoyait `coalesce(sale_price_ht, 0)`. Le HT se deduit alors du TTC et du
 * taux de TVA de l'article : PU HT = PV TTC / (1 + TVA).
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** PV HT de base d'un article : le HT s'il est connu, sinon PV TTC / (1 + TVA). */
export function articleBaseSaleHt(a: { sale_price_ht?: number | null; sale_price_ttc?: number | null; vat_rate?: number | null }): number {
  const ht = Number(a.sale_price_ht ?? 0);
  if (Number.isFinite(ht) && ht > 0) return ht;
  const ttc = Number(a.sale_price_ttc ?? 0);
  if (!Number.isFinite(ttc) || ttc <= 0) return 0;
  const vat = Number(a.vat_rate ?? 21);
  return r2(ttc / (1 + (Number.isFinite(vat) ? vat : 21) / 100));
}

/** Taux de TVA d'un article (21 % si inconnu). */
export function articleVatRate(a: { vat_rate?: number | null }): number {
  const v = Number(a.vat_rate);
  return a.vat_rate == null || !Number.isFinite(v) ? 21 : v;
}

export type ArticleLinePrice = { unit_price_ht: number; vat_rate: number; discount_pct: number };

/**
 * Prix d'une ligne pour un article choisi : PU HT (arrondi catalogue de la societe deja applique
 * par `effectiveHt`), TVA de l'article, remise du client si elle existe (aucune remise client
 * n'existe encore en base au 03/11/2026 : 0 par defaut).
 */
export function articleLinePrice(
  a: { sale_price_ht: number; vat_rate: number },
  opts: { effectiveHt?: (ht: number, vat: number) => number; clientDiscountPct?: number | null } = {},
): ArticleLinePrice {
  const vat = articleVatRate(a);
  const base = Number(a.sale_price_ht ?? 0) > 0 ? Number(a.sale_price_ht) : 0;
  const ht = opts.effectiveHt ? opts.effectiveHt(base, vat) : base;
  const disc = Number(opts.clientDiscountPct ?? 0);
  return { unit_price_ht: r2(ht), vat_rate: vat, discount_pct: Number.isFinite(disc) && disc > 0 ? Math.min(disc, 100) : 0 };
}

/**
 * Remise du client issue de ses tarifs (Clients → Tarifs clients, `resolve_customer_price`) :
 * remise % ou paliers quantitatifs. Le « coefficient » (prix depuis le PA) n'est pas une remise :
 * il n'est pas repris ici. Sans regle : 0.
 */
export function customerDiscountPct(resolved: { rule_kind: string; discount_pct: number } | null | undefined): number {
  if (!resolved) return 0;
  if (resolved.rule_kind !== 'discount_pct' && resolved.rule_kind !== 'quantity_tiers') return 0;
  const d = Number(resolved.discount_pct);
  return Number.isFinite(d) && d > 0 ? Math.min(d, 100) : 0;
}

/**
 * Ligne main-d'oeuvre : passer une ligne en « main-d'oeuvre » sans prix pose le taux horaire de
 * l'atelier (Parametres → Tables → Frais de devis atelier, `hourly_rate_ht`). Un prix deja saisi
 * n'est jamais ecrase.
 */
export function labourUnitPrice(current: number, hourlyRateHt: number | null | undefined): number {
  if (Number(current) > 0) return Number(current);
  const rate = Number(hourlyRateHt ?? 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}
