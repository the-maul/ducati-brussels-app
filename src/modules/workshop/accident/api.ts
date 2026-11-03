/**
 * M8 — Dossiers accident (mission 09, carte 5, ACH005) : ACCES BASE ET GED.
 *
 * Tables `accident_files` / `accident_file_photos` (migration 20261103110000, non appliquee a
 * l'ecriture : `types.ts` ne les connait pas, d'ou les appels non types — meme parade que
 * `checkup/api.ts`). Les fichiers (photos, formulaire Excel, PDF de photos, rapport de l'expert)
 * vont dans la GED (bucket `ged`, entite `accident_file`), jamais en base64 en base.
 */
import { supabase } from '@/integrations/supabase/client';
import { compressImageFile } from '@/lib/image-tools';
import { uploadAttachment, deleteAttachment, signedUrl } from '@/modules/documents/ged-api';
import { listRef } from '@/modules/settings/reference-api';
import type { DocumentRow } from '@/modules/sales/write-api';
import {
  ACCIDENT_FILE_DEFAULT_TO, ACCIDENT_FILE_ENTITY, ACCIDENT_FILE_MAIL_TABLE_KEY, splitAddresses,
  type AccidentFileStatus,
} from './rules';

type LooseResult = { data: unknown; error: { code?: string; message: string } | null };
type LooseBuilder = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseBuilder;
  insert: (values: Record<string, unknown>) => LooseBuilder;
  update: (values: Record<string, unknown>) => LooseBuilder;
  delete: () => LooseBuilder;
  eq: (col: string, value: unknown) => LooseBuilder;
  is: (col: string, value: unknown) => LooseBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => LooseBuilder;
  limit: (n: number) => LooseBuilder;
  maybeSingle: () => Promise<LooseResult>;
  single: () => Promise<LooseResult>;
};
const loose = supabase as unknown as { from: (table: string) => LooseBuilder };

