/**
 * M10 — RELANCES : acces aux donnees (migration 20261031120000). Les regles sont dans
 * `followups-rules.ts` ; l'envoi reel passe par la fonction Edge `followups-send` (Outlook).
 */
import { supabase } from '@/integrations/supabase/client';
import { clientAppUrl } from '@/lib/client-app-url';
import {
  normalizeFollowupMode, normalizeFollowupSources,
  type FollowupKind, type FollowupLocale, type FollowupMode, type FollowupSource, type FollowupStatus, type TemplateKind,
} from './followups-rules';

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
  /** CRM011 : parti a l'adresse de test (mode test), pas chez le client. */
  is_test: boolean;
  /** CRM011 : adresse qui a recu le mail (client, ou adresse de test). */
  sent_to: string | null;
  /** CRM012 : source de l'echeance d'entretien a la planification (null : intervention reportee, manuelle). */
  source: FollowupSource | null;
};

/**
 * CRM011 : l'interrupteur des relances de la societe (pas de ligne en base = arrete).
 * CRM012 : les sources d'echeance retenues (pas de ligne = defaut, sans « plan »).
 */
export type FollowupSettings = { mode: FollowupMode; testRecipient: string | null; sources: FollowupSource[]; updatedAt: string | null };

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
/** CRM012 : `excluded` = echeances ecartees parce que leur source n'est pas retenue. */
export type PlanResult = { planned: number; updated: number; cancelled: number; excluded: number };

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
  return { planned: row?.planned ?? 0, updated: row?.updated ?? 0, cancelled: row?.cancelled ?? 0, excluded: row?.excluded ?? 0 };
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

/** CRM011 : lire l'interrupteur (membre). Sans ligne en base : arrete. */
export async function getFollowupSettings(companyId: string): Promise<FollowupSettings> {
  const { data, error } = await rpcUntyped('followup_settings_get', { _company: companyId });
  if (error) throw error;
  const row = (data as { mode: unknown; test_recipient: string | null; sources?: unknown; updated_at: string | null }[] | null)?.[0];
  return {
    mode: normalizeFollowupMode(row?.mode), testRecipient: row?.test_recipient ?? null,
    sources: normalizeFollowupSources(row?.sources), updatedAt: row?.updated_at ?? null,
  };
}

/**
 * CRM011 / CRM012 : changer l'interrupteur et les sources retenues (administrateurs ; le mode test
 * exige une adresse ; `sources` absent = inchange ; trace events).
 */
export async function setFollowupSettings(companyId: string, mode: FollowupMode, testRecipient: string | null, sources?: readonly FollowupSource[]): Promise<void> {
  const { error } = await rpcUntyped('followup_settings_set', {
    _company: companyId, _mode: mode, _test_recipient: testRecipient?.trim() || null,
    _sources: sources ? normalizeFollowupSources(sources) : null,
  });
  if (error) throw error;
}

export type SendNowResult = {
  ok?: boolean; error?: string; sent?: number; failed?: number; errors?: { id: string; error: string }[];
  dryRun?: boolean; html?: string; subject?: string; to?: string; from?: string;
  /** CRM011 : 'arrete' quand l'interrupteur a retenu l'envoi ; `mode` effectif ; `isTest` en apercu. */
  skipped?: 'arrete'; mode?: FollowupMode; isTest?: boolean; realTo?: string; held?: number;
};
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
