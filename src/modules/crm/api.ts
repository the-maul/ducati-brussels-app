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

export async function createLead(p: { companyId: string; name: string; email?: string; phone?: string; vehicleInterest?: string; source?: string; estimatedValue?: number | null; contactId?: string | null }): Promise<string> {
  const { data, error } = await supabase.from('leads').insert({
    company_id: p.companyId, name: p.name, email: p.email || null, phone: p.phone || null,
    vehicle_interest: p.vehicleInterest || null, source: p.source || null, estimated_value: p.estimatedValue ?? null, contact_id: p.contactId ?? null,
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function setLeadStage(id: string, stage: string): Promise<void> {
  const { error } = await supabase.from('leads').update({ stage }).eq('id', id);
  if (error) throw error;
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
