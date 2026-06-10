/**
 * M2 — Parsing CSV des tarifs fournisseurs (Excel : export CSV pour l'instant).
 * Détecte le séparateur (`,` ou `;`), gère les guillemets. Mapping colonnes → champs.
 */
import type { ImportRow } from './rules';

export type ParsedCsv = { headers: string[]; rows: string[][] };

/** Champs cibles mappables depuis les colonnes du fichier. */
export const IMPORT_FIELDS = [
  'reference', 'designation', 'brand', 'category_path', 'supplier_ref',
  'barcode', 'purchase_price', 'sale_price_ttc', 'coefficient', 'vat_rate',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ColumnMapping = Partial<Record<ImportField, number>>; // champ → index de colonne

function detectDelimiter(line: string): ';' | ',' | '\t' {
  const counts = { ';': 0, ',': 0, '\t': 0 } as Record<string, number>;
  for (const ch of line) if (ch in counts) counts[ch]++;
  if (counts['\t'] > counts[';'] && counts['\t'] > counts[',']) return '\t';
  return counts[';'] >= counts[','] ? ';' : ',';
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const delim = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delim);
  const rows = lines.slice(1).map((l) => splitLine(l, delim));
  return { headers, rows };
}

/** Nombre depuis une cellule (gère virgule décimale et espaces). */
export function parseNum(cell: string | undefined): number | null {
  if (cell == null || cell.trim() === '') return null;
  const n = Number(cell.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Devine un mapping par défaut à partir des libellés de colonnes. */
export function guessMapping(headers: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  headers.forEach((h, i) => {
    const n = norm(h);
    if (m.reference == null && /(^ref|reference|code article|article)/.test(n)) m.reference = i;
    else if (m.designation == null && /(designation|libelle|description|nom)/.test(n)) m.designation = i;
    else if (m.brand == null && /(marque|brand)/.test(n)) m.brand = i;
    else if (m.supplier_ref == null && /(ref.*fourn|fournisseur)/.test(n)) m.supplier_ref = i;
    else if (m.barcode == null && /(code.?barre|barcode|ean|gencod)/.test(n)) m.barcode = i;
    else if (m.purchase_price == null && /(prix.*achat|^pa\b|pa ht|achat)/.test(n)) m.purchase_price = i;
    else if (m.sale_price_ttc == null && /(prix.*vente|pv ttc|^pv\b|public|tarif)/.test(n)) m.sale_price_ttc = i;
    else if (m.coefficient == null && /(coef)/.test(n)) m.coefficient = i;
    else if (m.vat_rate == null && /(tva|vat)/.test(n)) m.vat_rate = i;
    else if (m.category_path == null && /(rayon|categorie|famille)/.test(n)) m.category_path = i;
  });
  return m;
}

export function buildRows(parsed: ParsedCsv, mapping: ColumnMapping): ImportRow[] {
  const at = (row: string[], field: ImportField) => {
    const idx = mapping[field];
    return idx != null ? row[idx] : undefined;
  };
  return parsed.rows.map((row, i) => ({
    rowIndex: i + 2, // +1 (0-based) +1 (header)
    reference: (at(row, 'reference') ?? '').trim(),
    designation: at(row, 'designation') ?? null,
    brand: at(row, 'brand') ?? null,
    category_path: at(row, 'category_path') ?? null,
    supplier_ref: at(row, 'supplier_ref') ?? null,
    barcode: at(row, 'barcode') ?? null,
    purchase_price: parseNum(at(row, 'purchase_price')),
    sale_price_ttc: parseNum(at(row, 'sale_price_ttc')),
    coefficient: parseNum(at(row, 'coefficient')),
    vat_rate: parseNum(at(row, 'vat_rate')),
  }));
}
