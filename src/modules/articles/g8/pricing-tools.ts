/**
 * M2 — Rattrapage G8 (18/11/2026) : règles de prix pures (testées, sans accès réseau).
 *
 *  - indicateurs de la fiche article G8 : coefficients (TTC/PA, HT/PA, PPC/PA), écart PV / PPC,
 *    marge et taux de marque sur PA et sur PAMP ;
 *  - arrondis par fournisseur × famille × tranche de prix (G8 « Paramétrage des arrondis ») ;
 *  - recalcul PA / PV par tranches de PA (G8 « Recalcul PA/PV » : taux d'augmentation ou
 *    coefficient, 5 tranches) ;
 *  - PV selon le PPC appliqué aux articles existants (G8 « Paramétrage PV selon PPC »).
 *
 * Aucun prix n'est écrit ici : l'écran affiche l'aperçu, puis l'écriture passe par
 * `article_price_batch` (trace append-only price_changes, règle 3 / B7).
 */
import { resolvePpcRule, roundUpPrice, type PpcRule } from '../import/rules';

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const r4 = (n: number) => Math.round(n * 10000) / 10000;

// ─── Indicateurs de la fiche (G8 bloc « Prix ») ────────────────────────────

export type PriceInputs = {
  pa: number; pamp: number; pvHt: number; pvTtc: number;
  ppcHt?: number | null; ppcTtc?: number | null;
};

export type PriceIndicators = {
  /** G8 « Coeff. » : PV TTC / PA. */
  coefTtc: number | null;
  /** G8 « Coeff. H.T. » : PV HT / PA. */
  coefHt: number | null;
  /** G8 « Coeff. PPC » : PPC TTC / PA. */
  coefPpc: number | null;
  /** G8 « PV / PPC » : écart du PV TTC au PPC TTC, en % (négatif = sous le PPC). */
  pvPpcPct: number | null;
  /** Marge en € HT sur PA et sur PAMP (B5). */
  marginPa: number | null;
  marginPamp: number | null;
  /** Taux de marque = marge / PV HT, en % (G8 « Taux de marque »). */
  markRatePa: number | null;
  markRatePamp: number | null;
  /** Taux de marge = marge / prix d'achat, en % (affichage historique du DMS). */
  markupPa: number | null;
  markupPamp: number | null;
};

export function priceIndicators(p: PriceInputs): PriceIndicators {
  const pa = p.pa > 0 ? p.pa : 0;
  const pamp = p.pamp > 0 ? p.pamp : 0;
  const pvHt = p.pvHt > 0 ? p.pvHt : 0;
  const ppcTtc = p.ppcTtc && p.ppcTtc > 0 ? p.ppcTtc : 0;
  return {
    coefTtc: pa && p.pvTtc > 0 ? r4(p.pvTtc / pa) : null,
    coefHt: pa && pvHt ? r4(pvHt / pa) : null,
    coefPpc: pa && ppcTtc ? r4(ppcTtc / pa) : null,
    pvPpcPct: ppcTtc && p.pvTtc > 0 ? r2((p.pvTtc / ppcTtc - 1) * 100) : null,
    marginPa: pa && pvHt ? r2(pvHt - pa) : null,
    marginPamp: pamp && pvHt ? r2(pvHt - pamp) : null,
    markRatePa: pa && pvHt ? r2(((pvHt - pa) / pvHt) * 100) : null,
    markRatePamp: pamp && pvHt ? r2(((pvHt - pamp) / pvHt) * 100) : null,
    markupPa: pa && pvHt ? r2(((pvHt - pa) / pa) * 100) : null,
    markupPamp: pamp && pvHt ? r2(((pvHt - pamp) / pamp) * 100) : null,
  };
}

// ─── Arrondis par famille × tranche ─────────────────────────────────────────

export type RoundingMode = 'up' | 'nearest';

/** Une règle de la grille G8 : (fournisseur ?, famille ?) × tranche de PV TTC → pas. */
export type FamilyRoundingRule = {
  id?: string;
  supplier_id: string | null;
  /** Préfixe de famille « RR », « RR-SS » ou « RR-SS-CC » ; null = toutes les familles. */
  category_prefix: string | null;
  /** Haut de la tranche (PV TTC ≤ up_to) ; 0 = sans limite. */
  up_to: number;
  step: number;
  mode: RoundingMode;
  sort_order?: number;
  is_active?: boolean;
};

