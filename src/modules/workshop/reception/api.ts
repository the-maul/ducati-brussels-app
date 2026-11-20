/**
 * M8 — Parcours mecanicien, lot C (19/11/2026) : acces base des photos de reception.
 *
 * UN SEUL STOCKAGE : la photo est deposee dans la GED de l'OR (bucket `ged`, `attachments`,
 * dossier « Réception »), par la meme fonction que le check-up ; la fonction SQL
 * `repair_order_reception_photo_add` la range ensuite dans la serie (case, commentaire, moto).
 * Fonctions et tables de la migration 20261119270000 (non appliquee, hors types.ts) : appels non
 * types et sonde de schema. Regles pures : `./rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { compressImageFile } from '@/lib/image-tools';
import { deleteAttachment, signedUrl, uploadAttachment, type Attachment } from '@/modules/documents/ged-api';
import { parseSlots, type ReceptionPhoto, type ReceptionSlot, type ReceptionStatus } from './rules';
import { withIdentityIfShared } from '../shared-tablet/store';
import { sharedTrace } from '../shared-tablet/api';

export const RECEPTION_GED_FOLDER = 'Réception';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args);

type LooseResult = { data: unknown; error: { message: string } | null };
type LooseQuery = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseQuery;
  eq: (col: string, value: unknown) => LooseQuery;
  in: (col: string, values: unknown[]) => LooseQuery;
  order: (col: string, opts?: { ascending?: boolean }) => LooseQuery;
  limit: (n: number) => LooseQuery;
  maybeSingle: () => Promise<LooseResult>;
};
const loose = supabase as unknown as { from: (table: string) => LooseQuery };

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

let probe: Promise<boolean> | null = null;
/** true quand la migration 20261119270000 est appliquee (table repair_order_reception_photos). */
export function receptionSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const { error } = await loose.from('repair_order_reception_photos').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return probe;
}

/** Pour les tests : forcer la presence (ou non) du schema. */
export function __setReceptionProbe(value: boolean | null): void {
  probe = value == null ? null : Promise.resolve(value);
}

/** Serie de la societe (reglage, sinon serie d'usine). */
export async function getReceptionSlots(companyId: string): Promise<ReceptionSlot[]> {
  return parseSlots(await call<unknown>('workshop_reception_slots', { _company: companyId }));
}

/** Enregistre la serie (null = retour a la serie d'usine). Droits des reglages atelier, trace. */
export async function saveReceptionSlots(companyId: string, slots: ReceptionSlot[] | null): Promise<ReceptionSlot[]> {
  const payload = slots ? slots.map((s) => ({ code: s.code, required: s.required, ...(s.label ? { label: s.label } : {}) })) : null;
  return parseSlots(await call<unknown>('workshop_reception_settings_set', { _company: companyId, _slots: payload }));
}

export type ReceptionRow = {
  or_id: string;
  status: Exclude<ReceptionStatus, 'none'>;
  general_comment: string | null;
  missing_required: string[];
  completed_at: string | null;
  postponed_at: string | null;
};

export type ReceptionState = { reception: ReceptionRow | null; photos: ReceptionPhoto[]; status: ReceptionStatus };

export async function getReception(orId: string): Promise<ReceptionState> {
  const [r, p] = await Promise.all([
    loose.from('repair_order_receptions').select('*').eq('or_id', orId).maybeSingle(),
    loose.from('repair_order_reception_photos').select('*').eq('or_id', orId).order('sort_order'),
  ]);
  if (r.error) throw new Error(r.error.message);
  if (p.error) throw new Error(p.error.message);
  const reception = (r.data as ReceptionRow | null) ?? null;
  return { reception, photos: (p.data as ReceptionPhoto[] | null) ?? [], status: reception?.status ?? 'none' };
}

