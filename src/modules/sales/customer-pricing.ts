/**
 * M1 / M6 — Tarifs clients appliques partout (vente, caisse, devis, OR) : logique PURE.
 * Rattrapage G8 du 18/11/2026 (lot « regles client », TAR / PDV005 / CON) ; teste dans
 * tests/tarifs-clients.test.ts.
 *
 * G8 (Fichiers > Clients > Tarif client) : un tarif nomme (« 15 = REMISE 15 % ») est partage par
 * plusieurs clients ; il a un tarif de base (ce qu'il ne precise pas est pris dans sa base), une
 * promotion, « afficher la remise », et des lignes par references / fournisseurs / familles avec
 * 4 paliers de quantite, un coefficient ou une remise, des dates de debut et de fin.
 *
 * Le DMS garde en plus ses regles PAR CLIENT (Clients > Tarifs clients et onglet « Tarifs » de la
 * fiche) : elles passent avant le tarif commun du client.
 *
 * Ordre de recherche (la premiere regle qui s'applique gagne) :
 *   1. regles propres au client (profondeur 0) ;
 *   2. tarif commun du client (profondeur 1), puis son tarif de base (2), la base de la base (3)... ;
 *   3. regles generales sans client (profondeur 99, ancienne table customer_price_rules) ;
 *   4. sinon le prix catalogue.
 * A profondeur egale : la portee la plus precise (reference > famille / categorie > fournisseur >
 * marque > tout le catalogue), la famille la plus longue, puis la regle la plus recente.
 * Une regle ne s'applique que dans ses dates et si un palier couvre la quantite (« Qte mini »).
 */

export type PriceKind = 'discount' | 'coefficient' | 'net';

/**
 * Reference G8 de l'article main-d'oeuvre (rayon 05 / sous-rayon 01) : une ligne MO sans article
 * (OR) se tarife comme cet article (regles « tout le catalogue » ou par reference MO_ATELIER).
 */
export const LABOUR_PRICING_REFERENCE = 'MO_ATELIER';
export type PriceScope = 'reference' | 'category' | 'family' | 'supplier' | 'brand' | 'all';
export type PriceTier = { min_qty: number; value: number };

/** Regle normalisee, quelle que soit sa table d'origine. */
export type PricingRule = {
  id: string;
  /** client = regle propre au client ; list = ligne d'un tarif commun ; global = regle sans client. */
  source: 'client' | 'list' | 'global';
  /** 0 client, 1 tarif du client, 2+ tarifs de base, 99 regles generales. */
  depth: number;
  listId?: string | null;
  listCode?: string | null;
  scope: PriceScope;
  articleId?: string | null;
  /** Portee reference saisie en texte (onglet Tarifs de la fiche client). */
  reference?: string | null;
  categoryId?: string | null;
  familyCode?: string | null;
  supplierId?: string | null;
  /** Fournisseur saisi en texte (code ou nom). */
  supplierText?: string | null;
  brand?: string | null;
  kind: PriceKind;
  tiers: PriceTier[];
  dateFrom?: string | null;
  dateTo?: string | null;
  isPromo?: boolean;
  /** Afficher la remise (G8) : faux = prix net sur la ligne. Defaut : vrai. */
  showDiscount?: boolean;
  createdAt?: string | null;
};

/** Ce qu'il faut savoir de l'article pour choisir la regle. */
export type PricingArticle = {
  id: string;
  reference?: string | null;
  categoryId?: string | null;
  categoryPath?: string | null;
  supplierId?: string | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  brand?: string | null;
  /** PA HT (coefficient : PV HT = PA x coef). */
  purchasePrice?: number | null;
};