const unwrap = <T,>(r: LooseResult): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export type AccidentFileRow = {
  id: string;
  company_id: string;
  vehicle_id: string | null;
  contact_id: string | null;
  repair_order_id: string | null;
  quote_document_id: string | null;
  insurer: string | null;
  claim_number: string | null;
  expert_name: string | null;
  expert_email: string | null;
  expert_report_path: string | null;
  is_urgent: boolean;
  urgent_note: string | null;
  status: AccidentFileStatus;
  sent_at: string | null;
  sent_to: string | null;
  sent_cc: string | null;
  mail_subject: string | null;
  form_path: string | null;
  photos_pdf_path: string | null;
  vin_photo_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AccidentVehicle = { id: string; brand: string | null; model: string | null; vin: string | null; plate: string | null };
export type AccidentContact = { id: string; first_name: string | null; last_name: string | null; company_name: string | null; type: string | null; email: string | null };
export type AccidentQuote = { id: string; number: string | null; total_ht: number; status: string; issue_date: string };

export type AccidentFileFull = AccidentFileRow & {
  vehicle: AccidentVehicle | null;
  contact: AccidentContact | null;
  quote: AccidentQuote | null;
};

export type AccidentFilePhoto = {
  id: string;
  file_id: string;
  path: string;
  caption: string | null;
  is_vin: boolean;
  taken_at: string | null;
  sort: number;
  created_at: string;
};

const FULL_SELECT = '*, vehicle:vehicles(id,brand,model,vin,plate), contact:contacts(id,first_name,last_name,company_name,type,email), quote:documents!accident_files_quote_document_id_fkey(id,number,total_ht,status,issue_date)';

/** La migration est-elle posee ? (table absente → l'ecran l'explique au lieu de planter). */
export async function accidentSchemaReady(): Promise<boolean> {
  const r = await loose.from('accident_files').select('id').limit(1);
  if (!r.error) return true;
  if (r.error.code === '42P01' || /accident_files/.test(r.error.message)) return false;
  throw new Error(r.error.message);
}

export async function listAccidentFiles(companyId: string): Promise<AccidentFileFull[]> {
  const r = await loose.from('accident_files').select(FULL_SELECT).eq('company_id', companyId).order('created_at', { ascending: false }).limit(200);
  return unwrap<AccidentFileFull[]>(r) ?? [];
}

export async function getAccidentFile(id: string): Promise<AccidentFileFull | null> {
  const r = await loose.from('accident_files').select(FULL_SELECT).eq('id', id).maybeSingle();
  return unwrap<AccidentFileFull | null>(r);
}

/** Dossier deja ouvert pour cet OR ou ce devis (on n'en ouvre pas deux). */
export async function findAccidentFileFor(companyId: string, key: { repairOrderId?: string | null; quoteDocumentId?: string | null }): Promise<string | null> {
  if (key.repairOrderId) {
    const r = await loose.from('accident_files').select('id').eq('company_id', companyId).eq('repair_order_id', key.repairOrderId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const row = unwrap<{ id: string } | null>(r);
    if (row) return row.id;
  }
  if (key.quoteDocumentId) {
    const r = await loose.from('accident_files').select('id').eq('company_id', companyId).eq('quote_document_id', key.quoteDocumentId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const row = unwrap<{ id: string } | null>(r);
    if (row) return row.id;
  }
  return null;
}

export type AccidentFileCreate = {
  companyId: string;
  vehicleId?: string | null;
  contactId?: string | null;
  repairOrderId?: string | null;
  quoteDocumentId?: string | null;
  expertName?: string | null;
};

/** Ouvre un dossier (ou renvoie celui deja ouvert pour le meme OR / devis). */
export async function openAccidentFile(p: AccidentFileCreate): Promise<string> {
  const existing = await findAccidentFileFor(p.companyId, { repairOrderId: p.repairOrderId, quoteDocumentId: p.quoteDocumentId });
  if (existing) return existing;
  const { data: { user } } = await supabase.auth.getUser();
  const r = await loose.from('accident_files').insert({
    company_id: p.companyId, vehicle_id: p.vehicleId ?? null, contact_id: p.contactId ?? null,
    repair_order_id: p.repairOrderId ?? null, quote_document_id: p.quoteDocumentId ?? null,
    expert_name: p.expertName ?? null, created_by: user?.id ?? null,
  }).select('id').single();
  return unwrap<{ id: string }>(r).id;
}

export type AccidentFilePatch = Partial<Pick<AccidentFileRow,
  'vehicle_id' | 'contact_id' | 'quote_document_id' | 'insurer' | 'claim_number' | 'expert_name' | 'expert_email'
  | 'expert_report_path' | 'is_urgent' | 'urgent_note' | 'status' | 'sent_at' | 'sent_to' | 'sent_cc' | 'mail_subject'
  | 'form_path' | 'photos_pdf_path' | 'vin_photo_path'>>;

export async function updateAccidentFile(id: string, patch: AccidentFilePatch): Promise<void> {
  const r = await loose.from('accident_files').update(patch).eq('id', id);
  unwrap(r);
}

/** Devis du DMS de cette moto (les plus recents d'abord), pour « Devis lie ». */
export async function listVehicleQuotes(companyId: string, vehicleId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase.from('documents').select('*')
    .eq('company_id', companyId).eq('vehicle_id', vehicleId).eq('doc_type', 'DEV')
    .neq('status', 'annulee').order('issue_date', { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Photos (GED du dossier, dossier « Photos »)
// ---------------------------------------------------------------------------

export const ACCIDENT_PHOTOS_FOLDER = 'Photos';
export const ACCIDENT_FILES_FOLDER = 'Dossier';

export async function listAccidentPhotos(fileId: string): Promise<AccidentFilePhoto[]> {
  const r = await loose.from('accident_file_photos').select('*').eq('file_id', fileId).order('sort', { ascending: true }).order('created_at', { ascending: true });
  return unwrap<AccidentFilePhoto[]>(r) ?? [];
}

/** Reduit la photo (2 000 px, JPEG), la depose dans la GED du dossier et enregistre sa ligne. */
export async function addAccidentPhoto(companyId: string, fileId: string, file: File, p: { caption?: string | null; isVin?: boolean; sort: number }): Promise<string> {
  const compact = await compressImageFile(file, 'upload');
  const path = await uploadAttachment(companyId, ACCIDENT_FILE_ENTITY, fileId, compact, Date.now() + p.sort, p.caption?.trim() || undefined, ACCIDENT_PHOTOS_FOLDER);
  const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
  const r = await loose.from('accident_file_photos').insert({
    company_id: companyId, file_id: fileId, path, caption: p.caption?.trim() || null, is_vin: !!p.isVin, taken_at: takenAt, sort: p.sort,
  }).select('id').single();
  return unwrap<{ id: string }>(r).id;
}

export async function updateAccidentPhoto(id: string, patch: Partial<Pick<AccidentFilePhoto, 'caption' | 'sort'>>): Promise<void> {
  unwrap(await loose.from('accident_file_photos').update(patch).eq('id', id));
}

/** Marque LA photo du n° de chassis grave (une seule par dossier : on retire d'abord la marque des autres). */
export async function setVinPhoto(fileId: string, photoId: string | null): Promise<void> {
  unwrap(await loose.from('accident_file_photos').update({ is_vin: false }).eq('file_id', fileId).eq('is_vin', true));
  if (photoId) unwrap(await loose.from('accident_file_photos').update({ is_vin: true }).eq('id', photoId));
}

/** Retire la photo du dossier ET de la GED (index + fichier). */
export async function removeAccidentPhoto(photo: AccidentFilePhoto): Promise<void> {
  unwrap(await loose.from('accident_file_photos').delete().eq('id', photo.id));
  await removeGedFile(photo.path);
}

async function removeGedFile(path: string): Promise<void> {
  const { data } = await supabase.from('attachments').select('*').eq('storage_path', path).limit(1).maybeSingle();
  if (data) await deleteAttachment(data);
  else await supabase.storage.from('ged').remove([path]);
}

export async function accidentFileUrl(path: string): Promise<string | null> {
  try { return await signedUrl(path); } catch { return null; }
}

/** Depose un fichier genere (formulaire, PDF de photos) ou recu (rapport de l'expert) dans la GED du dossier. */
export async function storeAccidentFile(companyId: string, fileId: string, bytes: Uint8Array | File, name: string, mime: string, note: string | null, folder = ACCIDENT_FILES_FOLDER): Promise<string> {
  const file = bytes instanceof File ? bytes : new File([bytes as BlobPart], name, { type: mime });
  return uploadAttachment(companyId, ACCIDENT_FILE_ENTITY, fileId, file, Date.now(), note ?? undefined, folder);
}

/** Octets d'un fichier de la GED (pour le joindre au mail). */
export async function readGedBytes(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from('ged').download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Parametres : destinataire et copie du mail (Parametres → Tables → Mail du dossier accident)
// ---------------------------------------------------------------------------

export type AccidentMailSettings = { to: string; cc: string[] };

export async function loadAccidentMailSettings(companyId: string): Promise<AccidentMailSettings> {
  let rows: { code: string; label: string; is_active: boolean }[] = [];
  try { rows = await listRef(companyId, ACCIDENT_FILE_MAIL_TABLE_KEY); } catch { rows = []; }
  const active = rows.filter((r) => r.is_active);
  const to = splitAddresses(active.find((r) => r.code === 'to')?.label)[0] ?? ACCIDENT_FILE_DEFAULT_TO;
  const cc = active.filter((r) => r.code !== 'to').flatMap((r) => splitAddresses(r.label));
  return { to, cc };
}
