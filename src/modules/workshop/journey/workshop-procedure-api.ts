/**
 * M8 — Mode operatoire de l'atelier (ATE014, 26/11/2026) : acces base. Tables et fonctions de la
 * migration 20261126270000 (hors types.ts : appels non types). Photos : GED existante
 * (attachments, entity_type 'workshop_procedure'). Regles pures : `./workshop-procedure-rules.ts`.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { listAttachments, uploadAttachment, type Attachment } from '@/modules/documents/ged-api';
import { toOrProceduresInfo, type OrProceduresInfo, type ProcedureDraft, type WorkshopProcedure } from './workshop-procedure-rules';

export const WORKSHOP_PROCEDURE_ENTITY = 'workshop_procedure';
export const WORKSHOP_PROCEDURE_GED_FOLDER = 'Mode opératoire';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>).call(supabase, fn, args);
type LooseQuery = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  select: (c: string) => LooseQuery; eq: (c: string, v: unknown) => LooseQuery; order: (c: string, o?: { ascending?: boolean }) => LooseQuery;
};
const loose = supabase as unknown as { from: (t: string) => LooseQuery };

/** Modes operatoires de l'atelier pour les operations de l'OR (null sans la migration). */
export async function listOrWorkshopProcedures(orId: string): Promise<OrProceduresInfo | null> {
  const { data, error } = await rpc('workshop_procedures_for_or', { _or: orId });
  if (error) return null;
  return data ? toOrProceduresInfo(data) : null;
}

export function useOrWorkshopProcedures(orId: string, enabled: boolean) {
  return useQuery({ queryKey: ['own-procs', orId], queryFn: () => listOrWorkshopProcedures(orId), enabled, staleTime: 60_000 });
}

/** Creer ou modifier (nouvelle version tracee). */
export async function saveWorkshopProcedure(p: { orId: string; opLabel: string; draft: ProcedureDraft; id?: string | null }): Promise<WorkshopProcedure> {
  const { data, error } = await rpc('workshop_procedure_save', {
    _or: p.orId, _op_label: p.opLabel, _scope: p.draft.scope,
    _steps: p.draft.steps.map((text) => ({ text })), _torques: p.draft.torques, _tools: p.draft.tools,
    _remarks: p.draft.remarks || null, _id: p.id ?? null,
  });
  if (error) throw new Error(error.message);
  return data as WorkshopProcedure;
}

export type ProcedureVersion = { id: string; version: number; edited_by_name: string | null; edited_at: string; scope: string };

export async function listProcedureVersions(procedureId: string): Promise<ProcedureVersion[]> {
  const { data, error } = await loose.from('workshop_procedure_versions')
    .select('id, version, edited_by_name, edited_at, scope').eq('procedure_id', procedureId).order('version', { ascending: false });
  if (error) return [];
  return (data as ProcedureVersion[] | null) ?? [];
}

export function listProcedurePhotos(procedureId: string): Promise<Attachment[]> {
  return listAttachments(WORKSHOP_PROCEDURE_ENTITY, procedureId);
}

export function addProcedurePhoto(companyId: string, procedureId: string, file: File): Promise<string> {
  return uploadAttachment(companyId, WORKSHOP_PROCEDURE_ENTITY, procedureId, file, Date.now(), WORKSHOP_PROCEDURE_GED_FOLDER, WORKSHOP_PROCEDURE_GED_FOLDER);
}
