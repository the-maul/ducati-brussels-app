/**
 * Rattrapage G8 (18/11/2026, lot parc) — fiche moto : detenteur / utilisateur, primes et aides.
 * Colonnes et table de la migration 20261118141000 (pas encore dans types.ts : acces non type,
 * erreur « colonne / table inconnue » traduite en message clair).
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import type { Bonus } from './economics';

type PgErr = { code?: string; message: string };
type Res = { data?: unknown; error: PgErr | null };
// Table et colonnes absentes de types.ts tant que la migration n'est pas posee : constructeur non type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };


/** true = l'erreur vient d'une migration pas encore appliquee (table ou colonne inconnue). */
export function isMissingSchemaError(e: PgErr | null | undefined): boolean {
  if (!e) return false;
  return ['PGRST204', 'PGRST205', '42P01', '42703'].includes(e.code ?? '') || /does not exist|Could not find/i.test(e.message);
}
const fail = (e: PgErr): never => {
  throw new Error(isMissingSchemaError(e) ? t('parcG8.migrationMissing') : e.message);
};

export async function listVehicleBonuses(vehicleId: string): Promise<Bonus[]> {
  const { data, error }: Res = await db.from('vehicle_bonuses').select('id, vehicle_id, bonus_date, amount, comment')
    .eq('vehicle_id', vehicleId).order('bonus_date', { ascending: false });
  if (error) { if (isMissingSchemaError(error)) return []; fail(error); }
  return ((data ?? []) as Bonus[]).map((b) => ({ ...b, amount: Number(b.amount) }));
}

export async function addVehicleBonus(p: { companyId: string; vehicleId: string; date: string; amount: number; comment?: string | null }): Promise<void> {
  const { error }: Res = await db.from('vehicle_bonuses').insert({
    company_id: p.companyId, vehicle_id: p.vehicleId, bonus_date: p.date, amount: p.amount, comment: p.comment?.trim() || null,
  });
  if (error) fail(error);
}

export async function deleteVehicleBonus(id: string): Promise<void> {
  const { error }: Res = await db.from('vehicle_bonuses').delete().eq('id', id);
  if (error) fail(error);
}

export type BonusWithVehicle = Bonus & { vehicle: { id: string; vin: string | null; brand: string | null; model: string | null; plate: string | null } | null };

/** « Liste des primes » du parc G8 : toutes les primes de la societe entre deux dates. */
export async function listBonusesForPeriod(companyId: string, from: string, to: string): Promise<BonusWithVehicle[]> {
  const { data, error }: Res = await db.from('vehicle_bonuses')
    .select('id, vehicle_id, bonus_date, amount, comment, vehicle:vehicle_id(id, vin, brand, model, plate)')
    .gte('bonus_date', from).lte('bonus_date', to).eq('company_id', companyId)
    .order('bonus_date', { ascending: true }).limit(2000);
  if (error) { if (isMissingSchemaError(error)) throw new Error(t('parcG8.migrationMissing')); fail(error); }
  return ((data ?? []) as BonusWithVehicle[]).map((b) => ({ ...b, amount: Number(b.amount) }));
}

/** Detenteur et utilisateur (le proprietaire reste l'historique `vehicle_owners`). */
export async function setVehicleParties(vehicleId: string, p: { holderId: string | null; userId: string | null }): Promise<void> {
  const { error }: Res = await db.from('vehicles').update({ holder_contact_id: p.holderId, user_contact_id: p.userId }).eq('id', vehicleId);
  if (error) fail(error);
}
