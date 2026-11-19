/**
 * SMS par Brevo (18/11/2026) : appels serveur de l'ecran Parametres → SMS et de la liste
 * « SMS programmes » (planning atelier).
 * - Reglages : sms_settings_get / sms_settings_set (migration 20261119170000).
 * - Etat de la connexion et SMS de test : fonction Edge `sms-brevo` (la cle ne quitte jamais le serveur).
 * - File : sms_list / sms_cancel / sms_schedule_appointments ; etat du SMS de fin de travaux d'un OR :
 *   sms_ready_state.
 * Les fonctions ne sont pas dans types.ts (migration non appliquee) : appels types localement.
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeSmsMode, type SmsMode, type SmsTemplates } from './sms-rules';

type RpcFn = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;

/** Message d'erreur serveur (codes SMS_* levés par la base). */
function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? 'sms_error');
}

/** La migration du lot SMS est-elle en base ? (sinon l'ecran l'explique au lieu de planter) */
export async function smsSchemaReady(companyId: string): Promise<boolean> {
  const { error } = await rpc('sms_settings_get', { _company: companyId });
  return !error || !/function|does not exist|schema cache/i.test(error.message);
}

export type SmsSettings = {
  mode: SmsMode; testRecipient: string | null; sender: string | null; signature: string | null; openingHours: string | null;
  readyAuto: boolean; reminderAuto: boolean; reminderLeadMinutes: number; templates: SmsTemplates;
  companyName: string | null; isTestCompany: boolean; updatedAt: string | null;
};

export async function getSmsSettings(companyId: string): Promise<SmsSettings> {
  const { data, error } = await rpc('sms_settings_get', { _company: companyId });
  if (error) fail(error);
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    mode: normalizeSmsMode(d.mode), testRecipient: (d.test_recipient as string) ?? null, sender: (d.sender as string) ?? null,
    signature: (d.signature as string) ?? null, openingHours: (d.opening_hours as string) ?? null,
    readyAuto: d.ready_auto !== false, reminderAuto: d.reminder_auto !== false,
    reminderLeadMinutes: Number(d.reminder_lead_minutes ?? 1440), templates: (d.templates as SmsTemplates) ?? {},
    companyName: (d.company_name as string) ?? null, isTestCompany: d.is_test_company === true, updatedAt: (d.updated_at as string) ?? null,
  };
}

export async function setSmsSettings(companyId: string, s: SmsSettings): Promise<void> {
  const { error } = await rpc('sms_settings_set', {
    _company: companyId,
    _s: {
      mode: s.mode, test_recipient: s.testRecipient, sender: s.sender, signature: s.signature, opening_hours: s.openingHours,
      ready_auto: s.readyAuto, reminder_auto: s.reminderAuto, reminder_lead_minutes: s.reminderLeadMinutes, templates: s.templates,
    },
  });
  if (error) fail(error);
}

export type SmsStatus = { configured: boolean; defaultSender: string; envSenderInvalid: boolean; credits: number | null; accountError: string | null };

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('sms-brevo', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const b = (await ctx.clone().json().catch(() => null)) as { error?: string } | null;
      if (b?.error) throw new Error(b.error);
    }
    throw new Error(error.message);
  }
  return data as T;
}

export async function getSmsStatus(companyId: string): Promise<SmsStatus> {
  const r = await invoke<{ configured: boolean; default_sender: string; env_sender_invalid: boolean; credits: number | null; account_error: string | null }>(
    { action: 'status', company_id: companyId });
  return {
    configured: !!r.configured, defaultSender: r.default_sender || 'DucatiBXL', envSenderInvalid: !!r.env_sender_invalid,
    credits: r.credits ?? null, accountError: r.account_error ?? null,
  };
}

/** SMS de test au numero saisi par l'utilisateur (administrateur). */
export async function sendTestSms(companyId: string, to: string, body: string): Promise<{ ok: boolean; error?: string; to?: string }> {
  return invoke({ action: 'test', company_id: companyId, to, body });
}

export type SmsRow = {
  id: number; template: string | null; status: string; error: string | null; to_address: string | null; sent_to: string | null;
  is_test: boolean; body: string | null; scheduled_at: string; sent_at: string | null; created_at: string; cancelled_at: string | null;
  contact_id: string | null; contact_name: string | null; entity_type: string | null; entity_id: string | null;
};

export async function listSms(companyId: string, scope: 'scheduled' | 'history', limit = 200): Promise<SmsRow[]> {
  const { data, error } = await rpc('sms_list', { _company: companyId, _scope: scope, _limit: limit });
  if (error) fail(error);
  return (data ?? []) as SmsRow[];
}

export async function cancelSms(id: number, reason?: string): Promise<void> {
  const { error } = await rpc('sms_cancel', { _id: id, _reason: reason ?? null });
  if (error) fail(error);
}

export type ScheduleInput = {
  from: string; to: string; type?: string | null;
  leadMinutes?: number | null; daysBefore?: number | null; atTime?: string | null;
  template?: string | null; onlyChecked: boolean;
};
export type ScheduleResult = Record<'queued' | 'already' | 'no_mobile' | 'consent_refused' | 'no_contact' | 'too_late', number>;

export async function scheduleAppointmentSms(companyId: string, p: ScheduleInput): Promise<ScheduleResult> {
  const { data, error } = await rpc('sms_schedule_appointments', {
    _company: companyId, _from: p.from, _to: p.to, _type: p.type || null,
    _lead_minutes: p.atTime ? null : p.leadMinutes ?? null,
    _days_before: p.atTime ? p.daysBefore ?? 0 : null, _at_time: p.atTime || null,
    _template: p.template?.trim() ? p.template : null, _only_checked: p.onlyChecked, _appointment: null,
  });
  if (error) fail(error);
  return data as ScheduleResult;
}

export type SmsReadyState = { status: string; reason: string | null; at: string | null; isTest: boolean } | null;

export async function getSmsReadyState(orId: string): Promise<SmsReadyState> {
  const { data, error } = await rpc('sms_ready_state', { _or: orId });
  if (error) return null; // migration pas encore appliquee : rien a afficher
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return { status: String(d.status ?? ''), reason: (d.reason as string) ?? null, at: (d.at as string) ?? null, isTest: d.is_test === true };
}
