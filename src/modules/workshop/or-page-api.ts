/**
 * M8 — Page OR : acces base de l'equipe (operateur) et des types de reparation (ATE001b).
 * Regles pures : `or-page-rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { listRef } from '@/modules/settings/reference-api';
import { DEFAULT_REPAIR_TYPES, WORKSHOP_REPAIR_TYPE_TABLE_KEY, isAccidentOr, shouldOpenAccidentFile, type TeamMemberRow } from './or-page-rules';
import { accidentSchemaReady, findAccidentFileFor, openAccidentFile } from './accident/api';

/** Membres de la societe (nom + roles), meme fonction que l'assignation des taches CRM. */
export async function listCompanyTeam(companyId: string): Promise<TeamMemberRow[]> {
  const { data, error } = await supabase.rpc('company_members', { _company: companyId });
  if (error) throw error;
  return ((data ?? []) as TeamMemberRow[]).map((m) => ({ user_id: m.user_id, name: m.name, roles: m.roles }));
}

/** Types de reparation actifs (Parametres → Tables → Types de reparation) ; liste par defaut sans ligne. */
export async function listRepairTypes(companyId: string): Promise<{ code: string; label: string }[]> {
  try {
    const rows = await listRef(companyId, WORKSHOP_REPAIR_TYPE_TABLE_KEY);
    const active = rows.filter((r) => r.is_active).map((r) => ({ code: r.code, label: r.label }));
    return active.length ? active : DEFAULT_REPAIR_TYPES;
  } catch {
    return DEFAULT_REPAIR_TYPES;
  }
}

let operatorProbe: Promise<boolean> | null = null;

/** true quand la migration 20261103230000 est appliquee (colonne repair_orders.operator_id). */
export function operatorIdSchemaReady(): Promise<boolean> {
  operatorProbe ??= (async () => {
    try {
      const { error } = await supabase.from('repair_orders').select('operator_id' as never).limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return operatorProbe;
}

/**
 * OR accident (motif ou type « accident ») : a l'enregistrement, le dossier accident est ouvert
 * en brouillon, lie a l'OR, au client et a la moto (retour client du 03/11/2026 : « aucun dossier
 * n'apparait »). Idempotent : un dossier deja ouvert pour l'OR est renvoye tel quel.
 * Renvoie l'id du dossier et s'il vient d'etre cree ; null si l'OR n'est pas un accident ou si la
 * migration des dossiers n'est pas en base.
 */
export async function ensureAccidentFileForOr(p: {
  companyId: string; orId: string; reasonCode: string | null; repairType: string | null; status: string;
  contactId: string | null; vehicleId: string | null; expertName: string | null;
}): Promise<{ fileId: string; created: boolean } | null> {
  if (!isAccidentOr(p) || p.status === 'annule') return null;
  const ready = await accidentSchemaReady().catch(() => false);
  if (!ready) return null;
  const existing = await findAccidentFileFor(p.companyId, { repairOrderId: p.orId });
  if (!shouldOpenAccidentFile({ ...p, hasFile: !!existing, schemaReady: ready })) return existing ? { fileId: existing, created: false } : null;
  const fileId = await openAccidentFile({
    companyId: p.companyId, repairOrderId: p.orId, contactId: p.contactId, vehicleId: p.vehicleId, expertName: p.expertName || null,
  });
  return { fileId, created: true };
}
