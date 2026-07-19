/**
 * M10 — CRM : leads (pipeline) + communications (histo e-mail/SMS/appels).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Lead = Database['public']['Tables']['leads']['Row'];
export type Communication = Database['public']['Tables']['communications']['Row'];

export const LEAD_STAGES = ['nouveau', 'contacte', 'qualifie', 'proposition', 'gagne', 'perdu'] as const;

export async function listLeads(companyId: string): Promise<Lead[]> {
  const { data, error } = await supabase.from('leads').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data ?? [];
}

export async function createLead(p: { companyId: string; name: string; email?: string; phone?: string; vehicleInterest?: string; source?: string; estimatedValue?: number | null; contactId?: string | null; oroId?: string | null; repriseStatus?: string | null }): Promise<string> {
  const base = {
    company_id: p.companyId, name: p.name, email: p.email || null, phone: p.phone || null,
    vehicle_interest: p.vehicleInterest || null, source: p.source || null, estimated_value: p.estimatedValue ?? null, contact_id: p.contactId ?? null,
  };
  // Lien reprise + tag de statut : colonnes récentes (migration 20260720).
  // Résilient : si absentes, on retombe sur l'insert de base.
  const withRep = { ...base, oro_id: p.oroId ?? null, reprise_status: p.repriseStatus ?? null };
  let res = await supabase.from('leads').insert(withRep as typeof base).select('id').single();
  if (res.error && isMissingSchema(res.error)) {
    res = await supabase.from('leads').insert(base).select('id').single();
  }
  if (res.error) throw res.error;
  return res.data.id as string;
}

const isMissingSchema = (e: unknown): boolean => {
  const code = (e as { code?: string })?.code ?? '';
  return code === 'PGRST205' || code === '42P01' || code === '42703' || code === 'PGRST204';
};

/**
 * Synchronise le TAG de statut de reprise sur la fiche CRM (lead lié par
 * oro_id). Best-effort : silencieux si la colonne n'existe pas encore
 * (migration non appliquée) — le tag se synchronisera après migration.
 */
export async function syncLeadRepriseStatus(oroId: string, repriseStatus: string): Promise<void> {
  try {
    await supabase.from('leads').update({ reprise_status: repriseStatus } as never).eq('oro_id', oroId as never);
  } catch { /* colonne absente — non bloquant */ }
}

export async function setLeadStage(id: string, stage: string): Promise<void> {
  const { error } = await supabase.from('leads').update({ stage }).eq('id', id);
  if (error) throw error;
}

export type LeadPatch = Partial<Pick<Lead, 'name' | 'email' | 'phone' | 'vehicle_interest' | 'source' | 'estimated_value' | 'stage' | 'notes' | 'contact_id' | 'assigned_to'>>;
export async function updateLead(id: string, patch: LeadPatch): Promise<void> {
  const { error } = await supabase.from('leads').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id);
  if (error) throw error;
}

/** Activités/notes d'un lead (timeline). */
export async function listLeadActivities(leadId: string): Promise<Communication[]> {
  const { data, error } = await supabase.from('communications').select('*').eq('lead_id', leadId).order('occurred_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addLeadActivity(p: { companyId: string; leadId: string; contactId?: string | null; channel: string; direction?: string; subject?: string; body?: string }): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('communications').insert({
    company_id: p.companyId, lead_id: p.leadId, contact_id: p.contactId ?? null,
    channel: p.channel, direction: p.direction ?? 'out', subject: p.subject || null, body: p.body || null, created_by: user?.id ?? null,
  });
  if (error) throw error;
}

export type MailAttachment = { name: string; contentType: string; contentBytes: string };
/** Envoie un e-mail (corps HTML + pièces jointes) depuis la boîte Outlook (Graph). */
export async function sendEmailViaOutlook(p: { companyId: string; contactId: string; to: string; subject: string; body: string; attachments?: MailAttachment[] }): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('graph-send-email', { body: p });
  if (error) {
    // l'Edge Function renvoie un JSON d'erreur (ex. graph_not_configured) → le remonter
    const ctx = (error as { context?: { body?: unknown } }).context;
    return { error: (ctx?.body as { error?: string })?.error ?? error.message };
  }
  return data as { ok?: boolean };
}

export async function listCommunications(contactId: string): Promise<Communication[]> {
  const { data, error } = await supabase.from('communications').select('*').eq('contact_id', contactId).order('occurred_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addCommunication(p: { companyId: string; contactId: string; channel: string; direction: string; subject?: string; body?: string }): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('communications').insert({
    company_id: p.companyId, contact_id: p.contactId, channel: p.channel, direction: p.direction,
    subject: p.subject || null, body: p.body || null, created_by: user?.id ?? null,
  });
  if (error) throw error;
}
