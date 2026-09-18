/**
 * M1 — Actions groupées sur la liste des contacts.
 *
 * Portée volontairement limitée aux écritures réversibles ou auditées : archivage,
 * statut, drapeaux, liaison, fusion. Pas de suppression physique ici — elle reste sur
 * la fiche, où `contact_dependencies` peut présenter le détail avant de décider
 * (règle 4 : l'audit prime, on archive plutôt qu'on efface).
 */
import { supabase } from '@/integrations/supabase/client';

import {
  mergeContacts, mergeErrorMessage,
  type ContactStatus, type ContactUpdate, type MergeContactsResult,
} from './api';
import { LINK_LIMIT, linkContact } from './subobjects-api';

/** Drapeaux modifiables en masse. Tous facultatifs : on n'écrit que ce qui est fourni. */
export type ContactFlags = {
  is_vip?: boolean;
  is_blocked?: boolean;
  is_watch?: boolean;
  marketing_opt_out?: boolean;
};

/**
 * Archive ou réactive les fiches. Un seul UPDATE ensembliste : le trigger d'audit
 * (`audit_row`) journalise quand même chaque ligne, la traçabilité est préservée.
 */
export async function bulkSetActive(ids: string[], active: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const { error } = await supabase.from('contacts').update({ is_active: active }).in('id', ids);
  if (error) throw error;
  return ids.length;
}

export async function bulkSetStatus(ids: string[], status: ContactStatus): Promise<number> {
  if (ids.length === 0) return 0;
  const { error } = await supabase.from('contacts').update({ status }).in('id', ids);
  if (error) throw error;
  return ids.length;
}

export async function bulkSetFlags(ids: string[], flags: ContactFlags): Promise<number> {
  if (ids.length === 0) return 0;
  // Recopie champ par champ plutôt qu'un Object.fromEntries : celui-ci produit un
  // Record<string, boolean> que le typage strict de la table refuse.
  const patch: ContactUpdate = {};
  if (flags.is_vip !== undefined) patch.is_vip = flags.is_vip;
  if (flags.is_blocked !== undefined) patch.is_blocked = flags.is_blocked;
  if (flags.is_watch !== undefined) patch.is_watch = flags.is_watch;
  if (flags.marketing_opt_out !== undefined) patch.marketing_opt_out = flags.marketing_opt_out;
  if (Object.keys(patch).length === 0) return 0;
  const { error } = await supabase.from('contacts').update(patch).in('id', ids);
  if (error) throw error;
  return ids.length;
}

/* ---------------------------------- Liaison ---------------------------------- */

export type BulkLinkResult = {
  /** Fiches effectivement rattachées au principal. */
  linked: string[];
  /** Déjà liées au principal : rien à faire. */
  already: string[];
  /** Refusées car elles ont déjà atteint LINK_LIMIT de leur côté. */
  full: string[];
  /** Le principal a atteint LINK_LIMIT : les suivantes n'ont pas été traitées. */
  mainFull: boolean;
};

/** Clé de paire non ordonnée : (A,B) et (B,A) désignent le même lien. */
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Rattache `otherIds` à la fiche principale `mainId`.
 *
 * La limite de LINK_LIMIT liens par fiche est une règle métier portée par l'UI de la
 * fiche ; on la fait respecter ici aussi, sinon l'action groupée la contournerait en
 * silence. On compte les liens existants des deux côtés avant d'écrire, et on rend
 * compte précisément de ce qui a été refusé — l'appelant l'affiche, rien n'est muet.
 */
export async function bulkLink(
  companyId: string,
  mainId: string,
  otherIds: string[],
): Promise<BulkLinkResult> {
  const targets = otherIds.filter((id) => id !== mainId);
  const result: BulkLinkResult = { linked: [], already: [], full: [], mainFull: false };
  if (targets.length === 0) return result;

  const involved = [mainId, ...targets].join(',');
  const { data, error } = await supabase
    .from('contact_links')
    .select('contact_a, contact_b')
    .or(`contact_a.in.(${involved}),contact_b.in.(${involved})`);
  if (error) throw error;

  const count = new Map<string, number>();
  const existing = new Set<string>();
  for (const l of data ?? []) {
    count.set(l.contact_a, (count.get(l.contact_a) ?? 0) + 1);
    count.set(l.contact_b, (count.get(l.contact_b) ?? 0) + 1);
    existing.add(pairKey(l.contact_a, l.contact_b));
  }
  const linksOf = (id: string) => count.get(id) ?? 0;

  for (const id of targets) {
    if (existing.has(pairKey(mainId, id))) { result.already.push(id); continue; }
    if (linksOf(mainId) >= LINK_LIMIT) { result.mainFull = true; break; }
    if (linksOf(id) >= LINK_LIMIT) { result.full.push(id); continue; }

    await linkContact(companyId, mainId, id);
    count.set(mainId, linksOf(mainId) + 1);
    count.set(id, linksOf(id) + 1);
    existing.add(pairKey(mainId, id));
    result.linked.push(id);
  }
  return result;
}

/* ---------------------------------- Fusion ----------------------------------- */

export type BulkMergeResult = {
  merged: MergeContactsResult[];
  /** Fiches refusées ; `error` est déjà traduit (codes MERGE_* de la base). */
  failed: { id: string; error: string }[];
};

/**
 * Fusionne chaque fiche de `mergeIds` dans `keepId`, séquentiellement.
 *
 * Chaque fusion est une transaction SQL (`contact_merge`) : réussie en entier ou
 * annulée en entier. Séquentiel à dessein : les fusions verrouillent la fiche gardée,
 * et l'ordre rend le rapport lisible. Une fiche refusée n'interrompt pas les suivantes.
 */
export async function bulkMerge(keepId: string, mergeIds: string[]): Promise<BulkMergeResult> {
  const result: BulkMergeResult = { merged: [], failed: [] };

  for (const id of mergeIds.filter((x) => x !== keepId)) {
    try {
      result.merged.push(await mergeContacts(keepId, id));
    } catch (e) {
      result.failed.push({ id, error: mergeErrorMessage(e) });
    }
  }
  return result;
}
