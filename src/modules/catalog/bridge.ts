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
 */
import type { Json } from '@/integrations/supabase/types';
import {
  catalogImportState, catalogBatchStart, catalogBatchProgress, catalogIngestTree,
  catalogIngestModelYear, catalogIngestDrawings,
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

/** Fonctions accessibles à l'extension (liste fermée). */
export const CATALOG_CALLS: Record<string, Handler> = {
  hello: async (_a, ctx) => ({
    companyId: ctx.companyId, companyName: ctx.companyName, canImport: !!ctx.companyId && ctx.isAdmin,
    state: ctx.companyId ? await catalogImportState() : null,
  }),
  start: async (a, ctx) => ({ batchId: await catalogBatchStart(requireAdmin(ctx), j(a.scope), Number(a.total) || 0) }),
  progress: async (a, ctx) => {
    requireAdmin(ctx);
    await catalogBatchProgress(s(a.batchId), s(a.status), (a.position ?? null) as Json | null, (a.counters ?? null) as Json | null, a.error ? s(a.error) : null);
    return { ok: true };
  },
  tree: async (a, ctx) => { requireAdmin(ctx); return catalogIngestTree(s(a.batchId), j(a.tree)); },
  modelYear: async (a, ctx) => { requireAdmin(ctx); return catalogIngestModelYear(s(a.batchId), s(a.modelYearId), j(a.groups)); },
  drawings: async (a, ctx) => {
    requireAdmin(ctx);
    return catalogIngestDrawings(s(a.batchId), s(a.modelYearId), j(a.drawings), a.complete === true);
  },
};

/** Vrai si le message vient de l'extension (même fenêtre, même origine) et vise le catalogue. */
export function isCatalogCall(ev: Pick<MessageEvent, 'data' | 'origin' | 'source'>, win: { location: { origin: string } } & object): boolean {
  const d = ev.data as Partial<CatalogCallMessage> | null;
  return !!d && d.source === 'dms-ducati-ext' && d.action === 'catalog-call' && typeof d.id === 'string'
    && typeof d.fn === 'string' && ev.source === win && ev.origin === win.location.origin;
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