export type ResolvedSalePrice = {
  /** PV HT catalogue (arrondi societe deja applique par l'appelant). */
  baseHt: number;
  /** PV HT net du client. */
  netHt: number;
  /** PU HT a poser sur la ligne. */
  unitPriceHt: number;
  /** Remise % a poser sur la ligne (0 si prix net affiche). */
  discountPct: number;
  rule: PricingRule | null;
  isPromo: boolean;
  listCode: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const SCOPE_RANK: Record<PriceScope, number> = { reference: 5, category: 4, family: 4, supplier: 3, brand: 2, all: 1 };

/** Paliers propres : quantites > 0, valeurs >= 0, tries, 4 au plus (G8 : 4 tranches). */
export function cleanTiers(tiers: readonly { min_qty?: unknown; value?: unknown }[] | null | undefined): PriceTier[] {
  const out = (tiers ?? [])
    .map((t) => ({ min_qty: num(t?.min_qty), value: num(t?.value) }))
    .filter((t) => t.min_qty > 0 && t.value >= 0)
    .sort((a, b) => a.min_qty - b.min_qty);
  const seen = new Set<number>();
  return out.filter((t) => (seen.has(t.min_qty) ? false : (seen.add(t.min_qty), true))).slice(0, 4);
}

/** Palier applicable : la plus grande quantite minimum <= quantite vendue ; aucun = la regle ne s'applique pas. */
export function tierFor(tiers: readonly PriceTier[], qty: number): PriceTier | null {
  const q = Math.abs(num(qty)) || 1;
  let best: PriceTier | null = null;
  for (const t of tiers) if (t.min_qty <= q + 1e-9 && (!best || t.min_qty > best.min_qty)) best = t;
  return best;
}

/** La regle est-elle valable a cette date (AAAA-MM-JJ) ? */
export function ruleActiveOn(rule: Pick<PricingRule, 'dateFrom' | 'dateTo'>, date: string): boolean {
  if (rule.dateFrom && date < rule.dateFrom) return false;
  if (rule.dateTo && date > rule.dateTo) return false;
  return true;
}

/** La regle vise-t-elle cet article ? */
export function ruleMatches(rule: PricingRule, a: PricingArticle): boolean {
  switch (rule.scope) {
    case 'all': return true;
    case 'reference':
      if (rule.articleId) return rule.articleId === a.id;
      return !!rule.reference && norm(rule.reference) === norm(a.reference);
    case 'category':
      return !!rule.categoryId && rule.categoryId === a.categoryId;
    case 'family': {
      const code = norm(rule.familyCode);
      return !!code && norm(a.categoryPath).startsWith(code);
    }
    case 'supplier':
      if (rule.supplierId) return rule.supplierId === a.supplierId;
      return !!rule.supplierText && [a.supplierCode, a.supplierName].some((x) => !!x && norm(x) === norm(rule.supplierText));
    case 'brand':
      return !!rule.brand && norm(rule.brand) === norm(a.brand);
    default: return false;
  }
}

/** Ordre de priorite (plus petit = gagne). */
export function compareRules(x: PricingRule, y: PricingRule): number {
  if (x.depth !== y.depth) return x.depth - y.depth;
  const sx = SCOPE_RANK[x.scope] ?? 0, sy = SCOPE_RANK[y.scope] ?? 0;
  if (sx !== sy) return sy - sx;
  const fx = norm(x.familyCode).length, fy = norm(y.familyCode).length;
  if (fx !== fy) return fy - fx;
  return (y.createdAt ?? '').localeCompare(x.createdAt ?? '');
}

/** Prix net HT d'une regle pour un palier, ou null si elle ne peut pas donner de prix (PA inconnu...). */
export function netPriceFor(kind: PriceKind, value: number, baseHt: number, purchasePrice: number | null | undefined): number | null {
  if (kind === 'discount') {
    if (!(baseHt > 0)) return null;
    return r2(baseHt * (1 - Math.min(Math.max(value, 0), 100) / 100));
  }
  if (kind === 'coefficient') {
    const pa = num(purchasePrice);
    if (!(pa > 0) || !(value > 0)) return null;
    return r2(pa * value);
  }
  return value > 0 ? r2(value) : null;
}

/**
 * Prix d'un article pour un client (fonction centrale, appelee par la vente, la caisse, le devis
 * et l'OR). `showDiscounts` = case client « Afficher remises en caisse » : faux, la remise est
 * fondue dans le prix (prix net) meme si le tarif l'affiche.
 */
export function resolveSalePrice(p: {
  article: PricingArticle; baseHt: number; qty?: number; date: string; rules: readonly PricingRule[]; showDiscounts?: boolean;
}): ResolvedSalePrice {
  const baseHt = r2(Math.max(num(p.baseHt), 0));
  const none: ResolvedSalePrice = { baseHt, netHt: baseHt, unitPriceHt: baseHt, discountPct: 0, rule: null, isPromo: false, listCode: null };
  const candidates = p.rules.filter((r) => ruleActiveOn(r, p.date) && ruleMatches(r, p.article)).sort(compareRules);
  for (const rule of candidates) {
    const tier = tierFor(cleanTiers(rule.tiers), p.qty ?? 1);
    if (!tier) continue;
    const net = netPriceFor(rule.kind, tier.value, baseHt, p.article.purchasePrice);
    if (net == null) continue;
    const show = rule.showDiscount !== false && p.showDiscounts !== false;
    // Remise affichee : PU catalogue + remise % (exacte, deux decimales comme en base).
    const asDiscount = show && rule.kind === 'discount' && baseHt > 0 && tier.value > 0;
    return {
      baseHt, netHt: net,
      unitPriceHt: asDiscount ? baseHt : net,
      discountPct: asDiscount ? r2(Math.min(tier.value, 100)) : 0,
      rule, isPromo: !!rule.isPromo, listCode: rule.listCode ?? null,
    };
  }
  return none;
}

/* ------------------------------------------------------------------------------------------------
 * Normalisation des trois sources (tables) vers PricingRule.
 * ---------------------------------------------------------------------------------------------- */

export type PriceListRow = {
  id: string; code: string; label?: string | null; base_list_id?: string | null;
  is_promo?: boolean | null; show_discount?: boolean | null; is_active?: boolean | null;
};
export type PriceListRuleRow = {
  id: string; price_list_id: string; scope: string; article_id?: string | null; supplier_id?: string | null;
  family_code?: string | null; brand?: string | null; kind: string; tiers: unknown;
  date_from?: string | null; date_to?: string | null; created_at?: string | null;
};
/** Ancienne table `customer_price_rules` (Clients > Tarifs clients). */
export type CustomerPriceRuleRow = {
  id: string; contact_id?: string | null; article_id?: string | null; category_id?: string | null;
  kind: string; value?: number | string | null; tiers?: unknown; is_active?: boolean | null; created_at?: string | null;
};
/** Table `client_price_rules` (onglet « Tarifs » de la fiche client). */
export type ClientPriceRuleRow = {
  id: string; target_type: string; target_value?: string | null; mode: string;
  value1?: number | string | null; qty2?: number | string | null; value2?: number | string | null;
  qty3?: number | string | null; value3?: number | string | null; is_promo?: boolean | null;
  date_from?: string | null; date_to?: string | null; created_at?: string | null;
};

/** Tarif du client puis ses tarifs de base, dans l'ordre (inactifs ignores, boucle coupee, 10 au plus). */
export function priceListChain(lists: readonly PriceListRow[], startId: string | null | undefined): (PriceListRow & { depth: number })[] {
  const byId = new Map(lists.map((l) => [l.id, l]));
  const out: (PriceListRow & { depth: number })[] = [];
  const seen = new Set<string>();
  let cur = startId ? byId.get(startId) : undefined;
  while (cur && !seen.has(cur.id) && out.length < 10) {
    seen.add(cur.id);
    if (cur.is_active !== false) out.push({ ...cur, depth: out.length + 1 });
    cur = cur.base_list_id ? byId.get(cur.base_list_id) : undefined;
  }
  return out;
}

/**
 * Tarif du client : la fiche (price_list_id), sinon l'ancienne colonne texte reprise de G8
 * (`price_list`, ex. « 15 » ou « REMISE 15 % ») comparee au code puis au libelle des tarifs.
 */
export function clientPriceListId(contact: { price_list_id?: string | null; price_list?: string | null }, lists: readonly PriceListRow[]): string | null {
  if (contact.price_list_id && lists.some((l) => l.id === contact.price_list_id)) return contact.price_list_id;
  const txt = norm(contact.price_list);
  if (!txt) return null;
  return lists.find((l) => norm(l.code) === txt)?.id ?? lists.find((l) => norm(l.label) === txt)?.id ?? null;
}

const LIST_SCOPES: readonly string[] = ['all', 'reference', 'supplier', 'family', 'brand'];
const KINDS: readonly string[] = ['discount', 'coefficient', 'net'];

export function fromPriceListRule(r: PriceListRuleRow, list: PriceListRow & { depth: number }): PricingRule | null {
  if (!LIST_SCOPES.includes(r.scope) || !KINDS.includes(r.kind)) return null;
  return {
    id: r.id, source: 'list', depth: list.depth, listId: list.id, listCode: list.code,
    scope: r.scope as PriceScope, articleId: r.article_id ?? null, supplierId: r.supplier_id ?? null,
    familyCode: r.family_code ?? null, brand: r.brand ?? null,
    kind: r.kind as PriceKind, tiers: cleanTiers(Array.isArray(r.tiers) ? r.tiers : []),
    dateFrom: r.date_from ?? null, dateTo: r.date_to ?? null,
    isPromo: !!list.is_promo, showDiscount: list.show_discount !== false, createdAt: r.created_at ?? null,
  };
}

export function fromCustomerPriceRule(r: CustomerPriceRuleRow, contactId: string): PricingRule | null {
  if (r.is_active === false) return null;
  if (r.contact_id && r.contact_id !== contactId) return null;
  const scope: PriceScope = r.article_id ? 'reference' : r.category_id ? 'category' : 'all';
  let kind: PriceKind; let tiers: PriceTier[];
  if (r.kind === 'coefficient') { kind = 'coefficient'; tiers = cleanTiers([{ min_qty: 1, value: r.value }]); }
  else if (r.kind === 'net_price') { kind = 'net'; tiers = cleanTiers([{ min_qty: 1, value: r.value }]); }
  else if (r.kind === 'quantity_tiers') {
    kind = 'discount';
    const raw = Array.isArray(r.tiers) ? (r.tiers as { min_qty?: unknown; discount_pct?: unknown }[]) : [];
    tiers = cleanTiers(raw.map((t) => ({ min_qty: t?.min_qty, value: t?.discount_pct })));
  } else { kind = 'discount'; tiers = cleanTiers([{ min_qty: 1, value: r.value }]); }
  return {
    id: r.id, source: r.contact_id ? 'client' : 'global', depth: r.contact_id ? 0 : 99,
    scope, articleId: r.article_id ?? null, categoryId: r.category_id ?? null,
    kind, tiers, isPromo: false, showDiscount: true, createdAt: r.created_at ?? null,
  };
}

export function fromClientPriceRule(r: ClientPriceRuleRow): PricingRule | null {
  const kind: PriceKind | null = r.mode === 'discount' ? 'discount' : r.mode === 'coef' ? 'coefficient' : r.mode === 'net' ? 'net' : null;
  if (!kind) return null;
  const tv = (r.target_value ?? '').trim();
  const base = {
    id: r.id, source: 'client' as const, depth: 0, kind,
    tiers: cleanTiers([
      { min_qty: 1, value: r.value1 },
      ...(r.qty2 != null && r.value2 != null ? [{ min_qty: r.qty2, value: r.value2 }] : []),
      ...(r.qty3 != null && r.value3 != null ? [{ min_qty: r.qty3, value: r.value3 }] : []),
    ].filter((t) => t.value != null && t.value !== '')),
    dateFrom: r.date_from ?? null, dateTo: r.date_to ?? null, isPromo: !!r.is_promo, showDiscount: true, createdAt: r.created_at ?? null,
  };
  switch (r.target_type) {
    case 'all': return { ...base, scope: 'all' };
    case 'reference': return tv ? { ...base, scope: 'reference', reference: tv } : null;
    case 'category': return tv ? { ...base, scope: 'family', familyCode: tv } : null;
    case 'supplier': return tv ? { ...base, scope: 'supplier', supplierText: tv } : null;
    case 'brand': return tv ? { ...base, scope: 'brand', brand: tv } : null;
    default: return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Cases de la fiche client a la vente (G8 « Conditions et tarifs » + « Infos compta »).
 * ---------------------------------------------------------------------------------------------- */

export type SaleClientFlags = {
  is_blocked?: boolean | null; is_watch?: boolean | null; watch_note?: string | null;
  is_detaxe?: boolean | null; mode_ht?: boolean | null; show_discounts_pos?: boolean | null;
  receipt_copies?: number | null; credit_limit?: number | null; credit_limit_blocking?: boolean | null;
  payment_terms?: string | null; sale_vat_type?: string | null;
};

/** Types de documents de vente refuses pour un client bloque (devis, avoir : permis). Meme liste en base. */
export const BLOCKED_DOC_TYPES = ['FAC', 'TIK', 'RES', 'BL', 'BC'] as const;
/** Documents « a credit » refuses au-dela de l'encours quand l'encours est bloquant. */
export const CREDIT_DOC_TYPES = ['FAC', 'BL'] as const;

export const isBlockedSale = (contact: SaleClientFlags | null | undefined, docType: string): boolean =>
  !!contact?.is_blocked && (BLOCKED_DOC_TYPES as readonly string[]).includes(docType);

/** Pied de facture propose par la fiche : detaxe => HT + TVA 0 % export ; mode HT => saisie HT. */
export function clientPriceDefaults(contact: SaleClientFlags | null | undefined): { priceMode: 'ht' | 'ttc'; taxExempt: boolean } | null {
  if (!contact) return null;
  if (contact.is_detaxe) return { priceMode: 'ht', taxExempt: true };
  if (contact.mode_ht) return { priceMode: 'ht', taxExempt: false };
  return null;
}

export type CreditCheck = { limit: number; balance: number; documentDue: number; total: number; exceeded: boolean; blocking: boolean };

/**
 * Encours autorise (G8 « Infos compta ») : depasse si reste du actuel + ce document > autorise.
 * Une limite a 0 = pas de limite (valeur par defaut de toutes les fiches).
 */
export function creditCheck(contact: SaleClientFlags | null | undefined, balance: number, documentDue: number): CreditCheck {
  const limit = Math.max(num(contact?.credit_limit), 0);
  const total = r2(num(balance) + Math.max(num(documentDue), 0));
  const exceeded = limit > 0 && total > limit + 0.004;
  return { limit, balance: r2(num(balance)), documentDue: r2(Math.max(num(documentDue), 0)), total, exceeded, blocking: exceeded && !!contact?.credit_limit_blocking };
}

/** Faut-il refuser la validation pour l'encours ? (documents a credit seulement) */
export const creditRefuses = (check: CreditCheck, docType: string): boolean =>
  check.blocking && (CREDIT_DOC_TYPES as readonly string[]).includes(docType);

/**
 * Conditions de reglement par defaut (fiche client) -> echeance du document.
 * « immediat », « comptant », vide : a la date du document ; « 30j », « 30 jours », « 30 jours fin de
 * mois » : + N jours (fin de mois si demande). Texte inconnu : pas d'echeance proposee.
 */
export function dueDateFromTerms(terms: string | null | undefined, issueDate: string): string | null {
  const s = (terms ?? '').trim().toLowerCase();
  if (!issueDate) return null;
  if (!s || /imm.diat|comptant|cash|r.ception/.test(s)) return s ? issueDate : null;
  const m = s.match(/(\d{1,3})\s*(j|jour|jours|d|days?)?\b/);
  if (!m) return null;
  const [y, mo, d] = issueDate.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d + Number(m[1])));
  if (/fin\s*de\s*mois|fdm|eom/.test(s)) dt.setUTCMonth(dt.getUTCMonth() + 1, 0);
  return dt.toISOString().slice(0, 10);
}

/** Nombre d'exemplaires du ticket (G8 « Nombre d'exemplaires en caisse », 0 = 1 par defaut, 5 au plus). */
export const receiptCopies = (contact: SaleClientFlags | null | undefined): number =>
  Math.min(Math.max(Math.round(num(contact?.receipt_copies)), 1), 5);
