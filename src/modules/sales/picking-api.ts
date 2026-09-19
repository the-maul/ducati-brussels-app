/**
 * M6 — Listes de préparation (picking) : accès base.
 * Une seule notion : la liste de préparation d'un document (mission 05 carte 6, mission 02 carte
 * « picking list »). Toutes les écritures passent par les fonctions SQL picking_* (règles + trace
 * dans events) ; l'application n'écrit plus directement dans picking_lists / picking_list_items.
 * Règles pures : preparation.ts. Aucun mouvement de stock ici.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { PrepStep, PickingDetailLine } from './preparation';

/* Vue tablette et gestion des listes — règles pures dans preparation.ts. */
export * from './preparation';

/** Une liste dans la page « Listes de préparation » (fonction SQL picking_overview). */
export type PickingOverviewRow = Database['public']['Functions']['picking_overview']['Returns'][number];

/** Toutes les listes de la société : document, client, moto, vendeur, avancement, statut. */
export async function listPickingOverview(companyId: string): Promise<PickingOverviewRow[]> {
  const { data, error } = await supabase.rpc('picking_overview', { _company: companyId });
  if (error) throw error;
  return data ?? [];
}

/** En-tête d'une liste (même contenu qu'une ligne de la page des listes). */
export async function getPickingHeader(pickingId: string): Promise<PickingOverviewRow> {
  const { data: p, error } = await supabase.from('picking_lists').select('company_id').eq('id', pickingId).single();
  if (error) throw error;
  const { data, error: e2 } = await supabase.rpc('picking_overview', { _company: p.company_id, _picking: pickingId });
  if (e2) throw e2;
  const row = data?.[0];
  if (!row) throw new Error('not found');
  return row;
}

/**
 * Crée ou rouvre la liste de préparation d'un document (bouton « Préparer ») : une seule liste
 * par document ; lignes article seulement (moto + options). Une liste annulée ou terminée est
 * rendue telle quelle (l'écran propose « Rouvrir »).
 */
export async function openPickingForDocument(documentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('picking_open_for_document', { _document: documentId });
  if (error) throw error;
  return data as string;
}

export type PickingLine = PickingDetailLine & { removed: boolean };

export async function getPickingDetail(pickingId: string): Promise<PickingLine[]> {
  const [{ data, error }, { data: flags, error: fErr }] = await Promise.all([
    supabase.rpc('picking_detail', { _picking: pickingId }),
    supabase.from('picking_list_items').select('id, removed_at').eq('picking_id', pickingId),
  ]);
  if (error) throw error;
  if (fErr) throw fErr;
  const removed = new Set((flags ?? []).filter((f) => f.removed_at).map((f) => f.id));
  return ((data ?? []) as unknown as PickingDetailLine[]).map((r) => ({
    ...r,
    bins: r.bins ?? [],
    qty_ordered: Number(r.qty_ordered), qty_picked: Number(r.qty_picked),
    real_qty: r.real_qty == null ? null : Number(r.real_qty),
    reserved_qty: r.reserved_qty == null ? null : Number(r.reserved_qty),
    on_order_qty: r.on_order_qty == null ? null : Number(r.on_order_qty),
    removed: removed.has(r.id),
  }));
}

/** Pose (ou retire avec null) l'étape d'une ligne. Qui / quand : écrits par le serveur. */
export async function setPickingStep(itemId: string, step: PrepStep | null): Promise<void> {
  // Argument SQL facultatif : null = retour à l'état calculé (types générés : string).
  const { error } = await supabase.rpc('picking_set_step', { _item: itemId, _step: step as string });
  if (error) throw error;
}

/** Emplacement de préparation du client (texte libre ou casier), tracé dans events. */
export async function setPickingLocation(id: string, location: string | null): Promise<void> {
  const { error } = await supabase.rpc('picking_set_location', { _picking: id, _location: location ?? '' });
  if (error) throw error;
}

/**
 * Annuler / supprimer : le serveur supprime si rien n'a été préparé ni monté, sinon annule avec
 * le motif (obligatoire dans ce cas). Retourne ce qui a été fait.
 */
export async function cancelPicking(id: string, reason: string): Promise<'deleted' | 'cancelled'> {
  const { data, error } = await supabase.rpc('picking_cancel', { _picking: id, _reason: reason });
  if (error) throw error;
  return data as 'deleted' | 'cancelled';
}

/** Rouvrir une liste annulée ou terminée (les étapes saisies sont gardées). */
export async function reopenPicking(id: string): Promise<void> {
  const { error } = await supabase.rpc('picking_reopen', { _picking: id });
  if (error) throw error;
}

/** Terminer : toutes les lignes préparées ou montées → liste terminée (prête à livrer). */
export async function finishPicking(id: string): Promise<void> {
  const { error } = await supabase.rpc('picking_finish', { _picking: id });
  if (error) throw error;
}

export type RegenerateResult = {
  added: number; removed: number; restored: number; qty_changed: number;
  removed_lines: { reference: string | null; designation: string | null; prep_step: string | null }[];
};

/** Régénérer depuis le document : ajoute, signale les retirées, garde les états saisis. */
export async function regeneratePicking(id: string): Promise<RegenerateResult> {
  const { data, error } = await supabase.rpc('picking_regenerate', { _picking: id });
  if (error) throw error;
  return data as unknown as RegenerateResult;
}
