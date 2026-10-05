/**
 * Pont extension ↔ DMS pour l'import du catalogue Ducati (même principe que My Ducati).
 *
 * L'extension lit l'e-catalog avec la session Ducati de l'utilisateur, puis passe par l'onglet
 * du DMS (content script dms-bridge.js → window.postMessage) :
 *   extension → DMS : { source: 'dms-ducati-ext', action: 'catalog-call', id, fn, args }
 *   DMS → extension : { source: 'dms-ducati', action: 'catalog-reply', id, ok, data?, error?, code? }
 * Le DMS enregistre sous la session DMS de l'utilisateur (fonctions SQL réservées aux
 * administrateurs). Aucun identifiant Ducati ne transite : seulement des données de catalogue.
 * Seules les fonctions de la liste CATALOG_CALLS sont acceptées.
 *
 * Mise à jour ciblée (carte 6) : quand une mise à jour a été armée dans le DMS
 * (« Mettre à jour »), `hello` la remet à l'extension (dans `state.update`) et `modelYear`
 * applique tout seul sa date de relecture — l'extension n'a rien à décider, et le DMS n'appelle
 * jamais Ducati. Le plan est marqué pris en charge au premier lot démarré.
 */
import type { Json } from '@/integrations/supabase/types';
import {
  catalogImportState, catalogBatchStart, catalogBatchProgress, catalogIngestTree,
  catalogIngestModelYear, catalogIngestDrawings, catalogUpdatePending, catalogUpdateConsume,
} from './api';

export type CatalogCallMessage = { source: 'dms-ducati-ext'; action: 'catalog-call'; id: string; fn: string; args?: Record<string, unknown> };
export type CatalogReply = { source: 'dms-ducati'; action: 'catalog-reply'; id: string; ok: boolean; data?: unknown; error?: string; code?: string };

export type CatalogContext = { companyId: string | null; companyName: string | null; isAdmin: boolean };

type Handler = (args: Record<string, unknown>, ctx: CatalogContext) => Promise<unknown>;

const s = (v: unknown): string => (v == null ? '' : String(v));
const j = (v: unknown): Json => (v ?? null) as Json;

function requireAdmin(ctx: CatalogContext): string {
  if (!ctx.companyId) throw Object.assign(new Error('Aucune société active dans le DMS.'), { code: 'no-company' });
  if (!ctx.isAdmin) throw Object.assign(new Error('Import réservé aux administrateurs du DMS.'), { code: 'forbidden' });
  return ctx.companyId;
}

/**
 * Date de relecture du plan armé (ou en cours de passage), sinon null : sans plan, on garde le
 * comportement d'origine — seules les planches dont les pièces manquent sont redemandées.
 */
async function pendingRefreshBefore(): Promise<string | null> {
  try {
    const p = await catalogUpdatePending();
    return p?.plan?.refreshBefore ? String(p.plan.refreshBefore) : null;
  } catch {
    return null;
  }
}

/** Fonctions accessibles à l'extension (liste fermée). */
export const CATALOG_CALLS: Record<string, Handler> = {
  hello: async (_a, ctx) => ({
    companyId: ctx.companyId, companyName: ctx.companyName, canImport: !!ctx.companyId && ctx.isAdmin,
    state: ctx.companyId ? await catalogImportState() : null,
  }),
  start: async (a, ctx) => {
    const batchId = await catalogBatchStart(requireAdmin(ctx), j(a.scope), Number(a.total) || 0);
    // Une mise à jour armée est rattachée à ce lot : l'écran saura d'où vient le passage.
    const pending = await catalogUpdatePending().catch(() => null);
    if (pending) await catalogUpdateConsume(pending.id, batchId).catch(() => undefined);
    return { batchId, update: pending?.plan ?? null };
  },
  progress: async (a, ctx) => {
    requireAdmin(ctx);
    await catalogBatchProgress(s(a.batchId), s(a.status), (a.position ?? null) as Json | null, (a.counters ?? null) as Json | null, a.error ? s(a.error) : null);
    return { ok: true };
  },
  tree: async (a, ctx) => { requireAdmin(ctx); return catalogIngestTree(s(a.batchId), j(a.tree)); },
  modelYear: async (a, ctx) => {
    requireAdmin(ctx);
    // La date de relecture vient du plan armé dans le DMS, pas de l'extension.
    const refresh = a.refreshBefore ? s(a.refreshBefore) : await pendingRefreshBefore();
    return catalogIngestModelYear(s(a.batchId), s(a.modelYearId), j(a.groups), refresh);
  },
  drawings: async (a, ctx) => {
    requireAdmin(ctx);
    return catalogIngestDrawings(s(a.batchId), s(a.modelYearId), j(a.drawings), a.complete === true);
  },
};

/**
 * Vrai si le message vient de l'extension (même origine que le DMS) et vise le catalogue.
 * (ev.source n'est pas comparé : un content script poste depuis un « monde isolé ».)
 */
export function isCatalogCall(ev: Pick<MessageEvent, 'data' | 'origin'>, win: { location: { origin: string } }): boolean {
  const d = ev.data as Partial<CatalogCallMessage> | null;
  return !!d && d.source === 'dms-ducati-ext' && d.action === 'catalog-call' && typeof d.id === 'string'
    && typeof d.fn === 'string' && ev.origin === win.location.origin;
}

/** Exécute un appel de l'extension et renvoie la réponse à poster. */
export async function handleCatalogCall(msg: CatalogCallMessage, ctx: CatalogContext): Promise<CatalogReply> {
  const base = { source: 'dms-ducati' as const, action: 'catalog-reply' as const, id: msg.id };
  const h = Object.prototype.hasOwnProperty.call(CATALOG_CALLS, msg.fn) ? CATALOG_CALLS[msg.fn] : undefined;
  if (!h) return { ...base, ok: false, error: `Fonction inconnue : ${msg.fn}`, code: 'unknown' };
  try {
    const data = await h(msg.args ?? {}, ctx);
    return { ...base, ok: true, data };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return { ...base, ok: false, error: err?.message || 'Erreur du DMS', code: err?.code || 'error' };
  }
}
