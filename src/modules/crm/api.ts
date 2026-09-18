/**
 * M10 — CRM : leads (pipeline) + communications (histo e-mail/SMS/appels).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Lead = Database['public']['Tables']['leads']['Row'];
export type Communication = Database['public']['Tables']['communications']['Row'];

export const LEAD_STAGES = ['nouveau', 'contacte', 'qualifie', 'proposition', 'gagne', 'perdu'] as const;

/**
 * Les CRM de la concession (migration 20260918140000). Chaque demande appartient à
 * un pipeline. Seul le CRM commercial existe aujourd'hui ; le CRM atelier sera
 * ajouté ici quand on y travaillera — rien d'autre à changer dans l'écran.
 */
export const PIPELINES = ['commercial'] as const;
export type Pipeline = (typeof PIPELINES)[number];

export async function listLeads(companyId: string, pipeline: Pipeline = 'commercial'): Promise<Lead[]> {
  const { data, error } = await supabase.from('leads').select('*').eq('company_id', companyId)
    .eq('pipeline', pipeline)
    .is('archived_at', null)
    .order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data ?? [];
}

export async function createLead(p: { companyId: string; name: string; email?: string; phone?: string; vehicleInterest?: string; source?: string; estimatedValue?: number | null; contactId?: string | null; oroId?: string | null; repriseStatus?: string | null; pipeline?: Pipeline }): Promise<string> {
  const base = {
    company_id: p.companyId, pipeline: p.pipeline ?? 'commercial', name: p.name, email: p.email || null, phone: p.phone || null,
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
    .is('archived_at', null)
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
/**
 * Responsable par défaut des nouvelles demandes du CRM commercial : c'est à lui
 * que la tâche « Recontacter le client » est confiée à l'arrivée d'une demande.
 */
export async function getDefaultAssignee(companyId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('default_assignee', { _company: companyId });
  if (error) throw error;
  return (data as string | null) ?? null;
}
/** Change le responsable par défaut. `transfer` : reprend aussi les tâches ouvertes de l'ancien. Renvoie le nombre repris. */
export async function setDefaultAssignee(companyId: string, userId: string, transfer: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('set_default_assignee', { _company: companyId, _user: userId, _transfer: transfer });
  if (error) throw error;
  return (data as number) ?? 0;
}
/** Nombre de tâches ouvertes confiées à quelqu'un (pour annoncer ce qu'un transfert reprendrait). */
export async function countOpenTasksOf(companyId: string, userId: string): Promise<number> {
  const { count, error } = await supabase.from('lead_tasks').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('assigned_to', userId).is('done_at', null);
  if (error) throw error;
  return count ?? 0;
}

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
    .is('archived_at', null)
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
 * TÂCHES D'UNE DEMANDE (migration 20260914240000).
 *
 * Une demande = une carte = un client. Elle porte UNE SEULE tâche ouverte à la
 * fois. On ne crée jamais une deuxième carte pour le même fil : on termine la
 * tâche courante et on en ouvre une nouvelle sur la même carte.
 *
 * La version précédente créait une nouvelle DEMANDE à chaque relance, ce qui
 * dupliquait la carte du client dans le pipeline. Un index unique partiel
 * (`uq_lead_tasks_open`) interdit désormais deux tâches ouvertes sur une même
 * demande : la garantie est en base, pas seulement à l'écran.
 */
export type LeadTask = Database['public']['Tables']['lead_tasks']['Row'];

export async function listLeadTasks(leadId: string): Promise<LeadTask[]> {
  const { data, error } = await supabase
    .from('lead_tasks')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * La tâche ouverte de CHAQUE carte, en une seule requête.
 *
 * Le pipeline doit montrer ce qu'il faut faire et qui s'en charge, sur chaque
 * carte. Une requête par carte serait intenable : on ramène toutes les tâches
 * ouvertes de la société et on les range par demande. L'index unique partiel
 * garantit qu'il y en a au plus une par carte.
 */
export type OpenTaskLite = { lead_id: string; title: string; due_at: string; assigned_to: string };
export async function listOpenTasksByLead(companyId: string): Promise<Record<string, OpenTaskLite>> {
  const { data, error } = await supabase
    .from('lead_tasks')
    .select('lead_id,title,due_at,assigned_to')
    .eq('company_id', companyId)
    .is('done_at', null);
  if (error) throw error;
  const byLead: Record<string, OpenTaskLite> = {};
  for (const r of (data ?? []) as OpenTaskLite[]) byLead[r.lead_id] = r;
  return byLead;
}

/** La tâche en cours, s'il y en a une. */
export const openTask = (tasks: LeadTask[] | undefined): LeadTask | null =>
  tasks?.find((t) => !t.done_at) ?? null;

/** Ouvre une tâche. Échoue si une autre est déjà ouverte sur cette demande. */
export async function createLeadTask(p: {
  companyId: string; leadId: string; title: string; dueAt: string; assignedTo: string;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('lead_tasks').insert({
    company_id: p.companyId, lead_id: p.leadId, title: p.title,
    due_at: p.dueAt, assigned_to: p.assignedTo, created_by: user?.id ?? null,
  });
  if (error) {
    // 23505 = l'index unique partiel a fait son travail.
    if ((error as { code?: string }).code === '23505') throw new Error('TASK_ALREADY_OPEN');
    throw error;
  }
}

/** Marque la tâche en cours comme faite. Elle rejoint l'historique de la carte. */
export async function completeLeadTask(taskId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('lead_tasks')
    .update({ done_at: new Date().toISOString(), done_by: user?.id ?? null })
    .eq('id', taskId);
  if (error) throw error;
}

export async function updateLeadTask(
  taskId: string,
  patch: Partial<Pick<LeadTask, 'title' | 'due_at' | 'assigned_to'>>,
): Promise<void> {
  const { error } = await supabase.from('lead_tasks').update(patch).eq('id', taskId);
  if (error) throw error;
}

export type LeadPatch = Partial<Pick<Lead, 'name' | 'email' | 'phone' | 'vehicle_interest' | 'source' | 'estimated_value' | 'stage' | 'notes' | 'contact_id' | 'assigned_to' | 'due_at'>>;
export async function updateLead(id: string, patch: LeadPatch): Promise<void> {
  const { error } = await supabase.from('leads').update(patch).eq('id', id);
  if (error) throw error;
}

/**
 * ARCHIVER une demande (migration 20260914260000).
 *
 * Troisième et dernière sortie possible d'une carte : il n'y a plus rien à
 * faire pour ce client. La carte quitte le pipeline et les rappels, mais elle
 * n'est pas supprimée — on ne dit ni « gagné » ni « perdu ».
 */
export async function archiveLead(id: string, reason?: string | null): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('leads').update({
    archived_at: new Date().toISOString(), archived_by: user?.id ?? null, archived_reason: reason || null,
  }).eq('id', id);
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