/** Photos de reception d'une moto (historique de la fiche moto), avec le numero de l'OR. */
export type VehicleReceptionPhoto = ReceptionPhoto & { or_number: string | null; or_date: string | null };
export async function listVehicleReceptionPhotos(vehicleId: string): Promise<VehicleReceptionPhoto[]> {
  const { data, error } = await loose.from('repair_order_reception_photos').select('*')
    .eq('vehicle_id', vehicleId).order('taken_at', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  const photos = (data as ReceptionPhoto[] | null) ?? [];
  const orIds = [...new Set(photos.map((p) => p.or_id))];
  const numbers = new Map<string, { number: string | null; created_at: string | null }>();
  if (orIds.length) {
    const { data: ors } = await supabase.from('repair_orders').select('id, number, created_at').in('id', orIds);
    for (const o of ors ?? []) numbers.set(o.id, { number: o.number, created_at: o.created_at });
  }
  return photos.map((p) => ({ ...p, or_number: numbers.get(p.or_id)?.number ?? null, or_date: numbers.get(p.or_id)?.created_at ?? null }));
}

/**
 * Prend une photo : reduite (2 000 px, JPEG), deposee dans la GED de l'OR (dossier « Réception »),
 * puis rangee dans la case. Une case deja prise est remplacee : l'ancienne piece quitte la GED.
 */
export function addReceptionPhoto(p: {
  companyId: string; orId: string; slot: string; label: string; file: File; comment?: string | null;
}): Promise<{ photoId: string; missing: string[] }> {
  // Q60 (20/11/2026) : tablette partagee → « Qui etes-vous ? » d'abord, photo tracee (qui, depuis quel compte).
  return withIdentityIfShared(async (id) => {
    const r = await addReceptionPhotoCore(p);
    if (id) await sharedTrace(id.session, 'reception_photo', 'repair_orders', p.orId, { slot: p.slot, photo_id: r.photoId }).catch(() => undefined);
    return r;
  });
}

async function addReceptionPhotoCore(p: {
  companyId: string; orId: string; slot: string; label: string; file: File; comment?: string | null;
}): Promise<{ photoId: string; missing: string[] }> {
  const compact = await compressImageFile(p.file, 'upload');
  const note = p.label.trim() ? `${RECEPTION_GED_FOLDER} - ${p.label.trim()}` : RECEPTION_GED_FOLDER;
  const path = await uploadAttachment(p.companyId, 'repair_order', p.orId, compact, Date.now(), note, RECEPTION_GED_FOLDER);
  const { data: att, error } = await supabase.from('attachments').select('*').eq('storage_path', path).maybeSingle();
  if (error || !att) throw new Error(error?.message ?? 'GED');
  const res = await call<{ photo_id: string; replaced_attachment_id: string | null; missing: string[] }>(
    'repair_order_reception_photo_add', { _or: p.orId, _attachment: att.id, _slot: p.slot, _comment: p.comment ?? null },
  );
  if (res.replaced_attachment_id) await removeGedPiece(res.replaced_attachment_id);
  return { photoId: res.photo_id, missing: res.missing ?? [] };
}

async function removeGedPiece(attachmentId: string): Promise<void> {
  const { data } = await supabase.from('attachments').select('*').eq('id', attachmentId).maybeSingle();
  if (data) await deleteAttachment(data as Attachment).catch(() => undefined);
}

export function commentReceptionPhoto(photoId: string, comment: string | null): Promise<unknown> {
  return call('repair_order_reception_photo_comment', { _photo: photoId, _comment: comment });
}

/** Retire la photo de la serie puis de la GED (meme suppression que la GED). */
export async function removeReceptionPhoto(photoId: string): Promise<void> {
  const res = await call<{ status: string; attachment_id?: string | null }>('repair_order_reception_photo_remove', { _photo: photoId });
  if (res.attachment_id) await removeGedPiece(res.attachment_id);
}

/** Commentaire general et etat : enregistrer, terminer (meme incomplete), « Plus tard ». */
export function saveReception(orId: string, comment: string | null, action: 'save' | 'complete' | 'later'): Promise<{ status: string; missing: string[] }> {
  return call('repair_order_reception_save', { _or: orId, _comment: comment, _action: action });
}

/** URL signee (1 h) d'une photo, null si illisible. */
export async function receptionPhotoUrl(path: string): Promise<string | null> {
  try { return await signedUrl(path); } catch { return null; }
}
