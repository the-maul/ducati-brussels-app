/**
 * M5 — Règles PURES de l'édition du stock multi-critères (rattrapage G8 du 18/11/2026) :
 * onglets, filtres à trois états, classement sur 4 niveaux et sous-totaux.
 * Testées dans tests/inventaire-guide.test.ts.
 */

/** Les 8 onglets G8 + articles en rupture. */
export const EDITION_VIEWS = [
  'reel', 'arrete', 'copie', 'non_reajuste', 'ecart', 'date', 'depreciation', 'invendus', 'rupture',
] as const;
export type EditionView = (typeof EDITION_VIEWS)[number];

/** Onglets qui lisent une photo (arrêté ou copie). */
export function viewNeedsSnapshot(v: EditionView): 'arrete' | 'copie' | null {
  if (v === 'arrete' || v === 'non_reajuste' || v === 'ecart') return 'arrete';
  if (v === 'copie') return 'copie';
  return null;
}

export type TriState = 'inclus' | 'exclus' | 'uniquement';

export type EditionFilters = {
  category: string; supplierId: string; brand: string; bin: string; search: string;
  types: string[];
  zero: TriState; neg: TriState; demo: TriState; depot: TriState;
  from: string; to: string; snapshotId: string; at: string; since: string;
};

export const DEFAULT_FILTERS: EditionFilters = {
  category: '', supplierId: '', brand: '', bin: '', search: '',
  types: ['A', 'V', 'O', 'P', 'D'],
  zero: 'exclus', neg: 'inclus', demo: 'inclus', depot: 'inclus',
  from: '', to: '', snapshotId: '', at: '', since: '',
};

/** Paramètre `_f` de la fonction `stock_edition` (champs vides omis). */
export function filtersToJson(f: EditionFilters): Record<string, unknown> {
  const out: Record<string, unknown> = { zero: f.zero, neg: f.neg, demo: f.demo, depot: f.depot, types: f.types };
  const put = (k: string, v: string) => { if (v.trim()) out[k] = v.trim(); };
  put('category', f.category); put('supplier_id', f.supplierId); put('brand', f.brand); put('bin', f.bin);
  put('search', f.search); put('from', f.from); put('to', f.to); put('snapshot_id', f.snapshotId);
  put('since', f.since);
  if (f.at.trim()) out.at = f.at.length <= 10 ? `${f.at}T23:59:59` : f.at;
  return out;
}

/** Applique un filtre à trois états à une valeur booléenne (miroir du SQL). */
export function triStateKeeps(t: TriState, value: boolean): boolean {
  if (t === 'exclus') return !value;
  if (t === 'uniquement') return value;
  return true;
}

export const SORT_KEYS = ['supplier', 'rayon', 'sous_rayon', 'categorie', 'brand', 'bin', 'type', 'reference', 'designation', 'serial'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type EditionRowLike = {
  supplier_name: string | null; category_path: string | null; brand: string | null; bin_location: string | null;
  mgmt_type: string; reference: string; designation: string; serial_no: string | null;
};

/** Valeur de regroupement d'une ligne pour une clé (famille « RR-SS-CC » découpée). */
export function sortValue(r: EditionRowLike, k: SortKey): string {
  const parts = (r.category_path ?? '').split('-');
  switch (k) {
    case 'supplier': return r.supplier_name ?? '';
    case 'rayon': return parts[0] ?? '';
    case 'sous_rayon': return parts.slice(0, 2).join('-');
    case 'categorie': return parts.slice(0, 3).join('-');
    case 'brand': return r.brand ?? '';
    case 'bin': return r.bin_location ?? '';
    case 'type': return r.mgmt_type;
    case 'reference': return r.reference;
    case 'designation': return r.designation;
    case 'serial': return r.serial_no ?? '';
  }
}

/** Classement sur 4 niveaux (vides en dernier), puis référence. */
export function sortEditionRows<T extends EditionRowLike>(rows: T[], levels: SortKey[]): T[] {
  const keys = levels.slice(0, 4);
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const va = sortValue(a, k); const vb = sortValue(b, k);
      if (va === vb) continue;
      if (!va) return 1;
      if (!vb) return -1;
      return va.localeCompare(vb, 'fr', { numeric: true });
    }
    return a.reference.localeCompare(b.reference, 'fr', { numeric: true });
  });
}

/** Sous-totaux (quantité, valeur) par valeur du 1er niveau de classement. */
export function subtotals<T extends EditionRowLike & { qty: number; value: number }>(rows: T[], level: SortKey): { key: string; qty: number; value: number; count: number }[] {
  const map = new Map<string, { key: string; qty: number; value: number; count: number }>();
  for (const r of rows) {
    const key = sortValue(r, level);
    const s = map.get(key) ?? { key, qty: 0, value: 0, count: 0 };
    s.qty += r.qty; s.value += r.value; s.count += 1;
    map.set(key, s);
  }
  return [...map.values()];
}
