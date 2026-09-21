// Mission 03 — Le DMS écrit sur Shopify (décisions W-4, W-7, W-8) : règles pures, sans réseau.
//
// Utilisé par les fonctions serveur shopify-push (stock + prix des articles reliés) et shopify-publish
// (publier / retirer / mettre à jour un article), et par les tests (`bun test`).
//
// Tout ce qui décide QUOI écrire est ici : prix TTC (arrondi société), stock disponible (réel − réservé),
// mode Arrêtée / Essai / Tous, plan des écritures (rien si Shopify est déjà à jour), et texte exact des
// mutations Admin GraphQL 2026-07.

export const SHOPIFY_API_VERSION = '2026-07';
/** Emplacement de stock Shopify unique (vérifié le 19/09). */
export const SHOPIFY_LOCATION_NAME = 'Chaussée de Bruxelles 688';

export type SyncMode = 'arrete' | 'essai' | 'tous';

// ─── Mode essai ────────────────────────────────────────────────────────────────────────

export function normalizeMode(m: unknown): SyncMode {
  return m === 'essai' || m === 'tous' ? m : 'arrete';
}

/** Un article peut-il être écrit sur Shopify dans ce mode ? (règle redite en SQL dans _shopify_push_claim) */
export function writeAllowed(mode: SyncMode, inTrial: boolean): boolean {
  if (mode === 'tous') return true;
  if (mode === 'essai') return inTrial;
  return false;
}

/** Filtre une liste d'articles selon le mode et la liste d'essai. */
export function filterByMode<T extends { article_id: string }>(items: T[], mode: SyncMode, trial: Iterable<string>): T[] {
  const set = new Set(trial);
  return items.filter((x) => writeAllowed(mode, set.has(x.article_id)));
}

// ─── Prix TTC (W-7) ────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Arrondi à l'euro supérieur, plancher 2 € — identique à src/lib/pricing.ts et SQL round_up_euro. */
export const roundUpEuro = (p: number): number => (p > 0 ? Math.max(2, Math.ceil(p - 1e-9)) : p);

export type PriceSource = {
  sale_price_ttc: number | string | null;
  sale_price_ht: number | string | null;
  vat_rate: number | string | null;
  round_up: boolean;
};

/**
 * Prix de vente TTC envoyé à Shopify : le prix de vente TTC du DMS ; à défaut, le prix HT × (1 + taux de
 * TVA de l'article). Décision de Simon (21/09, W-11) : on garde les prix du site — AUCUN arrondi n'est
 * appliqué au prix envoyé à Shopify (le champ round_up est ignoré ici ; l'arrondi de la société reste
 * valable pour la caisse et les étiquettes).
 * null = pas de prix de vente dans le DMS → on n'envoie aucun prix (jamais 0 € sur le site).
 */
export function shopifyTtc(a: PriceSource): number | null {
  const ttc = Number(a.sale_price_ttc ?? 0);
  const ht = Number(a.sale_price_ht ?? 0);
  const rate = a.vat_rate == null || a.vat_rate === '' ? 21 : Number(a.vat_rate);
  let base: number | null = null;
  if (Number.isFinite(ttc) && ttc > 0) base = round2(ttc);
  else if (Number.isFinite(ht) && ht > 0 && Number.isFinite(rate)) base = round2(ht * (1 + rate / 100));
  if (base == null) return null;
  return base;
}

/** Montant au format Money de Shopify (« 12.50 »). */
export const money = (n: number): string => round2(n).toFixed(2);

// ─── Stock disponible (B4) ─────────────────────────────────────────────────────────────

/** Types de gestion dont le stock est suivi (A pièce stockée, V/O/P/D véhicules). */
export function isStockManaged(mgmtType: string | null | undefined): boolean {
  return ['A', 'V', 'O', 'P', 'D'].includes(String(mgmtType ?? ''));
}

/** Disponible = réel − réservé, entier, jamais négatif sur le site. */
export function availableQty(real: number | string | null, reserved: number | string | null): number {
  const v = Number(real ?? 0) - Number(reserved ?? 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v + 1e-9);
}

