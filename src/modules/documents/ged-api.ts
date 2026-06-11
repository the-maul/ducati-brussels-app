/**
 * M9 — GED : upload / liste / suppression / URL signée des pièces jointes (bucket 'ged').
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Attachment = Database['public']['Tables']['attachments']['Row'];
const BUCKET = 'ged';

const slug = (s: string) => s.replace(/[^\w.\-]+/g, '_').slice(-80);

export async function listAttachments(entityType: string, entityId: string): Promise<Attachment[]> {
  const { data, error } = await supabase.from('attachments').select('*')
    .eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function uploadAttachment(companyId: string, entityType: string, entityId: string, file: File, stamp: number): Promise<void> {
  const path = `${companyId}/${entityType}/${entityId}/${stamp}_${slug(file.name)}`;
  const { error: ue } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (ue) throw ue;
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('attachments').insert({
    company_id: companyId, entity_type: entityType, entity_id: entityId, file_name: file.name,
    storage_path: path, content_type: file.type || null, size_bytes: file.size, uploaded_by: user?.id ?? null,
  });
  if (error) throw error;
}

export async function deleteAttachment(att: Attachment): Promise<void> {
  await supabase.storage.from(BUCKET).remove([att.storage_path]);
  const { error } = await supabase.from('attachments').delete().eq('id', att.id);
  if (error) throw error;
}

export async function signedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}
