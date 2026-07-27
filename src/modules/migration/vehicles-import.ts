/**
 * M14 — Migration G8 : import de véhicules (fiches VIN) depuis un CSV
 * (dry-run + application), même patron que contacts-import.ts / articles-import.ts.
 * Idempotent par VIN : un VIN déjà présent pour la société est SKIP (« ignoré »),
 * jamais écrasé.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  normHeader, splitCsvLine, splitCsvRows, parseNum, type ParsedRow, type ImportPreview, type ApplyResult,
} from './csv-utils';

export type { ImportPreview, ApplyResult };

const HEADER_MAP: Record<string, string> = {
  vin: 'vin', chassis: 'vin', n_chassis: 'vin', numero_de_chassis: 'vin', n_de_serie: 'vin', numero_de_serie: 'vin',
  modele: 'model', model: 'model',
  annee: 'model_year', annee_modele: 'model_year', model_year: 'model_year', year: 'model_year', millesime: 'model_year',
  plate: 'plate', immatriculation: 'plate', plaque: 'plate', n_plaque: 'plate',
};

export function parseVehiclesCsv(text: string): ImportPreview {
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
      if (f === 'model_year') { const n = parseNum(v); if (n != null) payload[f] = Math.round(n); }
      else if (f === 'vin') payload[f] = v.toUpperCase();
      else payload[f] = v;
    });
    const vin = (payload.vin as string)?.trim();
    const error = !vin ? 'VIN requis' : vin.length > 17 ? 'VIN invalide (> 17 caractères)' : null;
    mapped.push({ row, payload, error });
  }
  return { headers, rows, mapped, toCreate: mapped.filter((m) => !m.error).length, errors: mapped.filter((m) => m.error).length };
}

/** Applique l'import : insère les véhicules valides et non déjà présents (VIN, par société). */
export async function applyVehiclesImport(companyId: string, preview: ImportPreview): Promise<ApplyResult> {
  const valid = preview.mapped.filter((m) => !m.error);
  if (valid.length === 0) return { created: 0, ignored: 0 };

  const { data: existing, error: existErr } = await supabase.from('vehicles').select('vin').eq('company_id', companyId).not('vin', 'is', null);
  if (existErr) throw existErr;
  const seen = new Set((existing ?? []).map((v) => v.vin));

  let created = 0; let ignored = 0;
  const toInsert: Record<string, unknown>[] = [];
  for (const m of valid) {
    const vin = (m.payload.vin as string).trim();
    if (seen.has(vin)) { ignored++; continue; }
    seen.add(vin);
    toInsert.push({ ...m.payload, company_id: companyId });
  }
  if (toInsert.length === 0) return { created: 0, ignored };

  for (let i = 0; i < toInsert.length; i += 200) {
    const batch = toInsert.slice(i, i + 200);
    const { error, count } = await supabase.from('vehicles').insert(batch, { count: 'exact' });
    if (error) throw error;
    created += count ?? batch.length;
  }
  return { created, ignored };
}
