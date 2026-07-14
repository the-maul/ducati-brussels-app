/**
 * M2 — Application d'un import de tarifs : crée/maj les articles d'après le diff.
 * Optimisé gros fichiers (export G8 : 450k+ lignes) : créations INSÉRÉES PAR LOTS
 * (400/lot, repli ligne à ligne en cas d'erreur de lot pour un rapport précis),
 * mises à jour en pool de 8 requêtes concurrentes, codes-barres upsertés par lots.
 */
import { supabase } from '@/integrations/supabase/client';
import { updateArticle, type ArticleInsert, type ArticleUpdate } from '../api';
import type { DiffResult } from './rules';

export type ApplyResult = {
  created: number;
  updated: number;
  errors: { rowIndex: number; reference: string; message: string }[];
};

export type ApplyProgress = (done: number, total: number) => void;

const CHUNK = 400;
const CONCURRENCY = 8;

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

/** Upsert des codes-barres par lots (ignore les doublons). */
async function upsertBarcodes(items: { article_id: string; barcode: string }[]): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    const { error } = await supabase
      .from('article_barcodes')
      .upsert(items.slice(i, i + CHUNK), { onConflict: 'article_id,barcode', ignoreDuplicates: true });
    if (error) throw error;
  }
}

/** Pool de promesses à concurrence bornée. */
async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

export async function applyImport(
  diff: DiffResult[],
  companyId: string,
  onProgress?: ApplyProgress,
): Promise<ApplyResult> {
  let created = 0;
  let updated = 0;
  const errors: ApplyResult['errors'] = [];

  const creates = diff.filter((d) => d.action === 'create');
  const updates = diff.filter((d) => d.action === 'update' && d.existingId);
  const total = creates.length + updates.length;
  let done = 0;
  const tick = (n: number) => { done += n; onProgress?.(done, total); };

  // ── Créations par lots ──────────────────────────────────────────────────────
  for (let i = 0; i < creates.length; i += CHUNK) {
    const chunk = creates.slice(i, i + CHUNK);
    const rows = chunk.map((d) => {
      const { fields } = cleanPatch(d.patch);
      return { company_id: companyId, mgmt_type: 'A', ...fields } as ArticleInsert;
    });
    const { data, error } = await supabase.from('articles').insert(rows).select('id, reference');
    if (error) {
      // Repli ligne à ligne : rapport d'erreur précis, les bonnes lignes passent.
      for (const d of chunk) {
        const { fields, barcode } = cleanPatch(d.patch);
        const insert = { company_id: companyId, mgmt_type: 'A', ...fields } as ArticleInsert;
        const { data: one, error: e1 } = await supabase.from('articles').insert(insert).select('id').single();
        if (e1) {
          errors.push({ rowIndex: d.rowIndex, reference: d.reference, message: e1.message });
        } else {
          created++;
          if (barcode && one) {
            try { await upsertBarcodes([{ article_id: one.id, barcode }]); } catch { /* non bloquant */ }
          }
        }
      }
      tick(chunk.length);
      continue;
    }
    created += chunk.length;
    // Codes-barres du lot (id retrouvé par référence)
    const idByRef = new Map((data ?? []).map((a) => [a.reference, a.id]));
    const bars: { article_id: string; barcode: string }[] = [];
    for (const d of chunk) {
      const { barcode } = cleanPatch(d.patch);
      const id = idByRef.get(d.reference);
      if (barcode && id) bars.push({ article_id: id, barcode });
    }
    if (bars.length) {
      try { await upsertBarcodes(bars); } catch { /* non bloquant */ }
    }
    tick(chunk.length);
  }

  // ── Mises à jour (pool concurrent) ──────────────────────────────────────────
  const barsUpd: { article_id: string; barcode: string }[] = [];
  await pool(updates, CONCURRENCY, async (d) => {
    try {
      const { fields, barcode } = cleanPatch(d.patch);
      if (Object.keys(fields).length > 0) await updateArticle(d.existingId!, fields as ArticleUpdate);
      if (barcode) barsUpd.push({ article_id: d.existingId!, barcode });
      updated++;
    } catch (e) {
      errors.push({ rowIndex: d.rowIndex, reference: d.reference, message: e instanceof Error ? e.message : String(e) });
    } finally {
      tick(1);
    }
  });
  if (barsUpd.length) {
    try { await upsertBarcodes(barsUpd); } catch { /* non bloquant */ }
  }

  return { created, updated, errors };
}
