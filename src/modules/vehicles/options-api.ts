/**
 * Rattrapage G8 (18/11/2026, lot parc) — catalogue d'options par modele : acces base.
 * Tables de la migration 20261118142000 (absentes de types.ts : acces non type).
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { isMissingSchemaError } from './fiche-g8-api';
import type { VehicleOption } from './options-rules';

type PgErr = { code?: string; message: string };
type Res = { data?: unknown; error: PgErr | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };
const fail = (e: PgErr): never => { throw new Error(isMissingSchemaError(e) ? t('parcG8.migrationMissing') : e.message); };

export type OptionModel = { id: string; code: string; label: string; article_id: string | null };

export async function listOptionModels(companyId: string): Promise<OptionModel[]> {
  const { data, error }: Res = await db.from('vehicle_option_models').select('id, code, label, article_id')
    .eq('company_id', companyId).order('code', { ascending: true });
  if (error) fail(error);
  return (data ?? []) as OptionModel[];
}

export async function saveOptionModel(companyId: string, m: { id?: string | null; code: string; label: string; articleId?: string | null }): Promise<string> {
  const row = { company_id: companyId, code: m.code.trim(), label: m.label.trim(), article_id: m.articleId ?? null };
  const q = m.id
    ? db.from('vehicle_option_models').update(row).eq('id', m.id).select('id').single()
    : db.from('vehicle_option_models').insert(row).select('id').single();
  const { data, error }: Res = await q;
  if (error) fail(error);
  return String((data as { id: string }).id);
}

export async function deleteOptionModel(id: string): Promise<void> {
  const { error }: Res = await db.from('vehicle_option_models').delete().eq('id', id);
  if (error) fail(error);
}

export async function duplicateOptionModel(id: string, code: string, label: string): Promise<string> {
  const { data, error }: Res = await db.rpc('vehicle_option_model_duplicate', { _model: id, _code: code, _label: label });
  if (error) fail(error);
  return String(data);
}

export async function listOptions(modelId: string): Promise<VehicleOption[]> {
  const { data, error }: Res = await db.from('vehicle_options')
    .select('id, model_id, group_code, code, label, purchase_price_ht, sale_price_ttc, vat_rate, info, sort_order')
    .eq('model_id', modelId).order('sort_order', { ascending: true });
  if (error) fail(error);
  return ((data ?? []) as VehicleOption[]).map((o) => ({
    ...o, purchase_price_ht: Number(o.purchase_price_ht), sale_price_ttc: Number(o.sale_price_ttc), vat_rate: Number(o.vat_rate),
  }));
}

export async function saveOption(companyId: string, o: Omit<VehicleOption, 'id'> & { id?: string | null }): Promise<void> {
  const row = {
    company_id: companyId, model_id: o.model_id, group_code: o.group_code?.trim() || null, code: o.code.trim(), label: o.label.trim(),
    purchase_price_ht: o.purchase_price_ht, sale_price_ttc: o.sale_price_ttc, vat_rate: o.vat_rate, info: o.info?.trim() || null,
    sort_order: o.sort_order,
  };
  const { error }: Res = o.id
    ? await db.from('vehicle_options').update(row).eq('id', o.id)
    : await db.from('vehicle_options').insert(row);
  if (error) fail(error);
}

export async function deleteOption(id: string): Promise<void> {
  const { error }: Res = await db.from('vehicle_options').delete().eq('id', id);
  if (error) fail(error);
}
