/**
 * M8 — Parcours d'entretien : ce que l'écran lit et écrit dans le DMS (hors manuels).
 *
 * Lecture : l'OR, sa moto et son rattachement au catalogue Ducati (`vehicles.ducati_model_year_id`,
 * mission 06 carte 4) — c'est lui qui donne le programme d'entretien.
 * Écriture : report du récapitulatif sur l'OR (lignes proposées). Lot parcours-fix (20/11, comme
 * G8) : une pièce relevée dont la référence est un article de la société prend le prix de vente du
 * tarif du client (même tarification que l'éditeur de lignes de l'OR : prix catalogue arrondi
 * société puis `repriceOrLines` / CustomerPricer). Référence inconnue : ligne à 0 €, à compléter.
 */
import { supabase } from '@/integrations/supabase/client';
import { getRepairOrderFull, type RepairOrderFull } from '../api';
import { updateRepairOrder, type RoLineInput } from '../write-api';
import type { ProposedOrLine } from './rules';
import { CustomerPricer, type PricingContact } from '@/modules/sales/customer-pricing-api';
import { articleVatRate } from '@/modules/sales/article-price';
import { repriceOrLines } from '../or-line-pricing';
import { articleBasePrices } from '../or-line-pricing-api';
import { loadHourlyRateHt } from '../maintenance-api';

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
  // Les lignes existantes sont recopiees AVEC leur etat de check-up (carte, etat, photo, ligne de
  // proposition) : sans cela, le report du parcours effacait l'etat 'ok' / 'reporte' et une
  // action refusee par le client redevenait facturable (mission 10, couture parcours -> OR).
  type CheckupCols = { checkup_key?: string | null; checkup_state?: string | null; photo_path?: string | null; proposal_line_id?: string | null };
  const existing: RoLineInput[] = ro.lines.map((l) => {
    const c = l as typeof l & CheckupCols;
    return {
      kind: l.kind as RoLineInput['kind'],
      article_id: l.article_id,
      designation: l.designation,
      quantity: Number(l.quantity),
      unit_price_ht: Number(l.unit_price_ht),
      vat_rate: Number(l.vat_rate),
      discount_pct: Number(l.discount_pct),
      is_warranty: l.is_warranty,
      checkup_key: c.checkup_key ?? null,
      checkup_state: c.checkup_state ?? null,
      photo_path: c.photo_path ?? null,
      proposal_line_id: c.proposal_line_id ?? null,
    };
  });
  const added = await priceJourneyLines(companyId, ro.or.contact_id, proposed);
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

type RefArticle = { id: string; reference: string; designation: string; vat_rate?: number | null; sale_price_ht?: number | null; sale_price_ttc?: number | null };

/** Règle pure : ligne proposée → ligne d'OR, reliée à l'article de même référence (sans tenir compte de la casse). */
export function journeyLineInputs(proposed: readonly ProposedOrLine[], articles: readonly RefArticle[], baseHt: ReadonlyMap<string, number>): RoLineInput[] {
  const byRef = new Map(articles.map((a) => [a.reference.trim().toUpperCase(), a]));
  return proposed.map((p) => {
    const a = p.kind === 'piece' && p.reference ? byRef.get(p.reference.trim().toUpperCase()) : undefined;
    return {
      kind: p.kind, article_id: a?.id ?? null, designation: a ? a.designation : p.designation, quantity: p.quantity,
      unit_price_ht: a ? baseHt.get(a.id) ?? 0 : 0, vat_rate: a ? articleVatRate(a) : 21, discount_pct: 0, is_warranty: false,
    };
  });
}

/** Lignes du récapitulatif au tarif du client (pièces reconnues par leur référence). */
export async function priceJourneyLines(companyId: string, contactId: string | null, proposed: readonly ProposedOrLine[]): Promise<RoLineInput[]> {
  const refs = [...new Set(proposed.filter((p) => p.kind === 'piece' && p.reference).map((p) => p.reference!.trim()))];
  if (!refs.length) return journeyLineInputs(proposed, [], new Map());
  try {
    const variants = [...new Set(refs.flatMap((r) => [r, r.toUpperCase()]))];
    const [arts, round, contact, rate] = await Promise.all([
      supabase.from('articles').select('id, reference, designation, vat_rate, sale_price_ht, sale_price_ttc')
        .eq('company_id', companyId).eq('is_active', true).in('reference', variants)
        .then((r) => (r.data ?? []) as RefArticle[]),
      supabase.from('companies').select('round_sale_prices_up').eq('id', companyId).maybeSingle()
        .then((r) => ((r.data as { round_sale_prices_up?: boolean | null } | null)?.round_sale_prices_up ?? true)),
      contactId
        ? supabase.from('contacts').select('id, company_id, price_list, price_list_id, show_discounts_pos').eq('id', contactId).maybeSingle()
          .then((r) => (r.data as PricingContact | null) ?? null)
        : Promise.resolve(null),
      loadHourlyRateHt(companyId).catch(() => null),
    ]);
    const base = await articleBasePrices(arts.map((a) => a.id), round);
    const lines = journeyLineInputs(proposed, arts, base);
    if (!contact) return lines;
    return (await repriceOrLines(lines, new CustomerPricer(companyId, contact), { articleBaseHt: base, labourRateHt: rate })).lines;
  } catch {
    return journeyLineInputs(proposed, [], new Map());
  }
}
