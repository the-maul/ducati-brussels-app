/**
 * M0 — Paramètres → « Mise en production » (19/11/2026) : accès Supabase.
 *   1. fonction Edge `production-status` : relève si chaque secret du serveur est posé (oui / non,
 *      jamais sa valeur) et le note en base ;
 *   2. `production_overview` : la liste complète, l'état, ce qui manque, les tâches pg_cron ;
 *   3. `production_apply` : démarrer / passer en test / mettre en pause une sélection (tout ou rien,
 *      tracé dans events) ; `automation_settings_set` : boîte d'envoi et adresse de test des mails
 *      automatiques.
 * Fonctions hors types.ts (migration 20261119220000) : client non typé, comme minimax-api.
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeProductionMode, type ProductionAction, type ProductionOverview } from './production-rules';

const sb = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const productionKey = (companyId: string | null | undefined) => ['production-overview', companyId] as const;

/** Relève la présence des secrets (best-effort : fonction pas encore déployée = état « non vérifié »). */
export async function refreshIntegrations(companyId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('production-status', { body: { companyId } });
    return !error && !!(data as { ok?: boolean } | null)?.ok;
  } catch {
    return false;
  }
}

export async function getProductionOverview(companyId: string): Promise<ProductionOverview & { statusChecked: boolean }> {
  const statusChecked = await refreshIntegrations(companyId);
  const raw = await rpc<ProductionOverview>('production_overview', { _company: companyId });
  return {
    ...raw,
    statusChecked,
    items: (raw.items ?? []).map((i) => ({ ...i, mode: normalizeProductionMode(i.mode), missing: i.missing ?? [], missing_test: i.missing_test ?? [] })),
    crons: raw.crons ?? [],
    mailboxes: raw.mailboxes ?? [],
  };
}

export type AppliedChange = { key: string; old: string | null; new: string | null };

export async function applyProduction(companyId: string, keys: string[], action: ProductionAction): Promise<AppliedChange[]> {
  return (await rpc<AppliedChange[]>('production_apply', { _company: companyId, _keys: keys, _action: action })) ?? [];
}

export async function setAutomationSettings(companyId: string, senderMailbox: string | null, testRecipient: string | null): Promise<void> {
  await rpc('automation_settings_set', { _company: companyId, _sender_mailbox: senderMailbox, _mail_test_recipient: testRecipient });
}
