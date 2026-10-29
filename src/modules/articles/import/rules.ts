/**
 * M2 — Moteur d'import des tarifs (INV013 + ACH003).
 * Applique les règles d'intégration PARAMÉTRABLES (écran import, table
 * article_import_settings — équivalent des cases à cocher G8) au croisement
 * d'une ligne de tarif importée avec le référentiel existant. Fonctions PURES
 * (testées dans tests/import-rules.test.ts — CLAUDE.md règle 7).
 *
 * Réglages (défauts = comportement historique du cahier des charges) :
 *  - accepter désignation / PA / réf. fournisseur / rayon / marque
 *  - PV : à la hausse uniquement / toujours / jamais
 *  - conserver ou non le coefficient existant
 *  - ne pas recréer les références remplacées (→ proposées en équivalence)
 *  - créer les nouvelles références en librairie
 *  - intégrer les codes-barres fournisseurs
 *  - PA arrondi à 3 décimales
 *  - plancher de prix : PV TTC sous le seuil → remonté au minimum (réglage société)
 *  - prix d'achat deduit de la classe de remise du tarif (grille
 *    supplier_discount_classes, decision client du 29/10/2026) ; verrou G8 respecte
 */

export type ImportRow = {
  reference: string;
  designation?: string | null;
  brand?: string | null;
  category_path?: string | null;
  supplier_ref?: string | null;
  supplier_name?: string | null; // nom du fournisseur (matching règles PPC — non persisté)
  barcode?: string | null;
  purchase_price?: number | null; // PA HT
  sale_price_ttc?: number | null; // PV TTC proposé
  ppc_ht?: number | null;         // Prix Public Conseillé HT
  ppc_ttc?: number | null;        // Prix Public Conseillé TTC
  coefficient?: number | null;
  vat_rate?: number | null;
  bin_location?: string | null;
  pack_qty?: number | null;
  color?: string | null;
  size?: string | null;
  /** Année modèle « Du … Au … » (colonne Année/Millésime du fichier). */
  year_from?: number | null;
  year_to?: number | null;
  /** Réf. de REMPLACEMENT (colonne « Remplacement » Ducati/G8) : la nouvelle réf qui remplace celle-ci. */
  replacement_ref?: string | null;
  /** Classe de remise constructeur (A…E, P, R, S) : base du prix d'achat. */
  discount_group?: string | null;
  /** État du matériel au tarif : E = courant, F = fin de série. */
  supply_status?: string | null;
  rowIndex: number; // ligne source (pour le rapport)
};

/** Sous-ensemble de l'article existant nécessaire au diff. */
export type ExistingArticle = {
  id: string;
  reference: string;
  designation: string | null;
  brand: string | null;
  category_path: string | null;
  supplier_ref: string | null;
  purchase_price: number;
  sale_price_ttc: number;
  coefficient: number | null;
  superseded_by_id: string | null;
  is_library: boolean;
  ppc_ht?: number | null;
  ppc_ttc?: number | null;
  year_from?: number | null;
  year_to?: number | null;
  supplier_availability?: string | null;
  /** Classe de remise deja connue (colonne articles.discount_group ; undefined = colonne absente). */
  discount_group?: string | null;
  /** Verrou G8 sur le prix d'achat : un PA verrouille n'est jamais ecrase par un import. */
  price_purchase_locked?: boolean | null;
  /**
   * Libelle d'origine fournisseur (I18N002) : `designation` etant la version FR,
   * c'est a l'original que le tarif se compare pour savoir si le libelle a change.
   */
  designation_source?: string | null;
};

/** Réglages d'intégration (mêmes clés que la table article_import_settings). */
export type ImportSettings = {
  accept_designation: boolean;
  accept_purchase_price: boolean;
  purchase_price_3dec: boolean;
  sale_price_mode: 'always' | 'increase_only' | 'never';
  keep_coefficient: boolean;
  accept_supplier_ref: boolean;
  accept_category: boolean;
  accept_brand: boolean;
  no_recreate_replaced: boolean;
  replaced_to_equivalences: boolean;
  new_refs_in_library: boolean;
  integrate_supplier_barcodes: boolean;
  translate_designations: boolean;
};