// ─── File d'attente (miroir TS de _shopify_enqueue) ───────────────────────────────────

export type QueueItem = { company_id: string; article_id: string; reasons: string[]; requested_at: string };

/** Une seule ligne par article et par société ; les motifs s'additionnent ; la demande la plus récente gagne. */
export function enqueue(queue: QueueItem[], company: string, article: string, reason: string, at: string): QueueItem[] {
  const i = queue.findIndex((q) => q.company_id === company && q.article_id === article);
  if (i < 0) return [...queue, { company_id: company, article_id: article, reasons: [reason], requested_at: at }];
  const cur = queue[i];
  const reasons = [...new Set([...cur.reasons, reason])].sort();
  const next = { ...cur, reasons, requested_at: at > cur.requested_at ? at : cur.requested_at };
  return queue.map((q, k) => (k === i ? next : q));
}

// ─── Plan des écritures stock + prix ───────────────────────────────────────────────────

export type PushTarget = PriceSource & {
  queue_id: number | null;
  article_id: string;
  reference: string;
  mgmt_type: string | null;
  shopify_product_id: string;
  shopify_variant_id: string;
  real_qty: number | string | null;
  reserved_qty: number | string | null;
  requested_at: string | null;
};

/** État actuel de la variante lu sur Shopify. */
export type VariantState = {
  variant_id: string;
  product_id: string;
  price: string | null;
  inventory_item_id: string | null;
  tracked: boolean;
  /** Quantité « available » à l'emplacement ; null = article pas stocké à cet emplacement. */
  available: number | null;
};

export type PlannedResult = {
  queue_id: number | null;
  article_id: string;
  reference: string;
  product_id: string;
  variant_id: string;
  status: 'a_envoyer' | 'ok' | 'deja_a_jour' | 'erreur';
  price_before: number | null;
  price_sent: number | null;
  qty_before: number | null;
  qty_sent: number | null;
  detail: string | null;
  requested_at: string | null;
  write_price: boolean;
  write_qty: boolean;
  inventory_item_id: string | null;
};

export type VariantPriceUpdate = { id: string; price?: string; inventoryItem?: { tracked: boolean } };

export type PushPlan = {
  results: PlannedResult[];
  /** Mises à jour de variantes regroupées par produit (productVariantsBulkUpdate). */
  priceUpdates: { productId: string; variants: VariantPriceUpdate[] }[];
  /** Quantités absolues à poser (inventorySetQuantities, name « available »). */
  quantities: { inventoryItemId: string; locationId: string; quantity: number; changeFromQuantity: null }[];
  /** Articles pas encore stockés à l'emplacement : inventoryActivate avant de poser la quantité. */
  activations: { inventoryItemId: string; locationId: string; available: number }[];
};

/**
 * Décide, article par article, ce qu'il faut écrire. Rien n'est écrit si Shopify porte déjà
 * le bon prix et la bonne quantité (« déjà à jour »).
 */