/** Préfixe de famille construit depuis les 3 niveaux (vides ignorés à partir du premier vide). */
export function familyPrefix(rayon?: string | null, sousRayon?: string | null, categorie?: string | null): string | null {
  const parts: string[] = [];
  for (const p of [rayon, sousRayon, categorie]) {
    const v = (p ?? '').trim();
    if (!v) break;
    parts.push(v);
  }
  return parts.length ? parts.join('-') : null;
}

function prefixMatches(prefix: string | null, path: string | null | undefined): boolean {
  if (!prefix) return true;
  const p = (path ?? '').trim();
  return p === prefix || p.startsWith(`${prefix}-`);
}

/** Précision d'un groupe : fournisseur (4) + niveaux de famille (1 à 3). */
function specificity(r: Pick<FamilyRoundingRule, 'supplier_id' | 'category_prefix'>): number {
  return (r.supplier_id ? 4 : 0) + (r.category_prefix ? r.category_prefix.split('-').length : 0);
}

/**
 * Règles applicables à un article : le groupe (fournisseur, famille) le plus précis qui
 * correspond gagne en entier (G8 : la grille la plus fine remplace la plus large), ses
 * tranches triées par haut de tranche. Aucune règle → [] (l'appelant garde l'arrondi société).
 */
export function resolveFamilyRounding(
  rules: FamilyRoundingRule[], article: { supplierId?: string | null; categoryPath?: string | null },
): FamilyRoundingRule[] {
  const matching = rules.filter((r) => r.is_active !== false && r.step > 0
    && (!r.supplier_id || r.supplier_id === (article.supplierId ?? null))
    && prefixMatches(r.category_prefix, article.categoryPath));
  if (!matching.length) return [];
  const best = Math.max(...matching.map(specificity));
  const group = matching.filter((r) => specificity(r) === best);
  // Plusieurs groupes de même précision (rare) : celui du fournisseur puis de la famille la plus longue.
  const key = (r: FamilyRoundingRule) => `${r.supplier_id ?? ''}|${r.category_prefix ?? ''}`;
  const firstKey = key([...group].sort((a, b) => key(a).localeCompare(key(b)))[0]);
  return group.filter((r) => key(r) === firstKey)
    .sort((a, b) => (a.up_to === 0 ? 1 : 0) - (b.up_to === 0 ? 1 : 0) || a.up_to - b.up_to || (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** Arrondit un PV TTC avec les tranches d'un groupe (la première tranche qui contient le prix). */
export function roundWithTranches(value: number, tranches: FamilyRoundingRule[]): number {
  if (!(value > 0) || !tranches.length) return r2(value);
  const rule = tranches.find((r) => r.up_to === 0 || value <= r.up_to);
  if (!rule || !(rule.step > 0)) return r2(value);
  const cents = Math.round(value * 100);
  const stepCents = Math.round(rule.step * 100);
  if (stepCents <= 0) return r2(value);
  const q = cents / stepCents;
  const n = rule.mode === 'nearest' ? Math.round(q) : Math.ceil(q - 1e-9);
  return r2((n * stepCents) / 100);
}

/** Nouveau PV d'un article après arrondi de la grille (null = rien à changer ou pas de règle). */
export function roundingChange(
  a: { id: string; sale_price_ttc: number; vat_rate: number; purchase_price: number; supplier_id?: string | null; category_path?: string | null },
  rules: FamilyRoundingRule[],
): PriceChange | null {
  const tranches = resolveFamilyRounding(rules, { supplierId: a.supplier_id, categoryPath: a.category_path });
  if (!tranches.length || !(a.sale_price_ttc > 0)) return null;
  const ttc = roundWithTranches(a.sale_price_ttc, tranches);
  if (ttc === r2(a.sale_price_ttc)) return null;
  return withSaleTtc(a, ttc);
}

// ─── Changements de prix proposés (aperçu puis article_price_batch) ─────────

export type PriceChange = {
  id: string;
  purchase?: number;
  sale_ht?: number;
  sale_ttc?: number;
  coef?: number;
};

function withSaleTtc(a: { id: string; vat_rate: number; purchase_price: number }, ttc: number, purchase?: number): PriceChange {
  const vf = 1 + (a.vat_rate ?? 21) / 100;
  const ht = r3(ttc / vf);
  const pa = purchase ?? a.purchase_price;
  const out: PriceChange = { id: a.id, sale_ttc: r2(ttc), sale_ht: ht };
  if (purchase != null) out.purchase = purchase;
  if (pa > 0) out.coef = r4(ht / pa);
  return out;
}

// ─── Recalcul PA / PV par tranches de PA ─────────────────────────────────────

export type BracketMode = 'rate' | 'coef';

/** Une tranche « du … au … » de PA HT. `to` nul = sans limite. */
export type PriceBracket = {
  from: number | null;
  to: number | null;
  /** Mode « taux d'augmentation » : % sur PA et % sur PV. */
  paPct?: number | null;
  pvPct?: number | null;
  /** Mode « coefficient » : PV HT = PA × coefficient. */
  coef?: number | null;
};

export function findBracket(pa: number, brackets: PriceBracket[]): PriceBracket | null {
  for (const b of brackets) {
    const lo = b.from ?? 0;
    const hi = b.to ?? Infinity;
    if (pa >= lo && pa <= hi) return b;
  }
  return null;
}

/**
 * Nouveau PA / PV d'un article selon sa tranche de PA. Les verrous G8 sont respectés : PA
 * verrouillé → PA inchangé ; PV verrouillé → PV inchangé. `round` (facultatif) arrondit le PV TTC.
 * Renvoie null quand rien ne change.
 */
export function bracketChange(
  a: { id: string; purchase_price: number; sale_price_ttc: number; vat_rate: number; price_purchase_locked?: boolean; price_sale_locked?: boolean },
  mode: BracketMode,
  brackets: PriceBracket[],
  round?: (ttc: number) => number,
): PriceChange | null {
  const b = findBracket(a.purchase_price, brackets);
  if (!b) return null;
  const vf = 1 + (a.vat_rate ?? 21) / 100;
  let pa = a.purchase_price;
  let ttc = a.sale_price_ttc;
  if (mode === 'rate') {
    if (b.paPct && !a.price_purchase_locked) pa = r4(pa * (1 + b.paPct / 100));
    if (b.pvPct && !a.price_sale_locked) ttc = r2(ttc * (1 + b.pvPct / 100));
  } else {
    if (!b.coef || !(b.coef > 0) || a.price_sale_locked || !(pa > 0)) return null;
    ttc = r2(pa * b.coef * vf);
  }
  if (round && ttc !== a.sale_price_ttc && !a.price_sale_locked) ttc = round(ttc);
  const paChanged = pa !== a.purchase_price;
  const pvChanged = r2(ttc) !== r2(a.sale_price_ttc);
  if (!paChanged && !pvChanged) return null;
  if (!pvChanged) {
    // PA seul : le coefficient suit (PV HT / nouveau PA), le PV ne bouge pas.
    const ht = r3(a.sale_price_ttc / vf);
    return { id: a.id, purchase: pa, ...(pa > 0 ? { coef: r4(ht / pa) } : {}) };
  }
  return withSaleTtc(a, ttc, paChanged ? pa : undefined);
}

// ─── PV selon le PPC (articles existants) ────────────────────────────────────

/**
 * Applique les règles « PV selon PPC » (mêmes règles que l'import, table ppc_price_rules)
 * à un article existant : PV TTC = PPC TTC × (1 + % / 100), puis arrondi de la règle.
 * PV verrouillé, PPC absent ou aucune règle → null.
 */
export function ppcChange(
  a: { id: string; ppc_ttc: number | null; sale_price_ttc: number; vat_rate: number; purchase_price: number;
       supplier_name?: string | null; category_path?: string | null; brand?: string | null; price_sale_locked?: boolean },
  rules: PpcRule[],
): PriceChange | null {
  if (a.price_sale_locked || !a.ppc_ttc || !(a.ppc_ttc > 0)) return null;
  const rule = resolvePpcRule(
    { reference: '', rowIndex: 0, supplier_name: a.supplier_name ?? null, category_path: a.category_path ?? null, brand: a.brand ?? null },
    rules,
  );
  if (!rule) return null;
  const ttc = roundUpPrice(a.ppc_ttc * (1 + rule.pct / 100), rule.round_mode);
  if (ttc === r2(a.sale_price_ttc)) return null;
  return withSaleTtc(a, ttc);
}