/** Défauts = règles historiques du cahier des charges (comportement inchangé). */
export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  accept_designation: true,
  accept_purchase_price: true,
  purchase_price_3dec: true,
  sale_price_mode: 'increase_only',
  keep_coefficient: true,
  accept_supplier_ref: true,
  accept_category: true,
  accept_brand: true,
  no_recreate_replaced: true,
  replaced_to_equivalences: true,
  new_refs_in_library: true,
  integrate_supplier_barcodes: true,
  translate_designations: false,
};

/** Options de calcul (plancher de prix société — 0 = désactivé). */
export type ImportOptions = {
  settings?: ImportSettings;
  /** PV TTC strictement sous ce seuil → traité selon floorMode (ex. 2 €). */
  floorThreshold?: number;
  /** 'min' : remonté au minimum · 'cents' : on garde les centimes (choix du client). */
  floorMode?: FloorMode;
  /** Prix minimum appliqué sous le seuil (ex. 2 €). */
  floorMin?: number;
  /**
   * Grille des classes de remise (table supplier_discount_classes), chargee une
   * fois par analyse. Absente ou vide : aucun prix d'achat n'est deduit du tarif.
   */
  discountClasses?: DiscountClass[];
};

// ─── Classes de remise → prix d'achat (decision client du 29/10/2026) ────────

/** Une ligne de la grille (table supplier_discount_classes). */
export type DiscountClass = {
  id?: string;
  /** null = vaut pour tous les fournisseurs. */
  supplier_name: string | null;
  /** Classe en majuscules ; '' = ligne du tarif sans classe. */
  code: string;
  /** Remise en % sur le prix catalogue HT (0..100). */
  discount_pct: number;
  is_active?: boolean;
};

/**
 * Grille G8 (celle que le client utilisait) : sert de prechargement en base
 * (migration 20261030120000) et de repli tant que la table n'existe pas.
 * EB / J / O / V / Z : pas de remise dans G8 -> inactives, signalees a l'import.
 */
export const DEFAULT_DISCOUNT_CLASSES: DiscountClass[] = [
  { supplier_name: null, code: 'A', discount_pct: 25 },
  { supplier_name: null, code: 'B', discount_pct: 35 },
  { supplier_name: null, code: 'C', discount_pct: 45 },
  { supplier_name: null, code: 'D', discount_pct: 10 },
  { supplier_name: null, code: 'E', discount_pct: 50 },
  { supplier_name: null, code: 'H', discount_pct: 30 },
  { supplier_name: null, code: 'I', discount_pct: 35 },
  { supplier_name: null, code: 'L', discount_pct: 20 },
  { supplier_name: null, code: 'M', discount_pct: 40 },
  { supplier_name: null, code: 'N', discount_pct: 30 },
  { supplier_name: null, code: 'P', discount_pct: 30 },
  { supplier_name: null, code: 'Q', discount_pct: 30 },
  { supplier_name: null, code: 'R', discount_pct: 45 },
  { supplier_name: null, code: 'S', discount_pct: 60 },
  { supplier_name: null, code: 'T', discount_pct: 30 },
  { supplier_name: null, code: 'W', discount_pct: 5 },
  { supplier_name: null, code: 'X', discount_pct: 30 },
  { supplier_name: null, code: 'Y', discount_pct: 25 },
  { supplier_name: null, code: '', discount_pct: 25 },
  { supplier_name: null, code: 'EB', discount_pct: 0, is_active: false },
  { supplier_name: null, code: 'J', discount_pct: 0, is_active: false },
  { supplier_name: null, code: 'O', discount_pct: 0, is_active: false },
  { supplier_name: null, code: 'V', discount_pct: 0, is_active: false },
  { supplier_name: null, code: 'Z', discount_pct: 0, is_active: false },
];

/** Classe normalisee : majuscules, sans espaces ; vide = « sans classe ». */
export const normalizeDiscountCode = (code: string | null | undefined): string => (code ?? '').trim().toUpperCase();

