/**
 * M2 — Application d'un import de tarifs : crée/maj les articles d'après le diff.
 */
import { createArticle, updateArticle, addBarcode, type ArticleInsert, type ArticleUpdate } from '../api';
import type { DiffResult } from './rules';

export type ApplyResult = {
  created: number;
  updated: number;
  errors: { rowIndex: number; reference: string; message: string }[];
};

/** Retire les clés internes du patch (préfixées `_`) et les colonnes hors table. */
function cleanPatch(patch: Record<string, unknown>): { fields: Record<string, unknown>; barcode?: string } {
  const fields: Record<string, unknown> = {};
  let barcode: string | undefined;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'barcode' || k === '_barcode') { if (typeof v === 'string') barcode = v; continue; }
    if (k.startsWith('_')) continue; // _suggest_equivalence, etc.
    fields[k] = v;
  }
  return { fields, barcode };
}

export async function applyImport(diff: DiffResult[], companyId: string): Promise<ApplyResult> {
  let created = 0;
  let updated = 0;
  const errors: ApplyResult['errors'] = [];

  for (const d of diff) {
    try {
      const { fields, barcode } = cleanPatch(d.patch);
      if (d.action === 'create') {
        const insert = { company_id: companyId, mgmt_type: 'A', ...fields } as ArticleInsert;
        const art = await createArticle(insert);
        if (barcode) await addBarcode(art.id, barcode);
        created++;
      } else if (d.action === 'update' && d.existingId) {
        if (Object.keys(fields).length > 0) await updateArticle(d.existingId, fields as ArticleUpdate);
        if (barcode) await addBarcode(d.existingId, barcode);
        updated++;
      }
    } catch (e) {
      errors.push({ rowIndex: d.rowIndex, reference: d.reference, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { created, updated, errors };
}
