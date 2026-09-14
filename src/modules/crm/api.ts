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

/**
 * Échéance de traitement d'une demande (migration 20260914190000).
 * Posée à la création, repoussée à chaque échange avec le client par un trigger.
 * Le délai se règle dans Paramètres → Tables → `lead_sla`.
 */
export type DueState = 'none' | 'overdue' | 'today' | 'later';
export function dueState(due: string | null | undefined): DueState {
  if (!due) return 'none';
  const t = Date.parse(due);
  if (!Number.isFinite(t)) return 'none';
  if (t < Date.now()) return 'overdue';
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return t <= endOfDay.getTime() ? 'today' : 'later';
}

/** Étapes considérées comme ouvertes : une demande gagnée ou perdue n'a plus d'échéance. */
export const OPEN_STAGES = ['nouveau', 'contacte', 'qualifie', 'proposition'] as const;

export type LeadDueSummary = { overdue: number; today: number };
/** Compteur pour la cloche de la barre du haut. */
export async function countLeadsDue(companyId: string): Promise<LeadDueSummary> {
  const { data, error } = await supabase
    .from('leads')
    .select('due_at')
    .eq('company_id', companyId)
    .in('stage', OPEN_STAGES as unknown as string[])
    .not('due_at', 'is', null);
  if (error) throw error;
  let overdue = 0;
  let today = 0;
  for (const row of data ?? []) {
    const s = dueState((row as { due_at: string | null }).due_at);
    if (s === 'overdue') overdue++;
    else if (s === 'today') today++;
  }
  return { overdue, today };
}

/**
 * Membres de la société, pour confier une tâche à quelqu'un.
 * Fonction serveur car ni `user_roles` ni `profiles` ne sont lisibles au-delà de
 * soi-même, et `listOrgUsers` refuse l'accès à qui n'est pas admin.
 */
export type CompanyMember = { user_id: string; name: string; roles: string };
export async function listCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  const { data, error } = await supabase.rpc('company_members', { _company: companyId });
  if (error) throw error;
  return (data as CompanyMember[]) ?? [];
}

/** Demandes à traiter (en retard ou pour aujourd'hui) — liste de la cloche. */
export async function listLeadsDue(companyId: string): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('company_id', companyId)
    .in('stage', OPEN_STAGES as unknown as string[])
    .not('due_at', 'is', null)
    .order('due_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data ?? []).filter((l) => {
    const s = dueState(l.due_at);
    return s === 'overdue' || s === 'today';
  });
}

/**
 * Clôture une demande ET ouvre la suivante, confiée à quelqu'un.
 * Le client garde ainsi un fil continu : la demande traitée est fermée, mais ce
 * qu'il reste à faire ne disparaît pas avec elle.
 */
export async function closeAndCreateFollowUp(p: {
  companyId: string; lead: Lead; stage: string;
  what: string; assignedTo: string | null; dueAt: string | null;
}): Promise<void> {
  await updateLead(p.lead.id, { stage: p.stage });
  const { error } = await supabase.from('leads').insert({
    company_id: p.companyId, contact_id: p.lead.contact_id,
    name: p.lead.name, email: p.lead.email, phone: p.lead.phone,
    vehicle_interest: p.lead.vehicle_interest, source: p.lead.source,
    stage: 'nouveau', notes: p.what || null,
    assigned_to: p.assignedTo, due_at: p.dueAt,
  });
  if (error) throw error;
}

export type LeadPatch = Partial<Pick<Lead, 'name' | 'email' | 'phone' | 'vehicle_interest' | 'source' | 'estimated_value' | 'stage' | 'notes' | 'contact_id' | 'assigned_to' | 'due_at'>>;
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

/**
 * Suivi d'une demande : qui a fait quoi et quand.
 * Passe par une fonction serveur car `profiles` n'est lisible que pour soi-même :
 * une jointure côté client renverrait un suivi anonyme (migration 20260914210000).
 */
export type LeadAuditRow = { occurred_at: string; action: string; actor: string; changes: string | null };
export async function listLeadAudit(leadId: string): Promise<LeadAuditRow[]> {
  const { data, error } = await supabase.rpc('lead_audit', { _lead: leadId });
  if (error) throw error;
  return (data as LeadAuditRow[]) ?? [];
}

/** Boîtes d'expédition de la société, pour choisir depuis quelle adresse on répond. */
export type CompanyMailbox = { id: string; address: string; purpose: string };
export async function listCompanyMailboxes(companyId: string): Promise<CompanyMailbox[]> {
  const { data, error } = await supabase
    .from('company_mailboxes')
    .select('id,address,purpose')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('address');
  if (error) throw error;
  return (data as CompanyMailbox[]) ?? [];
}

export type MailAttachment = { name: string; contentType: string; contentBytes: string };
/** Envoie un e-mail (corps HTML + pièces jointes) depuis la boîte Outlook (Graph). */
export async function sendEmailViaOutlook(p: { companyId: string; contactId: string; to: string; subject: string; body: string; attachments?: MailAttachment[]; from?: string }): Promise<{ ok?: boolean; error?: string }> {
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
