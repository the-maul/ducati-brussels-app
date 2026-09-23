/**
 * Catalogues ACCESSOIRES et VÊTEMENTS Ducati (mission 06, carte 7 ; décision M-25 « un seul catalogue »).
 * Règles pures du chargeur : fichier d'extraction → format de ducati_catalog_ingest_products.
 *
 * Format réel (catalogue-ducati-accessoires.json, 21/09 : 1 937 entrées) : une liste de
 *   { list:   { id, code, partRef, name, price « 65,16 € » (HT), priceWithVAT « 78,84 € » (TTC), priceNum,
 *               discountCode, lastChance, imageUrl },
 *     detail: { description, imageAttributes[].accImage{…}, accessoryVariants[] } }
 * accessoryVariants[] : { sku, descr, price (HT), partDetails.vatPrice (TTC), isKit, isArchived, isActive,
 *   replaced, accessoryAttributes[] (taille / couleur des vêtements), applicabilities[].hierarchyPath }.
 * Le fichier « …-arbre.json » des ACCESSOIRES ({ paths: [{ path, label « FAMILLE / CYLINDRÉE / MODÈLE / ANNÉE » }] })
 * traduit les hierarchyPath en modèle et millésime (motos compatibles).
 *
 * Format des VÊTEMENTS (catalogue-ducati-vetements.json, 23/09 : 2 563 produits, 13 726 variantes) :
 *   { list: { code, name, price (HT), priceWithVAT (TTC), imageUrl, … },
 *     detail: { …, variants: [{ sku, price, partDetails.vatPrice / partStatus, isArchived,
 *                               attributes[] : APP_TAGLIA (ou APP_TAGLIA_CASCHI), APP_COLOR, APP_VERSIONE,
 *                               APP_CODICE_MADRE, APP_COLLECTIONYEAR, APP_SAP_CODE }] } }
 * Son arbre ({ cats, genders, families, appl: [[code, { categoryPath, gender, applicabilityPath, discontinued }]] })
 * donne la catégorie (« PERFORMANCE WEAR / Cuir »), le genre (Homme, Femme…) et les familles de motos.
 * Tolérant : une liste à la racine ou sous items / products / list ; accessoire sans variante = partRef vendable.
 * Testé par tests/accessories-loader.test.ts.
 */

const txt = (v) => (v == null ? null : String(v).trim() || null);

/** Montant « 474,59 € », « 1.234,50 », 12.5 → nombre ; null si illisible. */
export function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^0-9,.-]/g, '');
  if (!s || s === '-') return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Même clé que la base (ducati_catalog_norm_ref) : majuscules, uniquement A-Z0-9. */