/**
 * Trouve la ligne de grille d'une classe : la ligne propre au fournisseur de la
 * ligne de tarif gagne sur la ligne « tous fournisseurs ». Retourne la ligne
 * meme inactive (c'est l'appelant qui decide quoi en dire) ; null si la classe
 * n'est pas dans la grille.
 */
export function resolveDiscountClass(
  code: string | null | undefined,
  supplierName: string | null | undefined,
  classes: DiscountClass[],
): DiscountClass | null {
  const c = normalizeDiscountCode(code);
  const sup = supplierName ? supplierName.trim().toLowerCase() : '';
  let generic: DiscountClass | null = null;
  for (const k of classes) {
    if (normalizeDiscountCode(k.code) !== c) continue;
    const ks = k.supplier_name ? k.supplier_name.trim().toLowerCase() : '';
    if (ks && sup && ks === sup) return k;
    if (!ks && !generic) generic = k;
  }
  return generic;
}

export type PurchaseFromClass =
  | { ok: true; price: number; pct: number; code: string }
  | { ok: false; reason: 'no_grid' | 'no_ppc' | 'unknown' | 'inactive'; code: string };

/**
 * Prix d'achat HT deduit du prix catalogue HT et de la classe de remise :
 *   PA = round2(ppc_ht x (1 - remise / 100))
 * Classe absente de la grille ou inactive : pas de prix, raison lisible.
 */
export function purchasePriceFromClass(
  ppcHt: number | null | undefined,
  code: string | null | undefined,
  supplierName: string | null | undefined,
  classes: DiscountClass[] | undefined,
): PurchaseFromClass {
  const c = normalizeDiscountCode(code);
  if (!classes || classes.length === 0) return { ok: false, reason: 'no_grid', code: c };
  if (ppcHt == null || !(ppcHt > 0)) return { ok: false, reason: 'no_ppc', code: c };
  const k = resolveDiscountClass(c, supplierName, classes);
  if (!k) return { ok: false, reason: 'unknown', code: c };
  if (k.is_active === false) return { ok: false, reason: 'inactive', code: c };
  const pct = Number(k.discount_pct) || 0;
  return { ok: true, price: round2(ppcHt * (1 - pct / 100)), pct, code: c };
}

/** Libelle d'anomalie quand la classe ne donne pas de prix d'achat (null = rien a dire). */
export function discountClassAnomaly(r: PurchaseFromClass): string | null {
  if (r.ok) return null;
  const label = r.code === '' ? 'sans classe' : r.code;
  if (r.reason === 'unknown') return `Classe de remise ${label} inconnue : prix d'achat non calculé.`;
  if (r.reason === 'inactive') return `Classe de remise ${label} inactive : prix d'achat non calculé.`;
  return null;
}

export type FieldChange = { field: string; from: unknown; to: unknown };

export type DiffAction = 'create' | 'update' | 'skip';

export type DiffResult = {
  rowIndex: number;
  reference: string;
  /** id de l'article existant (pour les mises à jour) ou null si création */
  existingId: string | null;
  action: DiffAction;
  /** champs qui seront modifiés (pour update) ou posés (pour create) */
  changes: FieldChange[];
  /** valeurs finales à persister (patch) */
  patch: Record<string, unknown>;
  /** anomalies/avertissements à afficher dans le rapport */
  anomalies: string[];
};

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Plancher de prix, deux facons de traiter les petits montants :
 *  - 'min'   : on remonte au minimum        (0,25 EUR avec un plancher de 2 -> 2,00)
 *  - 'cents' : on GARDE LES CENTIMES et on repart du minimum
 *              (0,25 EUR -> 2,25 ; 1,74 EUR -> 2,74)
 * Le client a choisi 'cents' le 28/10/2026 : une piece sous 2 EUR ne peut pas se
 * vendre a ce prix, mais deux petites pieces ne doivent pas finir au meme prix.
 * A ne pas confondre avec « on ajoute 2 EUR », qui donnerait 1,74 -> 3,74.
 */
