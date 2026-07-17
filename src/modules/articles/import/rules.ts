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
  /** Réf. de REMPLACEMENT (colonne « Remplacement » Ducati/G8) : la nouvelle réf qui remplace celle-ci. */
  replacement_ref?: string | null;
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
  /** PV TTC strictement sous ce seuil → remonté à floorMin (ex. 1 €). */
  floorThreshold?: number;
  /** Prix minimum appliqué sous le seuil (ex. 2 €). */
  floorMin?: number;
};

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

/** Plancher de prix : PV TTC > 0 et < seuil → max(PV, minimum). */
export function applyPriceFloor(pv: number, threshold: number, min: number): number {
  if (!(pv > 0) || !(threshold > 0) || !(min > 0)) return pv;
  return pv < threshold ? Math.max(pv, min) : pv;
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
  const pa = row.purchase_price != null
    ? (s.purchase_price_3dec ? round3(row.purchase_price) : round2(row.purchase_price))
    : null;

  // PV proposé, plancher appliqué (réglage société)
  const proposedPv = row.sale_price_ttc != null
    ? applyPriceFloor(round2(row.sale_price_ttc), floorT, floorM)
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
    if (proposedPv != null && s.sale_price_mode !== 'never') patch.sale_price_ttc = proposedPv;
    if (row.coefficient != null) patch.coefficient = row.coefficient;
    if (row.vat_rate != null) patch.vat_rate = row.vat_rate;
    if (row.ppc_ht != null) patch.ppc_ht = row.ppc_ht;
    if (row.ppc_ttc != null) patch.ppc_ttc = row.ppc_ttc;
    if (row.bin_location != null) patch.bin_location = row.bin_location;
    if (row.pack_qty != null) patch.pack_qty = row.pack_qty;
    if (row.color != null) patch.color = row.color;
    if (row.size != null) patch.size = row.size;
    patch.is_library = s.new_refs_in_library; // non stockée tant que pas réceptionnée
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
    accept('designation', row.designation.trim(), 'designation');
  }
  if (s.accept_purchase_price && pa != null) accept('purchase_price', pa, 'purchase_price');
  if (s.accept_supplier_ref && row.supplier_ref != null) accept('supplier_ref', row.supplier_ref, 'supplier_ref');
  if (s.accept_category && row.category_path != null) accept('category_path', row.category_path, 'category_path');
  if (s.accept_brand && row.brand != null) accept('brand', row.brand, 'brand');

  // Coefficient : conservé par défaut (réglage « garder le coefficient »)
  if (!s.keep_coefficient && row.coefficient != null) accept('coefficient', row.coefficient, 'coefficient');

  // PPC : toujours rafraîchi quand présent (donnée fournisseur, pas un prix de vente)
  if (row.ppc_ht != null) accept('ppc_ht', row.ppc_ht, 'ppc_ht');
  if (row.ppc_ttc != null) accept('ppc_ttc', row.ppc_ttc, 'ppc_ttc');

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
export type PpcRule = {
  id?: string;
  supplier_name: string | null;
  category_path: string | null;
  brand: string | null;
  pct: number; // % PV/PPC : PV TTC = PPC TTC × (1 + pct/100)
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
      row.sale_price_ttc = round2(row.ppc_ttc * (1 + rule.pct / 100));
      n++;
    } else if (row.sale_price_ttc == null) {
      row.sale_price_ttc = round2(row.ppc_ttc);
      n++;
    }
  }
  return n;
}
