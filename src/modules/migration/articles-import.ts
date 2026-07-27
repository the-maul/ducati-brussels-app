/**
 * M14 — Migration G8 : import d'articles depuis un CSV (dry-run + application),
 * sur le même patron que contacts-import.ts. Idempotent par référence : une
 * référence déjà présente pour la société est SKIP (comptée en « ignorés »),
 * jamais écrasée (règle 3 du CLAUDE.md — pas d'UPDATE silencieux sur un article
 * existant via un import de masse).
 */
import { supabase } from '@/integrations/supabase/client';
import {
  normHeader, splitCsvLine, splitCsvRows, parseNum, type ParsedRow, type ImportPreview, type ApplyResult,
} from './csv-utils';

export type { ImportPreview, ApplyResult };

const HEADER_MAP: Record<string, string> = {
  reference: 'reference', ref: 'reference', reference_g8: 'reference',
  designation: 'designation', design: 'designation', libelle: 'designation', description: 'designation', nom: 'designation',
  pv_ttc: 'sale_price_ttc', prix: 'sale_price_ttc', prix_vente: 'sale_price_ttc', prix_ttc: 'sale_price_ttc', prix_vente_ttc: 'sale_price_ttc',
  marque: 'brand', brand: 'brand',
  barcode: 'barcode', code_barre: 'barcode', code_barres: 'barcode', ean: 'barcode', ean13: 'barcode',
};

export function parseArticlesCsv(text: string): ImportPreview {
  const split = splitCsvRows(text);
  if (!split) return { headers: [], rows: [], mapped: [], toCreate: 0, errors: 0 };
  const { rawHeaders, dataLines, delim } = split;
  const headers = rawHeaders.map(normHeader);
  const fields = headers.map((h) => HEADER_MAP[h] ?? null);

  const rows: ParsedRow[] = [];
  const mapped: ImportPreview['mapped'] = [];
  for (const line of dataLines) {
    const cells = splitCsvLine(line, delim);
    const row: ParsedRow = {};
    rawHeaders.forEach((h, j) => { row[h] = cells[j] ?? ''; });
    rows.push(row);

    const payload: Record<string, unknown> = {};
    fields.forEach((f, j) => {
      const v = (cells[j] ?? '').trim();
      if (!f || v === '') return;
      if (f === 'sale_price_ttc') { const n = parseNum(v); if (n != null) payload[f] = n; }
      else payload[f] = v;
    });
    const hasReference = (payload.reference as string)?.trim();
    const hasDesignation = (payload.designation as string)?.trim();
    const error = !hasReference ? 'Référence requise' : !hasDesignation ? 'Désignation requise' : null;
    mapped.push({ row, payload, error });
  }
  return { headers, rows, mapped, toCreate: mapped.filter((m) => !m.error).length, errors: mapped.filter((m) => m.error).length };
}

/** Applique l'import : insère les articles valides et non déjà présents (référence, par société). */
export async function applyArticlesImport(companyId: string, preview: ImportPreview): Promise<ApplyResult> {
  const valid = preview.mapped.filter((m) => !m.error);
  if (valid.length === 0) return { created: 0, ignored: 0 };

  const { data: existing, error: existErr } = await supabase.from('articles').select('reference').eq('company_id', companyId);
  if (existErr) throw existErr;
  const seen = new Set((existing ?? []).map((a) => a.reference));

  let created = 0; let ignored = 0;
  const toInsert: { payload: Record<string, unknown>; barcode: string | null }[] = [];
  for (const m of valid) {
    const ref = (m.payload.reference as string).trim();
    if (seen.has(ref)) { ignored++; continue; }
    seen.add(ref);
    const { barcode, ...rest } = m.payload as Record<string, unknown> & { barcode?: string };
    toInsert.push({ payload: { ...rest, company_id: companyId }, barcode: barcode ?? null });
  }
  if (toInsert.length === 0) return { created: 0, ignored };

  for (let i = 0; i < toInsert.length; i += 200) {
    const batch = toInsert.slice(i, i + 200);
    const { data: inserted, error } = await supabase.from('articles').insert(batch.map((b) => b.payload)).select('id');
    if (error) throw error;
    created += inserted?.length ?? batch.length;

    const barcodeRows = (inserted ?? []).map((a, idx) => ({ article_id: a.id, barcode: batch[idx].barcode, is_primary: true }))
      .filter((r): r is { article_id: string; barcode: string; is_primary: true } => !!r.barcode);
    if (barcodeRows.length > 0) {
      const { error: bErr } = await supabase.from('article_barcodes').insert(barcodeRows);
      if (bErr) throw bErr;
    }
  }
  return { created, ignored };
}
