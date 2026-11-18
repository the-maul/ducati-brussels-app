/**
 * M1 — Import d'un fichier de tarif client (G8 « Import fichier » de la fiche tarif) : logique PURE.
 * Une feuille (Excel ou CSV lu par `xlsx`) avec une ligne d'en-tete ; colonnes reconnues sans tenir
 * compte des accents ni de la casse :
 *   Reference (obligatoire) · Remise % · Coefficient · Prix net HT · Qte mini · Date debut · Date fin
 * Une ligne = une valeur (remise OU coefficient OU prix net). Plusieurs lignes d'une meme reference
 * = ses paliers (4 au plus). Teste dans tests/tarifs-clients.test.ts.
 */
import { cleanTiers, type PriceKind, type PriceTier } from './customer-pricing';

export type ImportedRule = { reference: string; kind: PriceKind; tiers: PriceTier[]; date_from: string | null; date_to: string | null };
export type ImportError = { row: number; reference: string; reason: 'noValue' | 'manyValues' | 'badNumber' | 'badDate' | 'tooManyTiers' | 'kindMismatch' };
export type ImportResult = { rules: ImportedRule[]; errors: ImportError[]; missingReference: boolean };

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

type Col = 'reference' | 'discount' | 'coefficient' | 'net' | 'qty' | 'from' | 'to';
function columnOf(header: unknown): Col | null {
  const h = fold(header);
  if (!h) return null;
  if (/^(ref|reference|code article|article|code)\b/.test(h)) return 'reference';
  if (/remise|discount|%/.test(h)) return 'discount';
  if (/coef/.test(h)) return 'coefficient';
  if (/prix|pv|net|price/.test(h)) return 'net';
  if (/qte|quantite|qty|mini/.test(h)) return 'qty';
  if (/debut|from|^du$|start/.test(h)) return 'from';
  if (/fin|^au$|to$|end/.test(h)) return 'to';
  return null;
}

/** Nombre au format FR ou EN (« 12,50 », « 1 234,5 ») ; vide = null ; invalide = NaN. */
export function parseNumberCell(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v).replace(/[\s %]/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Date AAAA-MM-JJ, JJ/MM/AAAA ou numero de serie Excel ; vide = null ; invalide = undefined. */
export function parseDateCell(v: unknown): string | null | undefined {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

export function parsePriceListSheet(rows: readonly (readonly unknown[])[]): ImportResult {
  const header = rows[0] ?? [];
  const cols = new Map<Col, number>();
  header.forEach((h, i) => { const c = columnOf(h); if (c && !cols.has(c)) cols.set(c, i); });
  if (!cols.has('reference')) return { rules: [], errors: [], missingReference: true };
  const at = (row: readonly unknown[], c: Col) => (cols.has(c) ? row[cols.get(c)!] : null);

  const errors: ImportError[] = [];
  const groups = new Map<string, ImportedRule & { _rows: number[] }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const reference = String(at(row, 'reference') ?? '').trim();
    if (!reference) continue;
    const rowNo = i + 1;
    const values: [PriceKind, number | null][] = [
      ['discount', parseNumberCell(at(row, 'discount'))],
      ['coefficient', parseNumberCell(at(row, 'coefficient'))],
      ['net', parseNumberCell(at(row, 'net'))],
    ];
    const present = values.filter(([, v]) => v != null);
    if (present.some(([, v]) => Number.isNaN(v))) { errors.push({ row: rowNo, reference, reason: 'badNumber' }); continue; }
    if (present.length === 0) { errors.push({ row: rowNo, reference, reason: 'noValue' }); continue; }
    if (present.length > 1) { errors.push({ row: rowNo, reference, reason: 'manyValues' }); continue; }
    const [kind, value] = present[0] as [PriceKind, number];
    const qtyRaw = parseNumberCell(at(row, 'qty'));
    if (Number.isNaN(qtyRaw) || (kind === 'discount' && (value < 0 || value > 100)) || value < 0) { errors.push({ row: rowNo, reference, reason: 'badNumber' }); continue; }
    const from = parseDateCell(at(row, 'from')), to = parseDateCell(at(row, 'to'));
    if (from === undefined || to === undefined) { errors.push({ row: rowNo, reference, reason: 'badDate' }); continue; }
    const key = reference.toUpperCase();
    const g = groups.get(key);
    const tier = { min_qty: qtyRaw && qtyRaw > 0 ? qtyRaw : 1, value };
    if (!g) { groups.set(key, { reference, kind, tiers: [tier], date_from: from, date_to: to, _rows: [rowNo] }); continue; }
    if (g.kind !== kind) { errors.push({ row: rowNo, reference, reason: 'kindMismatch' }); continue; }
    if (g.tiers.length >= 4) { errors.push({ row: rowNo, reference, reason: 'tooManyTiers' }); continue; }
    g.tiers.push(tier);
    g._rows.push(rowNo);
  }
  const rules = [...groups.values()].map(({ _rows, ...r }) => ({ ...r, tiers: cleanTiers(r.tiers) }));
  return { rules, errors, missingReference: false };
}
