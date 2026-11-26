/**
 * Rattrapage G8 (18/11/2026, lot parc) — fiche moto : detenteur / utilisateur, primes et aides.
 * Colonnes et table de la migration 20261118141000 (pas encore dans types.ts : acces non type,
 * erreur « colonne / table inconnue » traduite en message clair).
 */
import { supabase } from '@/integrations/supabase/client';
import { t, fillVars } from '@/lib/i18n';
import type { Bonus } from './economics';
import { financingPeriod, type FinancingRow } from './financing-history';

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

type ContactLite = { id: string; first_name: string | null; last_name: string | null; company_name: string | null; type: string | null };
export type VehicleFinancing = FinancingRow & { bank: ContactLite | null; client: ContactLite | null };
export type BankFinancing = FinancingRow & {
  vehicle: { id: string; vin: string | null; plate: string | null; brand: string | null; model: string | null } | null;
  client: ContactLite | null;
  doc: { number: string | null; issue_date: string | null; total_ttc: number | string | null } | null;
};
const CONTACT_LITE = 'id, first_name, last_name, company_name, type';
const FINANCING_COLS = 'id, financing_contact_id, contract, client_contact_id, source_invoice, started_on, ended_on, is_current, created_at';

/** VEH001 : financements de la moto, en cours et anciens (table vehicle_financings). */
export async function listVehicleFinancings(vehicleId: string): Promise<VehicleFinancing[]> {
  const { data, error }: Res = await db.from('vehicle_financings')
    .select(`${FINANCING_COLS}, bank:financing_contact_id(${CONTACT_LITE}), client:client_contact_id(${CONTACT_LITE})`)
    .eq('vehicle_id', vehicleId);
  if (error) { if (isMissingSchemaError(error)) return []; fail(error); }
  return (data ?? []) as VehicleFinancing[];
}

/** VEH001 : fiche d'une banque — les financements terminés (les en cours viennent de vehicles). */
export async function listEndedBankFinancings(bankId: string): Promise<BankFinancing[]> {
  const { data, error }: Res = await db.from('vehicle_financings')
    .select(`${FINANCING_COLS}, vehicle:vehicle_id(id, vin, plate, brand, model), client:client_contact_id(${CONTACT_LITE}), doc:source_document_id(number, issue_date, total_ttc)`)
    .eq('financing_contact_id', bankId).eq('is_current', false).limit(1000);
  if (error) { if (isMissingSchemaError(error)) return []; fail(error); }
  return (data ?? []) as BankFinancing[];
}

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-BE');
};

/** « du 23/01/2014 au 14/07/2016 », « depuis le … », « jusqu'au … » ou « période inconnue ». */
export function financingPeriodLabel(r: Pick<FinancingRow, 'started_on' | 'ended_on'>): string {
  const p = financingPeriod(r);
  if (p.kind === 'fromTo') return fillVars(t('dossier.financingFromTo'), { from: fmtDay(p.from), to: fmtDay(p.to) });
  if (p.kind === 'from') return fillVars(t('dossier.financingFrom'), { date: fmtDay(p.from) });
  if (p.kind === 'until') return fillVars(t('dossier.financingUntil'), { date: fmtDay(p.to) });
  return t('dossier.financingNoPeriod');
}

/** Banque ou leasing qui finance la moto, et son contrat (le propriétaire reste `vehicle_owners`).
 *  L'historique (vehicle_financings) est tenu par le déclencheur trg_vehicle_financing_history. */
export async function setVehicleFinancing(vehicleId: string, p: { contactId: string | null; contract: string }): Promise<void> {
  const { error }: Res = await db.from('vehicles')
    .update({ financing_contact_id: p.contactId, financing_contract: p.contract.trim() || null }).eq('id', vehicleId);
  if (error) fail(error);
}
