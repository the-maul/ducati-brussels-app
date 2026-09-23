/**
 * M8 — Parcours d'entretien : ce que l'écran lit et écrit dans le DMS (hors manuels).
 *
 * Lecture : l'OR, sa moto et son rattachement au catalogue Ducati (`vehicles.ducati_model_year_id`,
 * mission 06 carte 4) — c'est lui qui donne le programme d'entretien.
 * Écriture : report du récapitulatif sur l'OR (lignes proposées). **Rien n'est facturé
 * automatiquement** : les pièces partent à 0 €, le comptoir met le prix.
 */
import { supabase } from '@/integrations/supabase/client';
import { getRepairOrderFull, type RepairOrderFull } from '../api';
import { updateRepairOrder, type RoLineInput } from '../write-api';
import type { ProposedOrLine } from './rules';

export type JourneyVehicle = {
  id: string;
  vin: string | null;
  brand: string | null;
  model: string | null;
  plate: string | null;
  modelYearId: string | null;
  maintenanceUsage: string | null;
  mileage: number | null;
  firstRegistrationDate: string | null;
};

export type JourneyContext = { ro: RepairOrderFull; vehicle: JourneyVehicle | null };

/** L'OR, ses lignes et la moto avec son modèle-année du catalogue (null si la moto n'est pas reliée). */
export async function getJourneyContext(orId: string): Promise<JourneyContext> {
  const ro = await getRepairOrderFull(orId);
  if (!ro.or.vehicle_id) return { ro, vehicle: null };
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, vin, brand, model, plate, ducati_model_year_id, maintenance_usage, mileage, first_registration_date')
    .eq('id', ro.or.vehicle_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ro, vehicle: null };
  return {
    ro,
    vehicle: {
      id: data.id, vin: data.vin, brand: data.brand, model: data.model, plate: data.plate,
      modelYearId: data.ducati_model_year_id, maintenanceUsage: data.maintenance_usage,
      mileage: data.mileage, firstRegistrationDate: data.first_registration_date,
    },
  };
}

/**
 * Ajoute les lignes proposées par le récapitulatif à la fin de l'OR, sans toucher aux existantes.
 * Les pièces à remplacer arrivent à **0 € HT** : c'est une proposition, pas une facturation.
 */
export async function appendJourneyLines(
  companyId: string,
  ro: RepairOrderFull,
  proposed: ProposedOrLine[],
  workNote?: string | null,
): Promise<void> {
  if (!proposed.length && !workNote) return;
  const existing: RoLineInput[] = ro.lines.map((l) => ({
    kind: l.kind as RoLineInput['kind'],
    article_id: l.article_id,
    designation: l.designation,
    quantity: Number(l.quantity),
    unit_price_ht: Number(l.unit_price_ht),
    vat_rate: Number(l.vat_rate),
    discount_pct: Number(l.discount_pct),
    is_warranty: l.is_warranty,
  }));
  const added: RoLineInput[] = proposed.map((p) => ({
    kind: p.kind, article_id: null, designation: p.designation, quantity: p.quantity,
    unit_price_ht: 0, vat_rate: 21, discount_pct: 0, is_warranty: false,
  }));
  const o = ro.or;
  await updateRepairOrder(o.id, {
    companyId,
    contactId: o.contact_id, vehicleId: o.vehicle_id, mileage: o.mileage, operator: o.operator,
    repairType: o.repair_type, workDescription: workNote ? [o.work_description, workNote].filter(Boolean).join('\n') : o.work_description,
    receptionNotes: o.reception_notes, status: o.status === 'a_faire' ? 'en_cours' : o.status,
    warrantyStatus: o.warranty_status, expertName: o.expert_name, expertDate: o.expert_date,
    lines: [...existing, ...added],
  });
}
