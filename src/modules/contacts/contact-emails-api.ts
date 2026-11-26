/**
 * M1 — Plusieurs e-mails par fiche + file « Mails à rattacher » (CON002, migration 20261126300000).
 * Table et fonctions hors des types générés tant qu'ils ne sont pas régénérés.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ContactEmailRow, EmailKind } from './contact-emails-rules';

type DbError = { message: string; code?: string; hint?: string; details?: string };
type RpcResult = { data: unknown; error: DbError | null };
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
const loose = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => PromiseLike<{ data: unknown; error: DbError | null }>;
      };
    };
  };
};

/** Toutes les adresses de la fiche (principale comprise). */
export async function listContactEmails(contactId: string): Promise<ContactEmailRow[]> {
  const { data, error } = await loose.from('contact_emails')
    .select('id, contact_id, email, kind, is_primary, source, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ContactEmailRow[]) ?? [];
}

export async function addContactEmail(contactId: string, email: string, kind: EmailKind | null): Promise<string> {
  const { data, error } = await rpc('contact_email_add', { _contact: contactId, _email: email, _kind: kind });
  if (error) throw error;
  return data as string;
}

export async function removeContactEmail(id: string): Promise<void> {
  const { error } = await rpc('contact_email_remove', { _id: id });
  if (error) throw error;
}

export type AttachCandidate = {
  id: string; code: string | null; name: string | null; city: string | null;
  first_name: string | null; last_name: string | null; company_name: string | null;
};

/** Un mail d'une adresse inconnue au nom d'un client existant, en attente d'un choix. */
export type EmailAttachRequest = {
  id: string;
  email: string | null;
  sender: string | null;
  received_at: string | null;
  subject: string | null;
  preview: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  is_professional: boolean;
  attachments: string[];
  candidates: AttachCandidate[];
};

export async function listEmailAttachRequests(companyId: string): Promise<EmailAttachRequest[]> {
  const { data, error } = await rpc('email_attach_pending', { _company: companyId });
  if (error) throw error;
  return (data as EmailAttachRequest[]) ?? [];
}

/** `contactId` = client existant (l'adresse lui est ajoutée) ; null = créer un nouveau client. */
export async function resolveEmailAttachRequest(requestId: string, contactId: string | null): Promise<{ contact_id: string; status: string }> {
  const { data, error } = await rpc('email_attach_resolve', { _request: requestId, _contact: contactId });
  if (error) throw error;
  return data as { contact_id: string; status: string };
}

/** Code d'erreur métier levé par la base (CONTACT_EMAIL_EXISTS…), sinon null. */
export function contactEmailErrorCode(err: unknown): string | null {
  const msg = err && typeof err === 'object' ? String((err as { message?: unknown }).message ?? '') : '';
  const m = msg.match(/\b(CONTACT_EMAIL_[A-Z_]+|EMAIL_REQUEST_[A-Z_]+|FORBIDDEN)\b/);
  return m ? m[1] : null;
}