export type FloorMode = 'min' | 'cents';

export function applyPriceFloor(pv: number, threshold: number, min: number, mode: FloorMode = 'min'): number {
  if (!(pv > 0) || !(threshold > 0) || !(min > 0)) return pv;
  if (pv >= threshold) return pv;
  if (mode !== 'cents') return Math.max(pv, min);
  const centimes = round2(pv - Math.floor(pv));
  return round2(min + centimes);
}

/**
 * Etat au tarif Ducati -> disponibilite fournisseur de l'article.
 * E = courant (vert), F = fin de serie, jusqu'a epuisement (rouge). Autre ou vide : on ne touche a rien.
 */
export function availabilityFromStatus(status: string | null | undefined): 'green' | 'red' | null {
  const v = (status ?? '').trim().toUpperCase();
  if (v === 'E') return 'green';
  if (v === 'F') return 'red';
  return null;
}

/**
 * Calcule l'effet d'UNE ligne importée sur le référentiel.
 * @param row ligne de tarif
 * @param existing article existant de MÊME référence (ou null si nouveau)
 * @param opts réglages d'intégration + plancher (défauts = comportement historique)
 */
export function diffRow(row: ImportRow, existing: ExistingArticle | null, opts: ImportOptions = {}): DiffResult {
  const s = opts.settings ?? DEFAULT_IMPORT_SETTINGS;
  const floorT = opts.floorThreshold ?? 0;
  const floorM = opts.floorMin ?? 0;
  const floorMode = opts.floorMode ?? 'min';
  const anomalies: string[] = [];
  const changes: FieldChange[] = [];
  const patch: Record<string, unknown> = {};

  const ref = row.reference?.trim();
  if (!ref) {
    return {
      rowIndex: row.rowIndex, reference: row.reference ?? '', existingId: null, action: 'skip',
      changes: [], patch: {}, anomalies: ['Référence vide — ligne ignorée.'],
    };
  }

  // PA arrondi (3 décimales par défaut, réglage)
  let pa = row.purchase_price != null
    ? (s.purchase_price_3dec ? round3(row.purchase_price) : round2(row.purchase_price))
    : null;

  // Prix d'achat deduit de la classe de remise (tarif Ducati : pas de colonne
  // PA, mais un prix catalogue HT et une classe). Le PA du fichier, s'il
  // existe, garde la main. Classe inconnue ou inactive : anomalie, pas de PA.
  const cls = normalizeDiscountCode(row.discount_group);
  const hasClassInput = row.discount_group != null || row.ppc_ht != null;
  let paFromClass = false;
  if (pa == null && hasClassInput && opts.discountClasses && opts.discountClasses.length > 0) {
    const r = purchasePriceFromClass(row.ppc_ht, cls, row.supplier_name, opts.discountClasses);
    if (r.ok) { pa = r.price; paFromClass = true; }
    else {
      const msg = discountClassAnomaly(r);
      if (msg) anomalies.push(msg);
    }
  }

  // PV proposé, plancher appliqué (réglage société)
  const proposedPv = row.sale_price_ttc != null
    ? applyPriceFloor(round2(row.sale_price_ttc), floorT, floorM, floorMode)
    : null;

  // ---------- NOUVELLE référence → création ----------
  if (!existing) {
    patch.reference = ref;
    patch.designation = row.designation?.trim() || ref;
    if (row.brand != null) patch.brand = row.brand;
    if (row.category_path != null) patch.category_path = row.category_path;
    // Réf. fournisseur = référence principale par défaut (demande magasin)
    patch.supplier_ref = row.supplier_ref ?? ref;
    if (pa != null) patch.purchase_price = pa;
    if (paFromClass) patch._pa_from_class = true;
    if (cls) patch.discount_group = cls;
    if (proposedPv != null && s.sale_price_mode !== 'never') patch.sale_price_ttc = proposedPv;
    if (row.coefficient != null) patch.coefficient = row.coefficient;
    if (row.vat_rate != null) patch.vat_rate = row.vat_rate;
    if (row.ppc_ht != null) patch.ppc_ht = row.ppc_ht;
    if (row.ppc_ttc != null) patch.ppc_ttc = row.ppc_ttc;
    if (row.bin_location != null) patch.bin_location = row.bin_location;
    if (row.pack_qty != null) patch.pack_qty = row.pack_qty;
    if (row.color != null) patch.color = row.color;
    if (row.size != null) patch.size = row.size;
    if (row.year_from != null) patch.year_from = row.year_from;
    if (row.year_to != null) patch.year_to = row.year_to;
    patch.is_library = s.new_refs_in_library; // non stockée tant que pas réceptionnée
    const dispoNew = availabilityFromStatus(row.supply_status);
    if (dispoNew) patch.supplier_availability = dispoNew;
    if (dispoNew === 'red') anomalies.push("Fin de série chez Ducati (état F) : vendue tant qu'il en reste.");
    if (row.barcode && s.integrate_supplier_barcodes) patch.barcode = row.barcode.trim();
    // Réf. de remplacement (résolue en id à l'application — voir apply.ts)
    const newRepl = row.replacement_ref?.trim();
    if (newRepl && newRepl !== ref) patch._replace_with_ref = newRepl;
    return { rowIndex: row.rowIndex, reference: ref, existingId: null, action: 'create', changes: [], patch, anomalies };
  }

  // ---------- Référence REMPLACÉE → ne pas recréer (réglage) ----------
  if (existing.superseded_by_id && s.no_recreate_replaced) {
    anomalies.push('Référence remplacée — non mise à jour ; proposée en équivalence.');
    const p: Record<string, unknown> = s.replaced_to_equivalences
      ? { _suggest_equivalence: existing.superseded_by_id }
      : {};
    return {
      rowIndex: row.rowIndex, reference: ref, existingId: existing.id, action: 'skip',
      changes: [], patch: p, anomalies,
    };
  }

  // ---------- Mise à jour d'une référence existante ----------
  const accept = (field: keyof ExistingArticle, value: unknown, col: string) => {
    if (value == null) return;
    if (existing[field] !== value) {
      changes.push({ field: col, from: existing[field], to: value });
      patch[col] = value;
    }
  };
  if (s.accept_designation && row.designation != null && row.designation.trim()) {
    // La designation affichee est la version FR : on compare le tarif a l'original
    // fournisseur quand on le connait, sinon a la designation elle-meme. Le patch
    // porte l'original ; la traduction (translate/api.ts) le convertit ensuite.
    const incoming = row.designation.trim();
    const current = existing.designation_source ?? existing.designation;
    if (current !== incoming) {
      changes.push({ field: 'designation', from: current, to: incoming });
      patch.designation = incoming;
    }
  }
  // PA : reglage « accepter le prix d'achat », et verrou G8 (jamais ecrase).
  if (s.accept_purchase_price && pa != null) {
    if (existing.price_purchase_locked) {
      if (existing.purchase_price !== pa) anomalies.push("Prix d'achat verrouillé : conservé.");
    } else {
      accept('purchase_price', pa, 'purchase_price');
      if (paFromClass && patch.purchase_price != null) patch._pa_from_class = true;
    }
  }
  // La classe de remise du tarif est gardee sur la fiche (si la colonne existe).
  if (row.discount_group != null && existing.discount_group !== undefined) {
    const stored = normalizeDiscountCode(existing.discount_group) || null;
    const next = cls || null;
    if (stored !== next) {
      changes.push({ field: 'discount_group', from: stored, to: next });
      patch.discount_group = next;
    }
  }
  if (s.accept_supplier_ref && row.supplier_ref != null) accept('supplier_ref', row.supplier_ref, 'supplier_ref');
  if (s.accept_category && row.category_path != null) accept('category_path', row.category_path, 'category_path');
  if (s.accept_brand && row.brand != null) accept('brand', row.brand, 'brand');

  // Coefficient : conservé par défaut (réglage « garder le coefficient »)
  if (!s.keep_coefficient && row.coefficient != null) accept('coefficient', row.coefficient, 'coefficient');

  // Etat au tarif : fin de série signalée, surtout si on en a encore en stock
  const dispo = availabilityFromStatus(row.supply_status);
  if (dispo && existing.supplier_availability !== dispo) {
    changes.push({ field: 'supplier_availability', from: existing.supplier_availability ?? null, to: dispo });
    patch.supplier_availability = dispo;
    if (dispo === 'red') anomalies.push("Passe en fin de série chez Ducati (état F) : vendue tant qu'il en reste.");
  }

  // PPC : toujours rafraîchi quand présent (donnée fournisseur, pas un prix de vente)
  if (row.ppc_ht != null) accept('ppc_ht', row.ppc_ht, 'ppc_ht');
  if (row.ppc_ttc != null) accept('ppc_ttc', row.ppc_ttc, 'ppc_ttc');

  // Année modèle : donnée factuelle fournisseur — rafraîchie quand présente
  if (row.year_from != null) accept('year_from', row.year_from, 'year_from');
  if (row.year_to != null) accept('year_to', row.year_to, 'year_to');

  // PV selon le mode
  if (proposedPv != null && s.sale_price_mode !== 'never') {
    if (s.sale_price_mode === 'always') {
      if (proposedPv !== existing.sale_price_ttc) {
        changes.push({ field: 'sale_price_ttc', from: existing.sale_price_ttc, to: proposedPv });
        patch.sale_price_ttc = proposedPv;
      }
    } else if (proposedPv > existing.sale_price_ttc) {
      changes.push({ field: 'sale_price_ttc', from: existing.sale_price_ttc, to: proposedPv });
      patch.sale_price_ttc = proposedPv;
    } else if (proposedPv < existing.sale_price_ttc) {
      anomalies.push(
        `PV en baisse (${existing.sale_price_ttc} → ${proposedPv}) : conservé à l'ancien prix (règle hausse seule).`,
      );
    }
  }

  if (row.barcode && row.barcode.trim() && s.integrate_supplier_barcodes) patch._barcode = row.barcode.trim();

  // Réf. de remplacement : marque l'article existant comme remplacé par la nouvelle
  // (résolue en id à l'application — voir apply.ts). Ne re-signale pas si déjà posée.
  const repl = row.replacement_ref?.trim();
  if (repl && repl !== ref && !existing.superseded_by_id) {
    patch._replace_with_ref = repl;
    anomalies.push(`Remplacée par ${repl} — la fiche sera marquée et la nouvelle réf privilégiée.`);
  }

  const action: DiffAction = changes.length > 0 || patch._barcode || patch._replace_with_ref ? 'update' : 'skip';
  return { rowIndex: row.rowIndex, reference: ref, existingId: existing.id, action, changes, patch, anomalies };
}

