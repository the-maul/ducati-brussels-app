/**
 * M2 — Moteur d'import des tarifs (INV013 + ACH003).
 * Applique les règles métier du cahier des charges (dossier §M2) au croisement
 * d'une ligne de tarif importée avec le référentiel existant. Fonctions PURES
 * (testées dans tests/import-rules.test.ts — CLAUDE.md règle 7).
 *
 * Règles appliquées :
 *  1. Accepter les changements de désignation / PA / fournisseur / rayon / marque.
 *  2. PV à la HAUSSE uniquement (jamais de baisse automatique).
 *  3. CONSERVER le coefficient existant (ne pas l'écraser).
 *  4. NE PAS recréer une référence déjà remplacée (superseded_by) → anomalie.
 *  5. Les remplacées → proposées en équivalence (flag).
 *  6. Créer les NOUVELLES références en "librairie" (non stockées).
 *  7. Codes-barres fournisseurs conservés/ajoutés.
 *  8. PA arrondi à 3 décimales.
 */

export type ImportRow = {
  reference: string;
  designation?: string | null;
  brand?: string | null;
  category_path?: string | null;
  supplier_ref?: string | null;
  barcode?: string | null;
  purchase_price?: number | null; // PA HT
  sale_price_ttc?: number | null; // PV TTC proposé
  coefficient?: number | null;
  vat_rate?: number | null;
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

/**
 * Calcule l'effet d'UNE ligne importée sur le référentiel.
 * @param row ligne de tarif
 * @param existing article existant de MÊME référence (ou null si nouveau)
 */
export function diffRow(row: ImportRow, existing: ExistingArticle | null): DiffResult {
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

  // PA arrondi 3 décimales (règle 8)
  const pa = row.purchase_price != null ? round3(row.purchase_price) : null;

  // ---------- NOUVELLE référence → création en librairie (règle 6) ----------
  if (!existing) {
    patch.reference = ref;
    patch.designation = row.designation?.trim() || ref;
    if (row.brand != null) patch.brand = row.brand;
    if (row.category_path != null) patch.category_path = row.category_path;
    if (row.supplier_ref != null) patch.supplier_ref = row.supplier_ref;
    if (pa != null) patch.purchase_price = pa;
    if (row.sale_price_ttc != null) patch.sale_price_ttc = round2(row.sale_price_ttc);
    if (row.coefficient != null) patch.coefficient = row.coefficient;
    if (row.vat_rate != null) patch.vat_rate = row.vat_rate;
    patch.is_library = true; // non stockée tant que pas réceptionnée
    if (row.barcode) patch.barcode = row.barcode.trim(); // règle 7 (rattaché à part)
    return { rowIndex: row.rowIndex, reference: ref, existingId: null, action: 'create', changes: [], patch, anomalies };
  }

  // ---------- Référence REMPLACÉE → ne pas recréer (règles 4 & 5) ----------
  if (existing.superseded_by_id) {
    anomalies.push('Référence remplacée — non mise à jour ; proposée en équivalence.');
    return {
      rowIndex: row.rowIndex, reference: ref, existingId: existing.id, action: 'skip',
      changes: [], patch: { _suggest_equivalence: existing.superseded_by_id }, anomalies,
    };
  }

  // ---------- Mise à jour d'une référence existante ----------
  // Règle 1 : accepter désignation / PA / fournisseur / rayon / marque
  const accept = (field: keyof ExistingArticle, value: unknown, col: string) => {
    if (value == null) return;
    if (existing[field] !== value) {
      changes.push({ field: col, from: existing[field], to: value });
      patch[col] = value;
    }
  };
  if (row.designation != null && row.designation.trim()) accept('designation', row.designation.trim(), 'designation');
  if (pa != null) accept('purchase_price', pa, 'purchase_price');
  if (row.supplier_ref != null) accept('supplier_ref', row.supplier_ref, 'supplier_ref');
  if (row.category_path != null) accept('category_path', row.category_path, 'category_path');
  if (row.brand != null) accept('brand', row.brand, 'brand');

  // Règle 3 : on ne touche JAMAIS au coefficient existant (pas dans le patch).

  // Règle 2 : PV à la hausse uniquement
  if (row.sale_price_ttc != null) {
    const newPv = round2(row.sale_price_ttc);
    if (newPv > existing.sale_price_ttc) {
      changes.push({ field: 'sale_price_ttc', from: existing.sale_price_ttc, to: newPv });
      patch.sale_price_ttc = newPv;
    } else if (newPv < existing.sale_price_ttc) {
      anomalies.push(
        `PV en baisse (${existing.sale_price_ttc} → ${newPv}) : conservé à l'ancien prix (règle hausse seule).`,
      );
    }
  }

  if (row.barcode && row.barcode.trim()) patch._barcode = row.barcode.trim(); // règle 7 (table à part)

  const action: DiffAction = changes.length > 0 || patch._barcode ? 'update' : 'skip';
  return { rowIndex: row.rowIndex, reference: ref, existingId: existing.id, action, changes, patch, anomalies };
}

/** Croise toutes les lignes importées avec le référentiel (indexé par référence). */
export function buildDiff(rows: ImportRow[], existingByRef: Map<string, ExistingArticle>): DiffResult[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const ref = row.reference?.trim() ?? '';
    const dup = ref && seen.has(ref);
    if (ref) seen.add(ref);
    const res = diffRow(row, existingByRef.get(ref) ?? null);
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
