/**
 * M10 — RELANCES : acces aux donnees (migration 20261031120000). Les regles sont dans
 * `followups-rules.ts` ; l'envoi reel passe par la fonction Edge `followups-send` (Outlook).
 */
import { supabase } from '@/integrations/supabase/client';
import { clientAppUrl } from '@/lib/client-app-url';
import type { FollowupKind, FollowupLocale, FollowupStatus, TemplateKind } from './followups-rules';

export type Followup = {
  id: string;
  kind: FollowupKind;
  status: FollowupStatus;
  label: string | null;
  due_date: string | null;
  send_at: string;
  sent_at: string | null;
  answered_at: string | null;
  answered_how: 'rdv' | 'mail' | 'lien' | 'manuel' | null;
  closed_at: string | null;
  channel: string;
  to_email: string | null;
  locale: FollowupLocale;
  contact_id: string | null;
  contact_name: string | null;
  vehicle_id: string | null;
  vehicle_label: string | null;
  source_id: string | null;
  crm_card_id: string | null;
  crm_task_id: string | null;
  last_error: string | null;
  token: string;
  created_at: string;
};

export type FollowupTemplate = {
  id?: string;
  company_id: string;
  kind: TemplateKind;
  locale: FollowupLocale;
  subject: string;
  body: string;
  updated_at?: string;
};

export type RenderedFollowup = { subject: string; body: string; to_email: string | null; locale: string; link: string; template_key: string | null };
export type PlanResult = { planned: number; updated: number; cancelled: number };

/**
 * Fonctions SQL pas encore dans `types.ts` genere. `.bind(supabase)` est OBLIGATOIRE
 * (incident du 19/09, test `tests/rpc-bound.test.ts`).
 */
const rpcUntyped = supabase.rpc.bind(supabase) as unknown as (
  fn: string, args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
/** Idem pour une table absente du typage genere. */
const fromUntyped = supabase.from.bind(supabase) as unknown as (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function listFollowups(companyId: string): Promise<Followup[]> {
  const { data, error } = await rpcUntyped('followups_list', { _company: companyId });
  if (error) throw error;
  return (data as Followup[]) ?? [];
}

/** « Planifier maintenant » : construit / actualise les relances de la societe. */
export async function planFollowups(companyId: string): Promise<PlanResult> {
  const { data, error } = await rpcUntyped('followups_plan', { _company: companyId });
  if (error) throw error;
  const row = (data as PlanResult[] | null)?.[0];
  return row ?? { planned: 0, updated: 0, cancelled: 0 };
}

export type FollowupAction = 'postpone' | 'cancel' | 'answered' | 'close';
export async function setFollowup(id: string, action: FollowupAction, date?: string): Promise<FollowupStatus> {
  const { data, error } = await rpcUntyped('followup_set', { _id: id, _action: action, _date: date ?? null });
  if (error) throw error;
  return data as FollowupStatus;
}

/** Objet et corps du mail tels qu'ils partiront (langue du client, variables remplies). */
export async function renderFollowup(id: string): Promise<RenderedFollowup> {
  const { data, error } = await rpcUntyped('followup_render', { _id: id, _origin: clientAppUrl() || null });
  if (error) throw error;
  const row = (data as RenderedFollowup[] | null)?.[0];
  if (!row) throw new Error('followup_render: empty result');
  return row;
}

export async function listFollowupTemplates(companyId: string): Promise<FollowupTemplate[]> {
  const { data, error } = await fromUntyped('followup_templates')
    .select('id, company_id, kind, locale, subject, body, updated_at')
    .eq('company_id', companyId);
  if (error) throw error;
  return (data as FollowupTemplate[]) ?? [];
}

export async function saveFollowupTemplate(t: FollowupTemplate): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await fromUntyped('followup_templates').upsert(
    { company_id: t.company_id, kind: t.kind, locale: t.locale, subject: t.subject, body: t.body, updated_by: user?.id ?? null },
    { onConflict: 'company_id,kind,locale' },
  );
  if (error) throw error;
}

export type SendNowResult = { ok?: boolean; error?: string; sent?: number; failed?: number; errors?: { id: string; error: string }[]; dryRun?: boolean; html?: string; subject?: string; to?: string; from?: string };
/**
 * Envoi immediat (ou apercu complet avec signature si `dryRun`) par la fonction Edge
 * `followups-send`. Erreurs connues : graph_not_configured (cles Microsoft Graph absentes),
 * not_due_or_not_planned (la relance n'est plus planifiee).
 */
export async function sendFollowupNow(companyId: string, followupId: string, dryRun = false): Promise<SendNowResult> {
  const { data, error } = await supabase.functions.invoke('followups-send', { body: { companyId, followupId, dryRun } });
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context;
    return { error: (ctx?.body as { error?: string })?.error ?? error.message };
  }
  return data as SendNowResult;
}