/** Croise toutes les lignes importées avec le référentiel (indexé par référence). */
export function buildDiff(
  rows: ImportRow[],
  existingByRef: Map<string, ExistingArticle>,
  opts: ImportOptions = {},
): DiffResult[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const ref = row.reference?.trim() ?? '';
    const dup = ref && seen.has(ref);
    if (ref) seen.add(ref);
    const res = diffRow(row, existingByRef.get(ref) ?? null, opts);
    if (dup) res.anomalies.push('Référence en double dans le fichier importé.');
    return res;
  });
}

export type DiffSummary = { creates: number; updates: number; skips: number; anomalies: number };

export function summarize(diff: DiffResult[]): DiffSummary {
  return diff.reduce<DiffSummary>(
    (acc, d) => {
      if (d.action === 'create') acc.creates++;
      else if (d.action === 'update') acc.updates++;
      else acc.skips++;
      acc.anomalies += d.anomalies.length;
      return acc;
    },
    { creates: 0, updates: 0, skips: 0, anomalies: 0 },
  );
}

// ─── Règles PV / PPC (Prix Public Conseillé) ─────────────────────────────────

/** Règle de calcul du PV depuis le PPC (table ppc_price_rules). */
/**
 * Arrondi applique APRES le pourcentage (l'ordre decide par le client le
 * 19/10/2026 : « 6 % puis arrondi »). Toujours vers le HAUT : on n'arrondit
 * jamais un prix de vente a la baisse sans le vouloir.
 */
