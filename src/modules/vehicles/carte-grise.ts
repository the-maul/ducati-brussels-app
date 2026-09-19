/**
 * Mission 04, carte 7 — « Remplir la moto à partir d'une photo de la carte grise ».
 *
 * 1. La photo (ou le PDF) est déposée dans la GED de la moto, même stockage que les
 *    documents déposés par le client dans son espace : bucket privé `ged`, chemin
 *    `<société>/vehicle/<id moto>/…`, indexé dans `attachments` (entity_type = 'vehicle').
 *    Pour une moto pas encore enregistrée, l'identifiant est fixé d'avance par l'écran.
 * 2. La fonction serveur `read-id-doc` (mode « carte_grise », même modèle Claude que la
 *    lecture d'identité) renvoie les champs du formulaire avec un indice de confiance.
 *    Mappage : supabase/functions/_shared/carte-grise.ts (tests/carte-grise.test.ts).
 * 3. L'écran pré-remplit et surligne ; l'employé vérifie et corrige avant d'enregistrer.
 */
import { supabase } from '@/integrations/supabase/client';
import { prepareFileForUpload } from '@/modules/portal/image';

import type { CgReading } from './carte-grise-apply';

export type { CgConfidence, CgField, CgReading } from './carte-grise-apply';

/** Fichier de carte grise déposé dans la GED, à indexer sur la moto. */
export type CgScan = { path: string; file_name: string; content_type: string; size: number | null };

export const CG_FOLDER = 'Carte grise';
const BUCKET = 'ged';

export class CgReadError extends Error {
  constructor(public code: 'not_configured' | 'read_failed' | 'not_registration') { super(code); }
}

/** Dépose la photo dans le stockage de la moto (sans l'indexer : voir attachCarteGrise). */
export async function uploadCarteGrise(companyId: string, vehicleId: string, original: File): Promise<CgScan> {
  const file = await prepareFileForUpload(original);
  const ext = file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${companyId}/vehicle/${vehicleId}/${Date.now()}_carte-grise.${ext.replace(/[^a-z0-9]/g, '') || 'jpg'}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return { path, file_name: original.name || `carte-grise.${ext}`, content_type: file.type, size: file.size };
}

/** Fait lire une carte grise déjà dans la GED (photo ou PDF) par read-id-doc. */
export async function readCarteGrise(paths: string[]): Promise<CgReading> {
  const { data, error } = await supabase.functions.invoke('read-id-doc', { body: { paths, mode: 'carte_grise' } });
  if (error) {
    const msg = String((error as { message?: string }).message ?? '');
    if (/not found|404|Failed to send/i.test(msg)) throw new CgReadError('not_configured');
    throw new CgReadError('read_failed');
  }
  const body = data as { data?: CgReading; error?: string } | null;
  if (body?.error === 'not_configured') throw new CgReadError('not_configured');
  if (body?.error || !body?.data) throw new CgReadError('read_failed');
  if (!body.data.is_registration_certificate) throw new CgReadError('not_registration');
  return body.data;
}

/** Range la carte grise dans les documents de la moto (GED, dossier « Carte grise »). */
export async function attachCarteGrise(companyId: string, vehicleId: string, scan: CgScan): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('attachments').insert({
    company_id: companyId, entity_type: 'vehicle', entity_id: vehicleId, file_name: scan.file_name,
    storage_path: scan.path, content_type: scan.content_type || null, size_bytes: scan.size,
    note: 'carte_grise', folder: CG_FOLDER, uploaded_by: user?.id ?? null,
  });
  if (error) throw error;
}
