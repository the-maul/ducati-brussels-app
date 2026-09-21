// Mission 03 — « Une vente sur le site crée la vente et la sortie de stock dans le DMS ».
//
// Règles PURES (sans accès réseau ni base), importées par la fonction serveur shopify-orders et
// testées par tests/shopify-orders.test.ts :
//   - vérification de la signature des webhooks Shopify (HMAC-SHA256 du corps brut, clé = Client
//     secret de l'application, en base64 dans l'en-tête X-Shopify-Hmac-Sha256) ;
//   - lecture d'une commande de l'API GraphQL Admin en une forme simple (ShopOrder) ;
//   - commande → lignes de la facture du DMS (décision W-7 : prix Shopify TVA comprise, HT déduit par
//     le taux de TVA de l'article ; frais de port en LIGNE À PART ; remises Shopify en remise de ligne) ;
//   - remboursement Shopify → lignes de l'avoir (lignes en négatif, stock réintégré si Shopify a remis
//     l'article en stock).
// Un produit Shopify non relié à un article reste une ligne libre avec son montant (jamais d'article
// inventé) et compte comme « à relier ».

// ---------------------------------------------------------------- Signature des webhooks

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Comparaison en temps constant. */
function sameText(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** HMAC-SHA256 du corps brut, en base64 (même calcul que Shopify). */
export async function shopifyHmac(rawBody: string | Uint8Array, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = typeof rawBody === 'string' ? enc.encode(rawBody) : rawBody;
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return toBase64(new Uint8Array(sig));
}

/** Le webhook vient-il bien de Shopify ? Secret absent ou en-tête absent : non (fermé par défaut). */
export async function verifyShopifyHmac(rawBody: string | Uint8Array, header: string | null | undefined, secret: string | null | undefined): Promise<boolean> {
  if (!secret || !header) return false;
  const expected = await shopifyHmac(rawBody, secret);
  return sameText(expected, header.trim());
}

// ---------------------------------------------------------------- Commande Shopify (forme simple)

export type ShopOrderLine = {
  id: string;                 // gid://shopify/LineItem/…
  variantId: string | null;   // gid://shopify/ProductVariant/… (clé de shopify_links)
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;          // prix unitaire affiché par Shopify (TTC si taxesIncluded)
  discount: number;           // remises Shopify réparties sur la ligne (montant, même base que le prix)
  taxRate: number | null;     // taux Shopify en % (21) si connu
};

export type ShopShippingLine = { title: string; price: number; discount: number; taxRate: number | null };

export type ShopRefundLine = { lineItemId: string; quantity: number; restock: boolean };

export type ShopRefund = {
  id: string;                 // gid://shopify/Refund/…
  createdAt: string;
  amount: number;             // argent réellement rendu (transactions de remboursement réussies)
  gateways: string[];
  lines: ShopRefundLine[];
};

export type ShopTransaction = { kind: string; status: string; gateway: string | null; amount: number };

export type ShopAddress = {
  firstName: string | null; lastName: string | null; company: string | null;
  address1: string | null; address2: string | null; zip: string | null; city: string | null;
  countryCode: string | null; phone: string | null;
};

export type ShopOrder = {
  id: string;                 // gid://shopify/Order/…
  name: string;               // « #1001 »
  createdAt: string;
  updatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  test: boolean;
  email: string | null;
  phone: string | null;
  taxesIncluded: boolean;
  financialStatus: string | null; // PAID, PENDING, AUTHORIZED, PARTIALLY_REFUNDED, REFUNDED, VOIDED…
  currency: string | null;
  total: number;              // total payé à la commande (TTC)
  customer: { id: string | null; firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
  billing: ShopAddress | null;
  shipping: ShopAddress | null;
  lines: ShopOrderLine[];
  shippingLines: ShopShippingLine[];
  transactions: ShopTransaction[];
  refunds: ShopRefund[];
};

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const money = (set: any): number => num(set?.shopMoney?.amount);
const nodes = (c: any): any[] => (Array.isArray(c) ? c : Array.isArray(c?.nodes) ? c.nodes : Array.isArray(c?.edges) ? c.edges.map((e: any) => e?.node) : []);
const sumAlloc = (allocs: any): number => nodes(allocs).reduce((s: number, a: any) => s + money(a?.allocatedAmountSet), 0);
/** Taux Shopify (0.21) → pourcentage (21), arrondi à 2 décimales. */
const ratePct = (taxLines: any): number | null => {
  const tl = nodes(taxLines).find((x: any) => x && (x.ratePercentage != null || x.rate != null));
  if (!tl) return null;
  const pct = tl.ratePercentage != null ? num(tl.ratePercentage) : num(tl.rate) * 100;
  return Math.round(pct * 100) / 100;
};
const address = (a: any): ShopAddress | null => a ? ({
  firstName: str(a.firstName), lastName: str(a.lastName), company: str(a.company),
  address1: str(a.address1), address2: str(a.address2), zip: str(a.zip), city: str(a.city),
  countryCode: str(a.countryCodeV2 ?? a.countryCode), phone: str(a.phone),
}) : null;

/** Requête GraphQL Admin (2026-07) d'une commande : ce que normalizeGraphqlOrder sait lire. */
export const ORDER_FIELDS = `
  id name createdAt updatedAt cancelledAt cancelReason test email phone taxesIncluded
  displayFinancialStatus currencyCode
  totalPriceSet { shopMoney { amount } }
  customer { id firstName lastName email phone }
  billingAddress { firstName lastName company address1 address2 zip city countryCodeV2 phone }
  shippingAddress { firstName lastName company address1 address2 zip city countryCodeV2 phone }
  lineItems(first: 100) { nodes {
    id title variantTitle sku quantity
    variant { id }
    originalUnitPriceSet { shopMoney { amount } }
    discountAllocations { allocatedAmountSet { shopMoney { amount } } }
    taxLines { rate ratePercentage }
  } }
  shippingLines(first: 10) { nodes {
    title
    originalPriceSet { shopMoney { amount } }
    discountAllocations { allocatedAmountSet { shopMoney { amount } } }
    taxLines { rate ratePercentage }
  } }
  transactions(first: 50) { kind status gateway amountSet { shopMoney { amount } } }
  refunds(first: 50) {
    id createdAt
    refundLineItems(first: 100) { nodes { lineItem { id } quantity restockType restocked } }
    transactions(first: 20) { nodes { kind status gateway amountSet { shopMoney { amount } } } }
  }
`;

const RESTOCK_TYPES = new Set(['RETURN', 'CANCEL', 'LEGACY_RESTOCK']);

/** Nœud GraphQL Order → ShopOrder. */
export function normalizeGraphqlOrder(o: any): ShopOrder {
  const txOk = (t: any) => String(t?.status ?? '').toUpperCase() === 'SUCCESS';
  return {
    id: String(o?.id ?? ''),
    name: str(o?.name) ?? String(o?.id ?? ''),
    createdAt: String(o?.createdAt ?? ''),
    updatedAt: str(o?.updatedAt),
    cancelledAt: str(o?.cancelledAt),
    cancelReason: str(o?.cancelReason),
    test: o?.test === true,
    email: str(o?.email)?.toLowerCase() ?? null,
    phone: str(o?.phone),
    taxesIncluded: o?.taxesIncluded !== false,
    financialStatus: str(o?.displayFinancialStatus),
    currency: str(o?.currencyCode),
    total: money(o?.totalPriceSet),
    customer: o?.customer ? {
      id: str(o.customer.id), firstName: str(o.customer.firstName), lastName: str(o.customer.lastName),
      email: str(o.customer.email)?.toLowerCase() ?? null, phone: str(o.customer.phone),
    } : null,
    billing: address(o?.billingAddress),
    shipping: address(o?.shippingAddress),
    lines: nodes(o?.lineItems).map((l: any) => ({
      id: String(l?.id ?? ''),
      variantId: str(l?.variant?.id),
      title: str(l?.title) ?? '—',
      variantTitle: str(l?.variantTitle),
      sku: str(l?.sku),
      quantity: num(l?.quantity),
      unitPrice: money(l?.originalUnitPriceSet),
      discount: sumAlloc(l?.discountAllocations),
      taxRate: ratePct(l?.taxLines),
    })),
    shippingLines: nodes(o?.shippingLines).map((s: any) => ({
      title: str(s?.title) ?? 'Livraison',
      price: money(s?.originalPriceSet),
      discount: sumAlloc(s?.discountAllocations),
      taxRate: ratePct(s?.taxLines),
    })),
    transactions: nodes(o?.transactions).map((t: any) => ({
      kind: String(t?.kind ?? '').toUpperCase(), status: String(t?.status ?? '').toUpperCase(),
      gateway: str(t?.gateway), amount: money(t?.amountSet),
    })),
    refunds: nodes(o?.refunds).map((r: any) => {
      const tx = nodes(r?.transactions).filter((t: any) => txOk(t) && String(t?.kind ?? '').toUpperCase() === 'REFUND');
      return {
        id: String(r?.id ?? ''),
        createdAt: String(r?.createdAt ?? ''),
        amount: r2(tx.reduce((s: number, t: any) => s + money(t?.amountSet), 0)),
        gateways: [...new Set(tx.map((t: any) => str(t?.gateway)).filter(Boolean) as string[])],
        lines: nodes(r?.refundLineItems).map((x: any) => ({
          lineItemId: String(x?.lineItem?.id ?? ''),
          quantity: num(x?.quantity),
          restock: x?.restocked === true || RESTOCK_TYPES.has(String(x?.restockType ?? '').toUpperCase()),
        })),
      };
    }),
  };
}

// ---------------------------------------------------------------- Décisions

/** Statuts de paiement Shopify qui déclenchent la vente dans le DMS (argent encaissé). */
export const PAID_STATUSES = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

export type ImportDecision = 'import' | 'wait_payment' | 'cancelled_before_import' | 'test_order';

/** Que faire d'une commande pas encore importée ? */
export function importDecision(o: Pick<ShopOrder, 'financialStatus' | 'cancelledAt' | 'test'>): ImportDecision {
  if (o.test) return 'test_order';
  const paid = (PAID_STATUSES as readonly string[]).includes((o.financialStatus ?? '').toUpperCase());
  if (paid) return 'import';
  return o.cancelledAt ? 'cancelled_before_import' : 'wait_payment';
}

/**
 * Remboursements pas encore passés en avoir (idempotence : un avoir par remboursement Shopify).
 * Un « remboursement » sans argent rendu (retour ou modification de commande à 0 €, vu en réel sur
 * la commande #1209) ne crée pas d'avoir : il est signalé à vérifier (zeroAmountRefunds).
 */
export function refundsToApply(refunds: ShopRefund[], alreadyApplied: Iterable<string>): ShopRefund[] {
  const done = new Set(alreadyApplied);
  const seen = new Set<string>();
  return refunds.filter((r) => {
    if (!r.id || done.has(r.id) || seen.has(r.id)) return false;
    seen.add(r.id);
    return r.amount > 0.004;
  });
}

/** Remboursements à 0 € avec des articles : pas d'avoir, mais la commande est à vérifier. */
export function zeroAmountRefunds(refunds: ShopRefund[]): ShopRefund[] {
  return refunds.filter((r) => r.amount <= 0.004 && r.lines.some((l) => l.quantity > 0));
}

// ---------------------------------------------------------------- Commande → facture

export type LinkedArticle = { articleId: string; reference: string | null; designation: string | null; vatRate: number | null };

export type SaleLine = {
  kind: 'item' | 'shipping' | 'adjustment';
  shopifyLineId: string | null;
  variantId: string | null;
  articleId: string | null;       // null = produit non relié (ligne libre, « à relier ») ou port
  designation: string;
  reference: string | null;
  quantity: number;
  unitPriceHt: number;            // 3 décimales (colonne document_lines.unit_price_ht)
  vatRate: number;
  discountPct: number;            // remise Shopify en remise de ligne (2 décimales)
  lineHt: number;
  lineTtc: number;
};

export type PaymentLine = { method: string; amount: number; note: string };

export type SaleMapping = {
  lines: SaleLine[];
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  /** Total Shopify si la somme des lignes s'en écarte (net TTC forcé, comme le pied de facture). */
  forcedTtc: number | null;
  unlinked: number;               // lignes produit sans article relié
  payments: PaymentLine[];
  warnings: string[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const DEFAULT_VAT = 21;

/**
 * Montants d'une ligne à partir du prix Shopify.
 * TVA comprise (cas normal, W-7) : TTC = prix × qté − remise ; HT = TTC / (1 + taux).
 * Boutique réglée « hors TVA » (taxesIncluded = false) : le prix est HT.
 */
export function lineAmounts(unitPrice: number, quantity: number, discount: number, vatRate: number, taxesIncluded: boolean) {
  const gross = unitPrice * quantity;
  const k = 1 + vatRate / 100;
  const discountPct = gross > 0 ? r2((discount / gross) * 100) : 0;
  if (taxesIncluded) {
    const lineTtc = r2(gross - discount);
    return { unitPriceHt: r3(unitPrice / k), lineHt: r2(lineTtc / k), lineTtc, discountPct };
  }
  const lineHt = r2(gross - discount);
  return { unitPriceHt: r3(unitPrice), lineHt, lineTtc: r2(lineHt * k), discountPct };
}

/** Moyen de règlement du DMS pour une passerelle Shopify (Paramètres → Tables → moyens de règlement). */
export function paymentMethodFor(gateway: string | null | undefined): string {
  const g = (gateway ?? '').toLowerCase();
  if (g.includes('paypal')) return 'PPL';
  if (g.includes('gift_card') || g.includes('gift card')) return 'CHQC';
  if (g.includes('bank') || g.includes('virement') || g.includes('transfer')) return 'VIR'; // « Bank Deposit » (payé à la main)
  return 'SHOP';
}

const titleOf = (l: ShopOrderLine) => [l.title, l.variantTitle && l.variantTitle !== 'Default Title' ? l.variantTitle : null].filter(Boolean).join(' — ');

/**
 * Commande Shopify → lignes de la facture du DMS.
 * `links` : variante Shopify → article relié (liaisons auto_exact / valide de shopify_links).
 */
export function mapOrderToSale(order: ShopOrder, links: Record<string, LinkedArticle | undefined>): SaleMapping {
  const lines: SaleLine[] = [];
  const warnings: string[] = [];
  let unlinked = 0;

  for (const l of order.lines) {
    if (l.quantity <= 0) continue; // ligne entièrement retirée avant paiement
    const a = l.variantId ? links[l.variantId] : undefined;
    if (!a) unlinked++;
    // W-7 : taux de l'article ; ligne non reliée : taux Shopify, à défaut 21 %.
    const vatRate = a ? (a.vatRate ?? DEFAULT_VAT) : (l.taxRate ?? DEFAULT_VAT);
    const amt = lineAmounts(l.unitPrice, l.quantity, l.discount, vatRate, order.taxesIncluded);
    const shopTitle = titleOf(l);
    lines.push({
      kind: 'item', shopifyLineId: l.id, variantId: l.variantId, articleId: a?.articleId ?? null,
      designation: a ? (a.designation || shopTitle) : shopTitle,
      reference: a ? (a.reference ?? l.sku) : l.sku,
      quantity: l.quantity, vatRate, ...amt,
    });
  }

  // W-7 : frais de port = ligne à part (pas le champ « port » du pied de facture).
  for (const s of order.shippingLines) {
    const net = s.price - s.discount;
    if (net <= 0.004) continue; // livraison gratuite : pas de ligne
    const vatRate = s.taxRate ?? DEFAULT_VAT;
    const amt = lineAmounts(s.price, 1, s.discount, vatRate, order.taxesIncluded);
    lines.push({
      kind: 'shipping', shopifyLineId: null, variantId: null, articleId: null,
      designation: `Frais de port — ${s.title}`, reference: null, quantity: 1, vatRate, ...amt,
    });
  }

  const totalHt = r2(lines.reduce((s, l) => s + l.lineHt, 0));
  const totalTtc = r2(lines.reduce((s, l) => s + l.lineTtc, 0));
  let forcedTtc: number | null = null;
  if (order.total > 0 && Math.abs(order.total - totalTtc) > 0.01) {
    forcedTtc = r2(order.total);
    warnings.push(`total_mismatch:${totalTtc}->${order.total}`);
  }
  const ttc = forcedTtc ?? totalTtc;

  // Règlements reçus : transactions de vente / capture réussies, par passerelle.
  const byMethod = new Map<string, { amount: number; gateways: Set<string> }>();
  for (const t of order.transactions) {
    if (t.status !== 'SUCCESS' || (t.kind !== 'SALE' && t.kind !== 'CAPTURE')) continue;
    const m = paymentMethodFor(t.gateway);
    const cur = byMethod.get(m) ?? { amount: 0, gateways: new Set<string>() };
    cur.amount += t.amount;
    if (t.gateway) cur.gateways.add(t.gateway);
    byMethod.set(m, cur);
  }
  let payments: PaymentLine[] = [...byMethod.entries()].map(([method, v]) => ({
    method, amount: r2(v.amount), note: `Commande site ${order.name} (${[...v.gateways].join(', ') || 'Shopify'})`,
  }));
  const paidSum = r2(payments.reduce((s, p) => s + p.amount, 0));
  if (payments.length === 0 || Math.abs(paidSum - ttc) > 0.01) {
    if (payments.length > 0) warnings.push(`payment_mismatch:${paidSum}->${ttc}`);
    payments = [{ method: 'SHOP', amount: ttc, note: `Commande site ${order.name} (Shopify Payments)` }];
  }

  return { lines, totalHt, totalVat: r2(ttc - totalHt), totalTtc: ttc, forcedTtc, unlinked, payments, warnings };
}

// ---------------------------------------------------------------- Remboursement → avoir

/** Ligne de la facture d'origine, telle qu'enregistrée (pour recopier les montants à l'avoir). */
export type InvoiceLine = {
  shopifyLineId: string;
  articleId: string | null;
  designation: string;
  reference: string | null;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
  discountPct: number;
  lineHt: number;
  lineTtc: number;
};

export type CreditLine = SaleLine & { restock: boolean };

export type CreditMapping = { lines: CreditLine[]; totalHt: number; totalVat: number; totalTtc: number; refundAmount: number; method: string };

/**
 * Remboursement Shopify → avoir du DMS : lignes remboursées en négatif (au prorata de la ligne
 * facturée) ; l'écart avec l'argent réellement rendu (port remboursé, geste commercial, retenue)
 * devient une ligne « Ajustement du remboursement » à 21 %. Total de l'avoir = − argent rendu.
 */
export function mapRefundToCredit(refund: ShopRefund, invoiceLines: InvoiceLine[]): CreditMapping {
  const byId = new Map(invoiceLines.map((l) => [l.shopifyLineId, l]));
  const lines: CreditLine[] = [];
  for (const rl of refund.lines) {
    const src = byId.get(rl.lineItemId);
    if (!src || rl.quantity <= 0 || src.quantity <= 0) continue;
    const q = Math.min(rl.quantity, src.quantity);
    const ratio = q / src.quantity;
    lines.push({
      kind: 'item', shopifyLineId: src.shopifyLineId, variantId: null, articleId: src.articleId,
      designation: src.designation, reference: src.reference, quantity: -q,
      unitPriceHt: src.unitPriceHt, vatRate: src.vatRate, discountPct: src.discountPct,
      lineHt: -r2(src.lineHt * ratio), lineTtc: -r2(src.lineTtc * ratio),
      restock: rl.restock && !!src.articleId,
    });
  }
  const itemsTtc = r2(lines.reduce((s, l) => s + l.lineTtc, 0)); // négatif
  const gap = r2(-refund.amount - itemsTtc);                        // négatif = plus rendu que les articles
  if (Math.abs(gap) > 0.004) {
    const k = 1 + DEFAULT_VAT / 100;
    lines.push({
      kind: 'adjustment', shopifyLineId: null, variantId: null, articleId: null,
      designation: gap < 0 ? 'Ajustement du remboursement (port ou geste commercial)' : 'Retenue sur remboursement',
      reference: null, quantity: gap < 0 ? -1 : 1, unitPriceHt: r3(Math.abs(gap) / k), vatRate: DEFAULT_VAT, discountPct: 0,
      lineHt: r2(gap / k), lineTtc: gap, restock: false,
    });
  }
  const totalHt = r2(lines.reduce((s, l) => s + l.lineHt, 0));
  const totalTtc = r2(lines.reduce((s, l) => s + l.lineTtc, 0));
  return { lines, totalHt, totalVat: r2(totalTtc - totalHt), totalTtc, refundAmount: r2(refund.amount), method: paymentMethodFor(refund.gateways[0]) };
}

// ---------------------------------------------------------------- Client

/** Nom et coordonnées du client pour une fiche créée depuis le site (jamais de fusion, D3). */
export function customerFromOrder(o: ShopOrder) {
  const b = o.billing ?? o.shipping;
  const email = (o.email ?? o.customer?.email ?? '').trim().toLowerCase() || null;
  return {
    email,
    firstName: o.customer?.firstName ?? b?.firstName ?? null,
    lastName: o.customer?.lastName ?? b?.lastName ?? null,
    companyName: b?.company ?? null,
    phone: o.customer?.phone ?? o.phone ?? b?.phone ?? null,
    address: [b?.address1, b?.address2].filter(Boolean).join(', ') || null,
    zip: b?.zip ?? null,
    city: b?.city ?? null,
    country: b?.countryCode ?? null,
    shopifyCustomerId: o.customer?.id ?? null,
  };
}