export type RoundMode = 'none' | 'ceil_0_1' | 'ceil_0_5' | 'ceil_1' | 'ceil_5' | 'ceil_10' | 'end_99';

const STEPS: Record<string, number> = { ceil_0_1: 0.1, ceil_0_5: 0.5, ceil_1: 1, ceil_5: 5, ceil_10: 10 };

/** Arrondit un prix vers le haut selon le mode. Un prix nul ou negatif est rendu tel quel. */
export function roundUpPrice(value: number, mode: RoundMode | null | undefined): number {
  if (!(value > 0) || !mode || mode === 'none') return round2(value);
  if (mode === 'end_99') {
    // Prix psychologique : le premier x,99 >= valeur (12,00 -> 12,99 ; 12,99 -> 12,99).
    const base = Math.floor(round2(value));
    const cand = round2(base + 0.99);
    return cand >= round2(value) ? cand : round2(base + 1.99);
  }
  const step = STEPS[mode];
  if (!step) return round2(value);
  // On travaille en centimes pour eviter les surprises du flottant (1,15 / 0,05).
  const cents = Math.round(value * 100);
  const stepCents = Math.round(step * 100);
  return round2((Math.ceil(cents / stepCents) * stepCents) / 100);
}

export type PpcRule = {
  id?: string;
  supplier_name: string | null;
  category_path: string | null;
  brand: string | null;
  pct: number; // % PV/PPC : PV TTC = PPC TTC × (1 + pct/100)
  round_mode?: RoundMode | null; // arrondi applique apres le pourcentage
  is_active?: boolean;
};

