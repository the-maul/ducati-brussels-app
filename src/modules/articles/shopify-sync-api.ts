/**
 * Mission 03 — Le DMS écrit sur Shopify (W-8) : synchronisation stock + prix (mode Arrêtée / Essai / Tous,
 * articles d'essai, file, journal) et publication d'un article depuis sa fiche.
 * Les écritures sur Shopify sont faites par les fonctions serveur shopify-push et shopify-publish.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type SyncMode = 'arrete' | 'essai' | 'tous';
export type SyncLogRow = Database['public']['Tables']['shopify_sync_log']['Row'];

export type TrialArticle = {
  article_id: string; reference: string; designation: string | null; publishable: boolean; linked: boolean; added_at: string;
};

export type SyncStatus = {
  mode: SyncMode;
  mode_updated_at: string | null;
  queue_pending: number;
  queue_errors: number;
  linked: number;
  last_ok_at: string | null;
  trial: TrialArticle[];
};

const rpc = supabase.rpc.bind(supabase);

export async function getSyncStatus(companyId: string): Promise<SyncStatus> {
  const { data, error } = await rpc('shopify_sync_status', { _company: companyId });
  if (error) throw error;
  return data as unknown as SyncStatus;
}

/** Change le mode ; renvoie le nombre d'articles mis en file pour un premier envoi. */
export async function setSyncMode(companyId: string, mode: SyncMode): Promise<number> {
  const { data, error } = await rpc('shopify_sync_set_mode', { _company: companyId, _mode: mode });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function addTrialArticle(companyId: string, articleId: string): Promise<void> {
  const { error } = await rpc('shopify_sync_trial_add', { _company: companyId, _article: articleId });
  if (error) throw error;
}

export async function removeTrialArticle(companyId: string, articleId: string): Promise<void> {
  const { error } = await rpc('shopify_sync_trial_remove', { _company: companyId, _article: articleId });
  if (error) throw error;
}

/** « Tout resynchroniser » : remet en file tous les articles reliés ; le mode décide de ce qui part. */
export async function resyncAll(companyId: string): Promise<number> {
  const { data, error } = await rpc('shopify_sync_resync_all', { _company: companyId });
  if (error) throw error;
  return Number(data ?? 0);
}

export type PushReport = { ok: boolean; companies?: { claimed: number; ok: number; up_to_date: number; errors: number; error?: string }[] | number; message?: string; error?: string };

/** Traite la file maintenant (sinon la tâche planifiée passe toutes les 3 minutes). */
export async function processQueueNow(companyId: string): Promise<PushReport> {
  const { data, error } = await supabase.functions.invoke('shopify-push', { body: { company_id: companyId } });
  if (error) throw error;
  return data as PushReport;
}

export type SimulatedLine = {
  article_id: string; reference: string; status: 'a_envoyer' | 'deja_a_jour' | 'erreur';
  price_before: number | null; price_sent: number | null; qty_before: number | null; qty_sent: number | null; detail: string | null;
};

/** Simulation : lit Shopify et montre ce qui SERAIT envoyé pour ces articles. N'écrit rien. */
export async function simulatePush(companyId: string, articleIds: string[]): Promise<SimulatedLine[]> {
  const { data, error } = await supabase.functions.invoke('shopify-push', {
    body: { company_id: companyId, simulate: true, article_ids: articleIds.slice(0, 50) },
  });
  if (error) throw error;
  const r = data as { ok: boolean; results?: SimulatedLine[]; error?: string };
  if (!r?.ok) throw new Error(r?.error ?? 'simulation_failed');
  return r.results ?? [];
}

export async function listSyncLog(companyId: string, opts: { articleId?: string; errorsOnly?: boolean; limit?: number } = {}): Promise<SyncLogRow[]> {
  let q = supabase.from('shopify_sync_log').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(opts.limit ?? 100);
  if (opts.articleId) q = q.eq('article_id', opts.articleId);
  if (opts.errorsOnly) q = q.eq('status', 'erreur');
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ─── Fiche article : publier / retirer / mettre à jour ────────────────────────────────

export type ArticleSiteStatus = {
  mode: SyncMode;
  in_trial: boolean;
  queued: boolean;
  link: {
    variant_id: string; product_id: string | null; product_status: string | null; handle: string | null;
    price: number | null; inventory_quantity: number | null; link_status: string;
  } | null;
  log: { kind: string; status: string; price_sent: number | null; qty_sent: number | null; detail: string | null; created_at: string }[];
};

export async function getArticleSiteStatus(companyId: string, articleId: string): Promise<ArticleSiteStatus | null> {
  const { data, error } = await rpc('shopify_article_site_status', { _company: companyId, _article: articleId });
  if (error) throw error;
  return (data as unknown as ArticleSiteStatus) ?? null;
}

export type PublishAction = 'publish' | 'unpublish' | 'update';
export type PublishResult = { ok: boolean; error?: string; detail?: string; product_title?: string | null; photos?: number; photos_added?: number; status?: string };

export async function runPublishAction(companyId: string, articleId: string, action: PublishAction): Promise<PublishResult> {
  const { data, error } = await supabase.functions.invoke('shopify-publish', {
    body: { company_id: companyId, article_id: articleId, action },
  });
  // Les refus métier (409) arrivent comme erreur HTTP : on relit le corps pour afficher la raison.
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    if (body && typeof body === 'object') return body as PublishResult;
    throw error;
  }
  return data as PublishResult;
}