export const normRef = (r) => String(r ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Entrées du fichier, quelle que soit l'enveloppe. */
export function entries(json) {
  if (Array.isArray(json)) return json;
  for (const k of ['items', 'products', 'list', 'data']) if (Array.isArray(json?.[k])) return json[k];
  return [];
}

const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/** Prix : l'e-catalog donne le HT (price / priceNum) et le TTC (priceWithVAT / vatPrice) ; TTC à 21 % s'il manque. */
export function prices(o) {
  const ht = num(o?.price) ?? (num(o?.priceNum) || null) ?? num(o?.priceHt);
  const ttc = num(o?.priceWithVAT) ?? num(o?.partDetails?.vatPrice) ?? num(o?.vatPrice) ?? num(o?.priceTtc);
  const h = ht && ht > 0 ? ht : ttc && ttc > 0 ? r2(ttc / 1.21) : null;
  const t = ttc && ttc > 0 ? ttc : h ? r2(h * 1.21) : null;
  return { priceHt: h, priceTtc: t };
}

/** Valeur d'un attribut e-catalog (accessoryAttributes[] : attributeCode + attributeValueList[].attributeValueDesc). */
export function attrValue(attrs, codes) {
  for (const a of Array.isArray(attrs) ? attrs : []) {
    if (!codes.includes(a?.attributeCode)) continue;
    const vals = (a.attributeValueList ?? []).map((x) => txt(x.attributeValueDesc ?? x.attributeValue)).filter(Boolean);
    if (vals.length) return vals.join(', ');
    const v = txt(a.attributeValueDesc ?? a.attributeValue);
    if (v) return v;
  }
  return null;
}

/** Arbre des accessoires → { hierarchyPath: { family, superModel, model, modelYear } }. */
export function treeIndex(tree) {
  const idx = new Map();
  for (const p of tree?.paths ?? []) {
    const parts = String(p.label ?? '').split(' / ').map((s) => s.trim());
    if (parts.length < 4) continue;
    const year = Number(parts[3]);
    idx.set(String(p.path), { family: parts[0], superModel: parts[1], model: parts[2], modelYear: Number.isFinite(year) ? year : null });
  }
  return idx;
}

/** Genre Ducati (italien) → français, pour la fiche article. */
const GENDERS = { uomo: 'Homme', donna: 'Femme', bambino: 'Enfant', unisex: 'Unisexe' };
export const gender = (v) => (v == null ? null : GENDERS[String(v).trim().toLowerCase()] ?? txt(v));

/**
 * Arbre des vêtements → { code produit : { categoryPath, categoryLabel, gender, familyCodes, discontinued } }.
 * cats = arborescence des catégories (path → description), appl = une ligne par info du produit.
 */
export function apparelIndex(tree) {
  const labels = new Map();
  (function walk(list, prefix) {
    for (const c of list ?? []) {
      const label = prefix ? prefix + ' / ' + c.description : String(c.description ?? '');
      labels.set(String(c.path), label);
      walk(c.categories, label);
    }
  })(tree?.cats, '');
  const families = new Map((tree?.families ?? []).map((f) => [String(f.code), txt(f.description) ?? String(f.code)]));
  const idx = new Map();
  for (const [code, info] of tree?.appl ?? []) {
    const cur = idx.get(String(code)) ?? { categoryPath: null, categoryLabel: null, gender: null, familyCodes: [], discontinued: false };
    const path = txt(info?.categoryPath);
    // on garde la catégorie la plus précise (chemin le plus long)
    if (path && path !== '0' && (!cur.categoryPath || path.length > cur.categoryPath.length)) {
      cur.categoryPath = path;
      cur.categoryLabel = labels.get(path) ?? null;
    }
    if (!cur.gender && txt(info?.gender)) cur.gender = gender(info.gender);
    const fam = txt(info?.applicabilityPath);
    if (fam) {
      const label = families.get(fam) ?? fam;
      if (!cur.familyCodes.includes(label)) cur.familyCodes.push(label);
    }
    if (info?.discontinued) cur.discontinued = true;
    idx.set(String(code), cur);
  }
  return idx;
}

function images(detail, list) {
  const out = [];
  for (const a of detail?.imageAttributes ?? []) {
    const i = a?.accImage;
    if (i?.zoomImagePath) out.push({ url: i.image448Path ?? i.imagePath, zoom: i.zoomImagePath, thumb: i.thumbPath });
  }
  const main = txt(list?.imageUrl);
  if (!out.length && main && !/null/.test(main)) out.push({ url: main });
  return out;
}

/**
 * Une entrée du fichier → un produit au format ducati_catalog_ingest_products (null si inutilisable).
 * opts.tree : index de treeIndex() ; opts.isEurope(modèle) : règle Europe (catalog-core).
 */
export function toProduct(entry, kind, opts = {}) {
  const list = entry?.list ?? entry ?? {};
  const detail = entry?.detail ?? {};
  const code = txt(list.code ?? detail.code);
  const ref = txt(list.partRef ?? detail.partRef ?? list.reference);
  if (!code && !ref) return null;
  const p = prices(list);
  const isEurope = opts.isEurope ?? (() => true);
  const raw = detail.accessoryVariants ?? detail.variants ?? list.accessoryVariants ?? list.variants ?? [];
  // Vêtements : catégorie, genre et familles de motos viennent de l'arbre (opts.info), pas de la fiche.
  const info = opts.info?.get(code ?? '') ?? null;
  const seen = new Set();
  const variants = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const sku = txt(v.sku ?? v.partRef ?? v.reference);
    const k = normRef(sku);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const vp = prices(v);
    const attrs = v.accessoryAttributes ?? v.attributes;
    const texts = Array.isArray(v.applicabilitiesText) ? v.applicabilitiesText : [];
    const applicabilities = (v.applicabilities ?? []).map((a, i) => {
      const path = txt(a.hierarchyPath);
      const fromTree = path ? opts.tree?.get(path) : null;
      const t = fromTree ?? texts[i] ?? {};
      const model = txt(t.model);
      return path ? { path, family: txt(t.family), superModel: txt(t.superModel), model,
        modelYear: num(t.modelYear), isEurope: model ? isEurope(model) : true } : null;
    }).filter(Boolean);
    variants.push({
      sku,
      code: txt(v.code),
      name: txt(v.name) ?? txt(list.name ?? detail.name),
      description: txt(v.descr ?? v.description),
      size: txt(v.size) ?? attrValue(attrs, ['APP_TAGLIA', 'APP_TAGLIA_CASCHI', 'SIZE']),
      color: txt(v.color) ?? attrValue(attrs, ['APP_COLOR', 'COLOR']),
      motherCode: attrValue(attrs, ['APP_CODICE_MADRE']),
      collectionYear: num(attrValue(attrs, ['APP_COLLECTIONYEAR'])),
      attributes: {
        ...(attrValue(attrs, ['APP_VERSIONE']) ? { version: attrValue(attrs, ['APP_VERSIONE']) } : {}),
        ...(txt(v.partDetails?.partStatus) ? { partStatus: txt(v.partDetails.partStatus) } : {}),
        ...(v.disabled === true ? { disabled: true } : {}),
      },
      priceHt: vp.priceHt ?? p.priceHt,
      priceTtc: vp.priceTtc ?? p.priceTtc,
      isKit: v.isKit === 1 || v.isKit === true,
      replaced: v.replaced === true || v.replaced === 1,
      archived: v.isArchived === 1 || v.isArchived === true || v.isActive === 0,
      applicabilities,
    });
  }
  // Accessoire sans variante : la référence du produit est la référence vendable.
  if (!variants.length && normRef(ref)) {
    variants.push({ sku: ref, code: null, name: txt(list.name ?? detail.name), description: null, size: null, color: null,
      motherCode: null, collectionYear: null, priceHt: p.priceHt, priceTtc: p.priceTtc, isKit: false, replaced: false,
      archived: false, applicabilities: [] });
  }
  if (!variants.length) return null;
  const imgs = images(detail, list);
  return {
    code: code ?? ref,
    kind,
    ducatiId: txt(list.id ?? detail.id),
    name: txt(list.name ?? detail.name),
    description: txt(detail.description ?? list.description),
    categoryPath: info?.categoryPath ?? txt(list.categoryPath),
    categoryLabel: info?.categoryLabel ?? txt(list.categoryLabel),
    familyCodes: info?.familyCodes ?? [],
    gender: info?.gender ?? gender(attrValue(detail.accessoryAttributes ?? detail.attributes, ['APP_GENDER', 'APP_GENDER_APPLICABILITY', 'APP_SESSO'])),
    imageUrl: imgs[0]?.thumb ?? imgs[0]?.url ?? null,
    images: imgs,
    priceHt: p.priceHt,
    priceTtc: p.priceTtc,
    discountGroup: txt(list.discountCode),
    lastChance: list.lastChance === '1' || list.lastChance === true,
    archived: info?.discontinued === true,
    variants,
  };
}

/** Fichier complet → produits (dédoublonnés par code) + compteurs pour le compte rendu. */
export function toProducts(json, kind, opts = {}) {
  const byCode = new Map();
  let skipped = 0;
  for (const e of entries(json)) {
    const p = toProduct(e, kind, opts);
    if (!p) { skipped++; continue; }
    const prev = byCode.get(p.code);
    if (prev) {
      const seen = new Set(prev.variants.map((v) => normRef(v.sku)));
      for (const v of p.variants) if (!seen.has(normRef(v.sku))) prev.variants.push(v);
    } else byCode.set(p.code, p);
  }
  const products = [...byCode.values()];
  const skus = new Set(products.flatMap((p) => p.variants.map((v) => normRef(v.sku))));
  // Un article n'est créé que pour une référence encore au catalogue (les archivées restent consultables).
  const live = new Set(products.flatMap((p) => p.variants.filter((v) => !v.archived).map((v) => normRef(v.sku))));
  return { products, skipped, variants: products.reduce((n, p) => n + p.variants.length, 0), skus, live };
}
