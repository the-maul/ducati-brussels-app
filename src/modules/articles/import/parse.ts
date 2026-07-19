/**
 * M2 — Parsing des tarifs fournisseurs (CSV collé ou fichier Excel/CSV).
 * Détecte le séparateur (`,` ou `;`), gère les guillemets. Mapping colonnes → champs.
 * Le mapping auto reconnaît les en-têtes de l'export G8 (Référence, P.P.C. T.T.C.,
 * Réf Fournisseur, Casier, Condi.achat, Code TVA…).
 */
import type { ImportRow } from './rules';

export type ParsedCsv = { headers: string[]; rows: string[][] };

/** Champs cibles mappables depuis les colonnes du fichier. */
export const IMPORT_FIELDS = [
  'reference', 'designation', 'brand', 'category_path', 'supplier_ref', 'supplier_name',
  'barcode', 'purchase_price', 'sale_price_ttc', 'ppc_ht', 'ppc_ttc',
  'coefficient', 'vat_rate', 'bin_location', 'pack_qty', 'color', 'size',
  'year_from', 'year_to',
  'replacement_ref',
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

/**
 * Nombre depuis une cellule. Gère la virgule décimale, les espaces (y compris
 * insécables), les symboles € et % (export G8 : « 49,11 € », « 21,0 % ») et
 * les milliers européens (« 1.234,56 »).
 */
export function parseNum(cell: string | undefined): number | null {
  if (cell == null) return null;
  let s = String(cell).trim();
  if (s === '') return null;
  s = s.replace(/[€%\s  ]/g, '');
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Années depuis une cellule : « 2023 », « 2020-2023 », « 2020/2023 »,
 * « 2020 a 2023 »… Retourne la plage {from, to} (to = null si année unique).
 */
export function parseYearRange(cell: string | undefined | null): { from: number | null; to: number | null } {
  if (cell == null) return { from: null, to: null };
  // Nombres ENTIERS de 4 chiffres commençant par 19/20 (« 12023 » n'est pas une année).
  const years = (String(cell).match(/\d+/g) ?? [])
    .filter((n) => n.length === 4 && /^(19|20)/.test(n))
    .map(Number);
  if (years.length === 0) return { from: null, to: null };
  let from = years[0];
  let to = years.length > 1 ? years[years.length - 1] : null;
  if (to != null && to < from) { const tmp = from; from = to; to = tmp; }
  return { from, to };
}

/**
 * Matchers ordonnés (du plus spécifique au plus générique) : pour chaque colonne,
 * le premier champ LIBRE qui matche gagne. L'ordre évite les pièges G8 :
 * « Réf Fournisseur » avant « Fournisseur », « P.P.C. T.T.C. » avant « Prix T.T.C. »,
 * « Code barre » avant « Code TVA ».
 */
const MATCHERS: [ImportField, RegExp][] = [
  ['supplier_ref', /ref.*fourn/],
  ['supplier_name', /^fournisseur$/],
  ['replacement_ref', /(remplacement|remplace|replaced|substitu)/],
  // Année modèle : « Année fin » / « Year to » avant le générique « Année »
  ['year_to', /(annee|year|millesime).*\b(fin|max|jusqu\w*|au|to|end)\b/],
  ['year_from', /(annee|year|millesime|^my$|^model.?year)/],
  ['ppc_ht', /p\.?p\.?c.*h\.?t/],
  ['ppc_ttc', /(p\.?p\.?c.*t\.?t\.?c|prix.*detail|retail)/],
  ['barcode', /(code.?barre|barcode|ean|gencod)/],
  ['vat_rate', /(code.?tva|^tva|vat)/],
  ['pack_qty', /(condi|conditionnement|colis)/],
  ['bin_location', /(casier|emplacement)/],
  ['color', /couleur/],
  ['size', /taille/],
  ['brand', /(marque|brand)/],
  ['purchase_price', /(prix.*achat|^pa.?ht|^pa$|^achat)/],
  ['sale_price_ttc', /(prix.*vente|pv.?ttc|^pv$|prix.?t\.?t\.?c|public|tarif)/],
  ['coefficient', /coef/],
  ['category_path', /(^rayon$|categorie|famille|hierarchie)/],
  ['reference', /(^ref|reference|code.?article|^article$|^materiel$|^material)/],
  ['designation', /(designation|libelle|description|nom)/],
];

/** Devine un mapping par défaut à partir des libellés de colonnes. */
export function guessMapping(headers: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  headers.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    for (const [field, re] of MATCHERS) {
      if (m[field] == null && re.test(n)) { m[field] = i; return; }
    }
  });
  return m;
}

export function buildRows(parsed: ParsedCsv, mapping: ColumnMapping): ImportRow[] {
  const at = (row: string[], field: ImportField) => {
    const idx = mapping[field];
    return idx != null ? row[idx] : undefined;
  };
  const txt = (row: string[], field: ImportField) => {
    const v = at(row, field);
    return v == null || v.trim() === '' ? null : v.trim();
  };
  return parsed.rows.map((row, i) => {
    // Année : la colonne « Du » peut contenir une plage (« 2020-2023 ») ;
    // une colonne « Au » explicite l'emporte sur la borne haute de la plage
    // (borne HAUTE si cette colonne contient elle-même une plage).
    const yr = parseYearRange(at(row, 'year_from'));
    const yrTo = parseYearRange(at(row, 'year_to'));
    let yearFrom = yr.from;
    let yearTo = yrTo.to ?? yrTo.from ?? yr.to;
    if (yearFrom != null && yearTo != null && yearTo < yearFrom) {
      const tmp = yearFrom; yearFrom = yearTo; yearTo = tmp;
    }
    return {
    rowIndex: i + 2, // +1 (0-based) +1 (header)
    reference: (at(row, 'reference') ?? '').trim(),
    designation: at(row, 'designation') ?? null,
    brand: txt(row, 'brand'),
    category_path: txt(row, 'category_path'),
    supplier_ref: txt(row, 'supplier_ref'),
    supplier_name: txt(row, 'supplier_name'),
    barcode: txt(row, 'barcode'),
    purchase_price: parseNum(at(row, 'purchase_price')),
    sale_price_ttc: parseNum(at(row, 'sale_price_ttc')),
    ppc_ht: parseNum(at(row, 'ppc_ht')),
    ppc_ttc: parseNum(at(row, 'ppc_ttc')),
    coefficient: parseNum(at(row, 'coefficient')),
    vat_rate: parseNum(at(row, 'vat_rate')),
    bin_location: txt(row, 'bin_location'),
    pack_qty: parseNum(at(row, 'pack_qty')),
    color: txt(row, 'color'),
    size: txt(row, 'size'),
    year_from: yearFrom,
    year_to: yearTo,
    replacement_ref: txt(row, 'replacement_ref'),
    };
  });
}
