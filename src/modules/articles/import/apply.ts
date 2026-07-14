/**
 * M2 — Application d'un import de tarifs : crée/maj les articles d'après le diff.
 * Optimisé gros fichiers (tarifs Ducati : 81k+ lignes) :
 *  - créations insérées PAR LOTS (400/lot, repli ligne à ligne si erreur de lot),
 *  - remplacements (colonne « Remplacement ») résolus en masse : stubs librairie
 *    créés par lots pour les nouvelles réfs absentes, puis superseded_by_id fusionné
 *    dans les mises à jour (aucune requête supplémentaire par ligne),
 *  - mises à jour en pool de 8 requêtes concurrentes,
 *  - codes-barres upsertés par lots.
 */
import { supabase } from '@/integrations/supabase/client';
import { updateArticle, type ArticleInsert, type ArticleUpdate } from '../api';
import type { DiffResult } from './rules';

export type ApplyResult = {
  created: number;
  updated: number;
  /** fiches marquées « remplacée par » (superseded_by_id posé depuis la colonne Remplacement) */
  replaced: number;
  errors: { rowIndex: number; reference: string; message: string }[];
};

export type ApplyProgress = (done: number, total: number) => void;

const CHUNK = 400;
const CONCURRENCY = 8;

/** Retire les clés internes du patch (préfixées `_`) et les colonnes hors table. */
function cleanPatch(patch: Record<string, unknown>): { fields: Record<string, unknown>; barcode?: string; replaceWithRef?: string } {
  const fields: Record<string, unknown> = {};
  let barcode: string | undefined;
  let replaceWithRef: string | undefined;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'barcode' || k === '_barcode') { if (typeof v === 'string') barcode = v; continue; }
    if (k === '_replace_with_ref') { if (typeof v === 'string' && v.trim()) replaceWithRef = v.trim(); continue; }
    if (k.startsWith('_')) continue; // _suggest_equivalence, etc.
    fields[k] = v;
  }
  return { fields, barcode, replaceWithRef };
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
  /** réf → id des articles EXISTANTS (du référentiel chargé à l'analyse) — pour résoudre les remplacements */
  existingIdByRef?: Map<string, string>,
): Promise<ApplyResult> {
  let created = 0;
  let updated = 0;
  let replaced = 0;
  const errors: ApplyResult['errors'] = [];
  // réf → id consolidé (existant + créations de CET import) pour résoudre les remplacements
  const refToId = new Map(existingIdByRef ?? []);

  const creates = diff.filter((d) => d.action === 'create');
  const updates = diff.filter((d) => d.action === 'update' && d.existingId);
  const total = creates.length + updates.length;
  let done = 0;
  const tick = (n: number) => { done += n; onProgress?.(done, total); };

  // ── 1. Créations par lots ───────────────────────────────────────────────────
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
          if (one) refToId.set(d.reference, one.id);
          if (barcode && one) {
            try { await upsertBarcodes([{ article_id: one.id, barcode }]); } catch { /* non bloquant */ }
          }
        }
      }
      tick(chunk.length);
      continue;
    }
    created += chunk.length;
    const idByRef = new Map((data ?? []).map((a) => [a.reference, a.id]));
    for (const [ref, id] of idByRef) refToId.set(ref, id);
    // Codes-barres du lot
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

  // ── 2. Stubs librairie pour les réfs de remplacement inconnues ─────────────
  // (nouvelle réf absente du référentiel ET du fichier — chaîne vers un tarif ultérieur)
  const missingTargets = new Set<string>();
  for (const d of diff) {
    const { replaceWithRef } = cleanPatch(d.patch);
    if (replaceWithRef && !refToId.has(replaceWithRef)) missingTargets.add(replaceWithRef);
  }
  const missing = [...missingTargets];
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const rows = chunk.map((ref) => ({
      company_id: companyId, mgmt_type: 'A', reference: ref, designation: ref, is_library: true,
    } as ArticleInsert));
    const { data, error } = await supabase.from('articles').insert(rows).select('id, reference');
    if (error) {
      errors.push({ rowIndex: 0, reference: chunk[0], message: `Stubs remplacement : ${error.message}` });
      continue;
    }
    for (const a of data ?? []) refToId.set(a.reference, a.id);
    created += chunk.length;
  }

  /** Résout l'id cible d'un remplacement (≠ id source, sinon null). */
  const resolveTarget = (replaceWithRef: string | undefined, sourceId: string | null): string | null => {
    if (!replaceWithRef) return null;
    const t = refToId.get(replaceWithRef);
    return t && t !== sourceId ? t : null;
  };

  // ── 3. Mises à jour (pool concurrent) — superseded_by_id fusionné dedans ───
  const barsUpd: { article_id: string; barcode: string }[] = [];
  await pool(updates, CONCURRENCY, async (d) => {
    try {
      const { fields, barcode, replaceWithRef } = cleanPatch(d.patch);
      const target = resolveTarget(replaceWithRef, d.existingId);
      if (target) { fields.superseded_by_id = target; }
      if (Object.keys(fields).length > 0) await updateArticle(d.existingId!, fields as ArticleUpdate);
      if (barcode) barsUpd.push({ article_id: d.existingId!, barcode });
      if (target) replaced++;
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

  // ── 4. Remplacements sur les articles CRÉÉS par cet import ─────────────────
  const createdRepls = creates
    .map((d) => {
      const { replaceWithRef } = cleanPatch(d.patch);
      const sourceId = refToId.get(d.reference) ?? null;
      const target = resolveTarget(replaceWithRef, sourceId);
      return sourceId && target ? { d, sourceId, target } : null;
    })
    .filter((x): x is { d: DiffResult; sourceId: string; target: string } => x != null);
  await pool(createdRepls, CONCURRENCY, async ({ d, sourceId, target }) => {
    const { error } = await supabase.from('articles').update({ superseded_by_id: target }).eq('id', sourceId);
    if (error) errors.push({ rowIndex: d.rowIndex, reference: d.reference, message: `Remplacement : ${error.message}` });
    else replaced++;
  });

  return { created, updated, replaced, errors };
}
