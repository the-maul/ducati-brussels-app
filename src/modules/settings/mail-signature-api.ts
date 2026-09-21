/**
 * M10 — Signature des e-mails (retour client du 21/09) : réglages lus et écrits par l'écran.
 * La signature elle-même est construite côté serveur (`graph-send-email`,
 * `supabase/functions/_shared/mail-message.ts`), selon l'adresse d'envoi :
 *   - adresse personnelle → nom + fonction de l'utilisateur (profiles.full_name / job_title) ;
 *   - boîte partagée → nom de la boîte (company_mailboxes.signature_name), sans personne ;
 * puis les coordonnées de la société (companies.mail_signature_*).
 *
 * Colonnes et fonctions de la migration 20260921191000, pas encore dans `types.ts` généré :
 * appels non typés ici, typés par les types ci-dessous.
 */
import { supabase } from '@/integrations/supabase/client';

/** `.bind(supabase)` obligatoire (voir tests/rpc-bound.test.ts). */
const rpcUntyped = supabase.rpc.bind(supabase) as unknown as (
  fn: string, args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const fromUntyped = supabase.from.bind(supabase) as unknown as (table: string) => {
  select: (cols: string) => {
    eq: (col: string, v: string) => {
      maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
      order: (col: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

export type UserSignature = { full_name: string | null; job_title: string | null; email: string | null };

export async function getUserSignature(userId: string): Promise<UserSignature> {
  const { data, error } = await rpcUntyped('get_user_mail_signature', { _user: userId });
  if (error) throw new Error(error.message);
  const row = (data as UserSignature[] | null)?.[0];
  return row ?? { full_name: null, job_title: null, email: null };
}

export async function setUserSignature(userId: string, fullName: string, jobTitle: string): Promise<void> {
  const { error } = await rpcUntyped('set_user_mail_signature', { _user: userId, _full_name: fullName, _job_title: jobTitle });
  if (error) throw new Error(error.message);
}

export type CompanySignature = {
  brand: string; address: string; phone: string; site_url: string; site_label: string;
};
export type MailboxSignature = { id: string; address: string; signature_name: string };

export async function getCompanySignature(companyId: string): Promise<{ company: CompanySignature; mailboxes: MailboxSignature[] }> {
  const [co, boxes] = await Promise.all([
    fromUntyped('companies')
      .select('mail_signature_brand, mail_signature_address, mail_signature_phone, mail_signature_site_url, mail_signature_site_label')
      .eq('id', companyId).maybeSingle(),
    fromUntyped('company_mailboxes').select('id, address, signature_name, is_active').eq('company_id', companyId).order('address'),
  ]);
  if (co.error) throw new Error(co.error.message);
  if (boxes.error) throw new Error(boxes.error.message);
  const c = (co.data ?? {}) as Record<string, string | null>;
  return {
    company: {
      brand: c.mail_signature_brand ?? '', address: c.mail_signature_address ?? '', phone: c.mail_signature_phone ?? '',
      site_url: c.mail_signature_site_url ?? '', site_label: c.mail_signature_site_label ?? '',
    },
    mailboxes: ((boxes.data ?? []) as { id: string; address: string; signature_name: string | null; is_active: boolean }[])
      .filter((b) => b.is_active)
      .map((b) => ({ id: b.id, address: b.address, signature_name: b.signature_name ?? '' })),
  };
}

export async function setCompanySignature(companyId: string, company: CompanySignature, mailboxes: MailboxSignature[]): Promise<void> {
  const { error } = await rpcUntyped('set_company_mail_signature', {
    _company: companyId,
    _settings: { ...company, mailboxes: mailboxes.map((b) => ({ id: b.id, signature_name: b.signature_name })) },
  });
  if (error) throw new Error(error.message);
}
