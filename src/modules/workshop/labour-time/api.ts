/**
 * M8 — Temps de main-d'oeuvre (rattrapage G8 du 18/11/2026, B11) : accès base.
 * Fonctions SQL de la migration 20261118110000 (non appliquée, hors types.ts) : appelées sans
 * typage, avec sonde de schéma (`labourTimeSchemaReady`) pour que l'atelier tourne avant la migration.
 * Règles pures : `./rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { listRef } from '@/modules/settings/reference-api';
import type { ControlRow, PointedByMechanic, ProductivityRow } from './rules';

/** Codes mécano de la pointeuse (Paramètres → Tables). */
export const WORKSHOP_MECHANIC_TABLE_KEY = 'workshop_mechanic';
/** Tâches improductives pointables (Paramètres → Tables ; préchargées par la migration). */
export const WORKSHOP_TASK_TABLE_KEY = 'workshop_task';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args);

let probe: Promise<boolean> | null = null;
/** true quand la migration 20261118110000 est appliquée (colonne repair_order_lines.billed_hours). */
export function labourTimeSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const { error } = await supabase.from('repair_order_lines').select('billed_hours' as never).limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return probe;
}

export type Mechanic = { code: string; name: string };
export type ImproductiveTask = { code: string; label: string };

export async function listMechanics(companyId: string): Promise<Mechanic[]> {
  const rows = await listRef(companyId, WORKSHOP_MECHANIC_TABLE_KEY).catch(() => []);
  return rows.filter((r) => r.is_active).map((r) => ({ code: r.code, name: r.label }));
}

export async function listImproductiveTasks(companyId: string): Promise<ImproductiveTask[]> {
  const rows = await listRef(companyId, WORKSHOP_TASK_TABLE_KEY).catch(() => []);
  return rows.filter((r) => r.is_active).map((r) => ({ code: r.code, label: r.label }));
}

/** Temps pointé sur l'OR, par mécanicien (heures). */
export async function getOrPointedTime(orId: string): Promise<PointedByMechanic[]> {
  const { data, error } = await rpc('repair_order_time_summary', { _or: orId });
  if (error) throw error;
  return ((data ?? []) as PointedByMechanic[]).map((r) => ({ ...r, pointed_h: Number(r.pointed_h) || 0 }));
}

/** Enregistre le « Contrôle du temps atelier » (quantité de chaque ligne MO = heures facturées). */
export async function saveTimeControl(orId: string, rows: ControlRow[]): Promise<number> {
  const payload = rows.map((r) => ({
    id: r.id, mechanic_code: r.mechanic_code, mechanic_name: r.mechanic_name, work_date: r.work_date || null,
    billed_hours: r.billed, worked_hours: r.worked, internal_hours: r.internal, warranty_hours: r.warranty,
  }));
  const { data, error } = await rpc('repair_order_time_control', { _or: orId, _lines: payload });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Productivité atelier : une ligne par jour et par mécanicien (heures). */
export async function getProductivityDetail(companyId: string, from: string, to: string): Promise<ProductivityRow[]> {
  const { data, error } = await rpc('workshop_productivity_detail', { _company: companyId, _from: from, _to: to });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day), mechanic_key: String(r.mechanic_key ?? ''), mechanic_name: String(r.mechanic_name ?? ''),
    presence_h: Number(r.presence_h) || 0, pointed_h: Number(r.pointed_h) || 0, improductive_h: Number(r.improductive_h) || 0,
    billed_h: Number(r.billed_h) || 0, to_bill_h: Number(r.to_bill_h) || 0, internal_h: Number(r.internal_h) || 0,
    warranty_h: Number(r.warranty_h) || 0, line_worked_h: Number(r.line_worked_h) || 0,
  }));
}