const ci = (s: string) => s.trim().toLowerCase();

/**
 * Trouve la règle PPC la plus spécifique pour une ligne : tous les critères
 * non nuls de la règle doivent matcher (fournisseur =, rayon = préfixe du
 * category_path, marque =) ; la règle avec le PLUS de critères remplis gagne.
 */
export function resolvePpcRule(row: ImportRow, rules: PpcRule[]): PpcRule | null {
  let best: PpcRule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (r.is_active === false) continue;
    let score = 0;
    if (r.supplier_name != null && r.supplier_name.trim() !== '') {
      if (!row.supplier_name || ci(row.supplier_name) !== ci(r.supplier_name)) continue;
      score++;
    }
    if (r.category_path != null && r.category_path.trim() !== '') {
      if (!row.category_path || !ci(row.category_path).startsWith(ci(r.category_path))) continue;
      score++;
    }
    if (r.brand != null && r.brand.trim() !== '') {
      if (!row.brand || ci(row.brand) !== ci(r.brand)) continue;
      score++;
    }
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/**
 * Applique les règles PPC aux lignes importées ayant un PPC TTC :
 *  - si une règle matche → PV TTC = PPC × (1 + pct/100) ;
 *  - sinon, si la ligne n'a pas de PV (cas des tarifs Ducati : colonne
 *    « Prix au détail » = PPC, sans prix de vente) → PV par défaut = PPC.
 * Ne touche jamais un PV déjà fourni par le fichier si aucune règle ne matche.
 * Retourne le nombre de PV (re)calculés depuis le PPC.
 */
export function applyPpcRules(rows: ImportRow[], rules: PpcRule[]): number {
  let n = 0;
  for (const row of rows) {
    if (row.ppc_ttc == null || !(row.ppc_ttc > 0)) continue;
    const rule = rules.length ? resolvePpcRule(row, rules) : null;
    if (rule) {
      row.sale_price_ttc = roundUpPrice(row.ppc_ttc * (1 + rule.pct / 100), rule.round_mode);
      n++;
    } else if (row.sale_price_ttc == null) {
      row.sale_price_ttc = round2(row.ppc_ttc);
      n++;
    }
  }
  return n;
}
