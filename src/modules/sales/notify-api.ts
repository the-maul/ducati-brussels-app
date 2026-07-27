/**
 * M6 — Envoi d'un document par e-mail (Microsoft Graph, boîte Outlook de la
 * société) / SMS (file `notifications` traitée par `dispatch-notifications`
 * via pg_cron) et historise l'envoi dans `communications` (onglet CRM de la
 * fiche client).
 */
import { supabase } from '@/integrations/supabase/client';
import { addCommunication, sendEmailViaOutlook } from '@/modules/crm/api';
import type { DocumentRow } from './write-api';
import type { Contact } from '@/modules/contacts/api';

export async function enqueueDocumentEmail(p: {
  companyId: string; document: DocumentRow; contact: Contact; subject: string; body: string;
}): Promise<void> {
  if (!p.contact.email) throw new Error('Contact sans adresse e-mail');
  const htmlBody = p.body.replace(/\n/g, '<br>');
  const { error } = await sendEmailViaOutlook({
    companyId: p.companyId, contactId: p.contact.id, to: p.contact.email,
    subject: p.subject, body: htmlBody,
  });
  if (error) throw new Error(error);
  await addCommunication({
    companyId: p.companyId, contactId: p.contact.id, channel: 'email', direction: 'out',
    subject: p.subject, body: p.body,
  });
}

export async function enqueueDocumentSms(p: {
  companyId: string; document: DocumentRow; contact: Contact; body: string;
}): Promise<void> {
  const to = p.contact.mobile || p.contact.phone;
  if (!to) throw new Error('Contact sans numéro de téléphone');
  const { error } = await supabase.from('notifications').insert({
    company_id: p.companyId, channel: 'sms', to_address: to,
    subject: null, body: p.body, entity_type: 'document', entity_id: p.document.id,
    status: 'pending', scheduled_at: new Date().toISOString(),
  });
  if (error) throw error;
  await addCommunication({
    companyId: p.companyId, contactId: p.contact.id, channel: 'sms', direction: 'out', body: p.body,
  });
}