export function planPush(targets: PushTarget[], states: Map<string, VariantState>, locationId: string): PushPlan {
  const results: PlannedResult[] = [];
  const byProduct = new Map<string, VariantPriceUpdate[]>();
  const quantities: PushPlan['quantities'] = [];
  const activations: PushPlan['activations'] = [];
  const seenVariant = new Set<string>();

  for (const t of targets) {
    const base = {
      queue_id: t.queue_id, article_id: t.article_id, reference: t.reference,
      product_id: t.shopify_product_id, variant_id: t.shopify_variant_id, requested_at: t.requested_at,
    };
    const st = states.get(t.shopify_variant_id);
    if (!st) {
      results.push({ ...base, status: 'erreur', price_before: null, price_sent: null, qty_before: null, qty_sent: null,
        detail: 'variante introuvable sur Shopify (relire Shopify)', write_price: false, write_qty: false, inventory_item_id: null });
      continue;
    }
    if (seenVariant.has(st.variant_id)) {
      results.push({ ...base, status: 'erreur', price_before: null, price_sent: null, qty_before: null, qty_sent: null,
        detail: 'variante reliée à deux articles', write_price: false, write_qty: false, inventory_item_id: null });
      continue;
    }
    seenVariant.add(st.variant_id);

    const ttc = shopifyTtc(t);
    const priceBefore = st.price == null ? null : Number(st.price);
    const writePrice = ttc != null && (priceBefore == null || Math.abs(priceBefore - ttc) >= 0.005);

    const managed = isStockManaged(t.mgmt_type);
    const qty = managed ? availableQty(t.real_qty, t.reserved_qty) : null;
    let writeQty = false;
    const detail: string[] = [];
    if (managed && qty != null) {
      if (!st.inventory_item_id) {
        detail.push('pas d’article de stock Shopify');
      } else if (st.available == null) {
        activations.push({ inventoryItemId: st.inventory_item_id, locationId, available: qty });
        writeQty = true;
      } else if (st.available !== qty || !st.tracked) {
        quantities.push({ inventoryItemId: st.inventory_item_id, locationId, quantity: qty, changeFromQuantity: null });
        writeQty = true;
      }
    }
    if (ttc == null) detail.push('pas de prix de vente dans le DMS : prix du site inchangé');
    else if (writePrice && t.round_up && priceBefore != null) {
      // Le prix exact du DMS est déjà celui du site : seul l'arrondi société (euro supérieur) le change.
      const exact = shopifyTtc({ ...t, round_up: false });
      if (exact != null && Math.abs(priceBefore - exact) < 0.005) detail.push('écart dû seulement à l’arrondi à l’euro supérieur de la société');
    }

    const upd: VariantPriceUpdate = { id: st.variant_id };
    if (writePrice) upd.price = money(ttc!);
    if (managed && writeQty && !st.tracked) upd.inventoryItem = { tracked: true };
    if (upd.price || upd.inventoryItem) {
      const list = byProduct.get(st.product_id) ?? [];
      list.push(upd);
      byProduct.set(st.product_id, list);
    }

    // Rien à écrire : « déjà à jour », sauf si le stock ne peut pas être posé (pas d'article de stock Shopify).
    const status = writePrice || writeQty ? 'a_envoyer' : managed && !st.inventory_item_id ? 'erreur' : 'deja_a_jour';
    results.push({
      ...base, status,
      price_before: priceBefore, price_sent: ttc,
      qty_before: st.available, qty_sent: qty,
      detail: detail.length ? detail.join(' ; ') : null,
      write_price: writePrice, write_qty: writeQty, inventory_item_id: st.inventory_item_id,
    });
  }

  return {
    results,
    priceUpdates: [...byProduct.entries()].map(([productId, variants]) => ({ productId, variants })),
    quantities,
    activations,
  };
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ─── Requêtes et mutations Admin GraphQL 2026-07 ───────────────────────────────────────

export const LOCATIONS_QUERY = `query Locations { locations(first: 20) { nodes { id name isActive } } }`;

/** Emplacement « Chaussée de Bruxelles 688 » (nom comparé sans casse ni espaces superflus). */
export function pickLocation(nodes: { id: string; name: string; isActive?: boolean }[]): string | null {
  const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const want = norm(SHOPIFY_LOCATION_NAME);
  const hit = nodes.find((n) => norm(n.name) === want) ?? (nodes.filter((n) => n.isActive !== false).length === 1
    ? nodes.find((n) => n.isActive !== false) : undefined);
  return hit?.id ?? null;
}

export const VARIANT_STATE_QUERY = `query VariantState($ids: [ID!]!, $location: ID!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id price
      product { id status }
      inventoryItem {
        id tracked
        inventoryLevel(locationId: $location) { quantities(names: ["available"]) { name quantity } }
      }
    }
  }
}`;

/** Lecture de la réponse VARIANT_STATE_QUERY. */
export function parseVariantStates(nodes: any[]): Map<string, VariantState> {
  const out = new Map<string, VariantState>();
  for (const n of nodes ?? []) {
    if (!n?.id || !n?.product?.id) continue;
    const lvl = n.inventoryItem?.inventoryLevel;
    const q = lvl?.quantities?.find((x: any) => x?.name === 'available');
    out.set(String(n.id), {
      variant_id: String(n.id),
      product_id: String(n.product.id),
      price: n.price == null ? null : String(n.price),
      inventory_item_id: n.inventoryItem?.id ? String(n.inventoryItem.id) : null,
      tracked: n.inventoryItem?.tracked === true,
      available: lvl ? Number(q?.quantity ?? 0) : null,
    });
  }
  return out;
}

/** Plusieurs productVariantsBulkUpdate dans UNE requête (un alias par produit). */
export function buildPriceMutation(groups: { productId: string; variants: VariantPriceUpdate[] }[]) {
  const decl = groups.map((_, i) => `$p${i}: ID!, $v${i}: [ProductVariantsBulkInput!]!`).join(', ');
  const body = groups.map((_, i) =>
    `  u${i}: productVariantsBulkUpdate(productId: $p${i}, variants: $v${i}, allowPartialUpdates: true) {\n` +
    `    productVariants { id price }\n    userErrors { field message }\n  }`).join('\n');
  const variables: Record<string, unknown> = {};
  groups.forEach((g, i) => { variables[`p${i}`] = g.productId; variables[`v${i}`] = g.variants; });
  return { query: `mutation PushPrices(${decl}) {\n${body}\n}`, variables };
}

/**
 * Pose des quantités absolues « available ». changeFromQuantity: null = pas de contrôle de la quantité
 * précédente (le DMS fait foi, W-4) ; le champ est obligatoire en 2026-07. @idempotent obligatoire depuis 2026-04.
 */
export function buildInventoryMutation(
  quantities: PushPlan['quantities'], idempotencyKey: string, referenceDocumentUri = 'gid://dms-ducati-bruxelles/StockSync/1',
) {
  return {
    query: `mutation PushStock($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { reason changes { name delta quantityAfterChange item { id } } }
    userErrors { code field message }
  }
}`,
    variables: {
      key: idempotencyKey,
      input: { name: 'available', reason: 'correction', referenceDocumentUri, quantities },
    },
  };
}

/** Rend l'article stocké à l'emplacement avec sa quantité de départ. */
export function buildActivateMutation(a: PushPlan['activations'][number], idempotencyKey: string) {
  return {
    query: `mutation Activate($item: ID!, $location: ID!, $available: Int, $key: String!) {
  inventoryActivate(inventoryItemId: $item, locationId: $location, available: $available) @idempotent(key: $key) {
    inventoryLevel { id }
    userErrors { field message }
  }
}`,
    variables: { item: a.inventoryItemId, location: a.locationId, available: a.available, key: idempotencyKey },
  };
}

/** Coût GraphQL : temps d'attente (ms) pour que le seau se remplisse avant la prochaine requête. */
export function throttleWaitMs(cost: any, nextCost: number): number {
  const st = cost?.throttleStatus;
  if (!st || typeof st.currentlyAvailable !== 'number') return 0;
  const want = nextCost * 1.2;
  if (st.currentlyAvailable >= want) return 0;
  return Math.ceil(((want - st.currentlyAvailable) / Math.max(Number(st.restoreRate) || 50, 1)) * 1000);
}

// ─── Publication d'un article (carte « Publier ou retirer ») ──────────────────────────

export type PublishArticle = PriceSource & {
  reference: string;
  designation: string | null;
  web_title: string | null;
  web_description: string | null;
  mgmt_type: string | null;
  real_qty: number | string | null;
  reserved_qty: number | string | null;
};

export type PublishPhoto = { attachment_id: string; url: string; alt: string | null };

/** Titre sur le site : titre web, sinon désignation, sinon référence. */
export function publishTitle(a: Pick<PublishArticle, 'web_title' | 'designation' | 'reference'>): string {
  return (a.web_title ?? '').trim() || (a.designation ?? '').trim() || a.reference.trim();
}

export type PublishCheck = { ok: true } | { ok: false; reason: string };

/** Conditions pour publier : mode, case « Publiable », prix, pas déjà relié. */
export function canPublish(p: {
  mode: SyncMode; in_trial: boolean; publishable: boolean; is_active: boolean; has_link: boolean; ttc: number | null;
}): PublishCheck {
  if (!writeAllowed(p.mode, p.in_trial)) {
    return { ok: false, reason: p.mode === 'arrete' ? 'sync_stopped' : 'not_in_trial' };
  }
  if (!p.is_active) return { ok: false, reason: 'inactive' };
  if (!p.publishable) return { ok: false, reason: 'not_publishable' };
  if (p.has_link) return { ok: false, reason: 'already_linked' };
  if (p.ttc == null) return { ok: false, reason: 'no_price' };
  return { ok: true };
}

/** Entrée productSet : un produit à une variante, SKU = référence, prix TTC, stock à l'emplacement, photos du DMS. */
export function buildProductSetInput(a: PublishArticle, photos: PublishPhoto[], locationId: string | null) {
  const ttc = shopifyTtc(a);
  const managed = isStockManaged(a.mgmt_type);
  const variant: Record<string, unknown> = {
    optionValues: [{ optionName: 'Title', name: 'Default Title' }],
    sku: a.reference.trim(),
    inventoryItem: { tracked: managed },
    inventoryPolicy: 'DENY',
  };
  if (ttc != null) variant.price = money(ttc);
  if (managed && locationId) {
    variant.inventoryQuantities = [{ locationId, name: 'available', quantity: availableQty(a.real_qty, a.reserved_qty) }];
  }
  const input: Record<string, unknown> = {
    title: publishTitle(a),
    descriptionHtml: a.web_description ?? '',
    status: 'ACTIVE',
    vendor: 'Ducati',
    productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants: [variant],
  };
  if (photos.length) {
    input.files = photos.map((p) => ({ originalSource: p.url, alt: p.alt ?? publishTitle(a), contentType: 'IMAGE' }));
  }
  return input;
}

export const PRODUCT_SET_MUTATION = `mutation Publish($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id handle status title variants(first: 1) { nodes { id sku price inventoryQuantity } } }
    userErrors { code field message }
  }
}`;

/** Retrait (brouillon) ou remise en ligne — jamais de suppression. */
export function buildStatusMutation(productId: string, status: 'DRAFT' | 'ACTIVE') {
  return {
    query: `mutation SetStatus($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id status handle } userErrors { field message } }
}`,
    variables: { product: { id: productId, status } },
  };
}

/** Mise à jour : titre, description et photos pas encore envoyées. */
export function buildContentUpdateMutation(productId: string, title: string, descriptionHtml: string, photos: PublishPhoto[]) {
  return {
    query: `mutation UpdateContent($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
  productUpdate(product: $product, media: $media) { product { id status handle title } userErrors { field message } }
}`,
    variables: {
      product: { id: productId, title, descriptionHtml },
      media: photos.map((p) => ({ originalSource: p.url, alt: p.alt ?? title, mediaContentType: 'IMAGE' })),
    },
  };
}

/** Photos à envoyer : celles du DMS, sauf celles reprises de CE produit Shopify ou déjà envoyées dessus. */
export function photosToPush<T extends { attachment_id: string; external_id: string | null; pushed_to: string[] }>(
  photos: T[], productId: string | null,
): T[] {
  return photos.filter((p) => {
    if (productId && p.pushed_to.includes(productId)) return false;
    if (productId && p.external_id) return false;      // photo reprise de Shopify : déjà sur le produit relié
    return true;
  });
}

/** Recherche d'un produit portant déjà cette référence (pour ne jamais créer de doublon). */
export const SKU_LOOKUP_QUERY = `query BySku($q: String!) {
  productVariants(first: 5, query: $q) { nodes { id sku product { id title status } } }
}`;
export const skuSearch = (reference: string) => `sku:"${reference.trim().replace(/["\\]/g, '')}"`;
