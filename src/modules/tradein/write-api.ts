/**
 * M7 — Reprise (flux B3) + ORO : écritures.
 * createReprise crée en une fois : article occasion (O/P) + fiche véhicule + entrée
 * de stock valorisée (PAMP) + ouverture d'un ORO. Les lignes d'ORO s'imputent au
 * coût de revient du véhicule (recompute_oro_and_vehicle).
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { repriseFillPatch, repriseVehicleChoice } from './reprise-vehicle-rules';

async function nextNumber(companyId: string, docType: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', { _company: companyId, _doc_type: docType });
  if (error) throw error;
  return data as string;
}

export type RepriseInput = {
  companyId: string;
  isPro: boolean;                 // pro (P, TVA 21%) ou particulier (O, TVA marge)
  contactId?: string | null;      // vendeur (propriétaire précédent) à lier
  designation: string;
  vin?: string | null;
  brand?: string | null;
  model?: string | null;
  engineNumber?: string | null;
  color?: string | null;
  mileage?: number | null;
  firstRegistrationDate?: string | null;
  modelYear?: number | null;
  powerKw?: number | null;
  powerCv?: number | null;
  displacement?: number | null;   // cylindrée cm³
  cylinders?: number | null;
  energy?: string | null;         // carburant (Essence / Électrique)
  notes?: string | null;          // transmission, état, options… (bloc structuré)
  reprisePrice?: number;          // prix de reprise (PAHT) — 0 si estimation à faire
  resalePriceTtc?: number | null; // prix de revente affiché
  vatRate?: number;
};

/** Crée une DEMANDE de reprise (appel d'offres aux marchands partenaires) :
 *  fiche véhicule en statut « Demande de reprise » + dossier REP-AAAA-NNNNN.
 *  ⚠️ PAS d'article ni d'entrée en stock à ce stade : le véhicule n'entre en
 *  stock qu'à la VALIDATION de la reprise (validate-api.validateReprise). */
export async function createReprise(p: RepriseInput): Promise<{ vehicleId: string; oroId: string; occNumber: string }> {
  const reprisePrice = p.reprisePrice ?? 0;

  // 1) Fiche véhicule (jointure B9) — statut « Demande de reprise » (repris).
  // Un VIN = une fiche (Simon, 26/11/2026) : une moto déjà connue garde sa fiche et son historique.
  const identity = {
    brand: p.brand ?? null, model: p.model ?? p.designation, engine_number: p.engineNumber ?? null, color: p.color ?? null,
    mileage: p.mileage ?? null, first_registration_date: p.firstRegistrationDate ?? null,
    model_year: p.modelYear ?? null, power_kw: p.powerKw ?? null, power_cv: p.powerCv ?? null,
    displacement: p.displacement ?? null, cylinders: p.cylinders ?? null, energy: p.energy ?? null,
  };
  const prices = { purchase_price: reprisePrice, cost_price: reprisePrice, display_price: p.resalePriceTtc ?? null };
  const vin = (p.vin ?? '').replace(/\s+/g, '').toUpperCase() || null;
  let vehicleId: string | null = null;
  let reused = false;
  if (vin) {
    const { data: known, error: ke } = await supabase.from('vehicles')
      .select('id, status, created_at, notes, ' + Object.keys(identity).join(', '))
      .eq('company_id', p.companyId).eq('vin', vin).limit(20);
    if (ke) throw ke;
    const rows = (known ?? []) as unknown as Array<Record<string, unknown> & { id: string; status: string | null; created_at: string | null }>;
    const openIds = new Set<string>();
    if (rows.length) {
      const { data: dossiers, error: de } = await supabase.from('oro').select('vehicle_id, tradein_status')
        .in('vehicle_id', rows.map((r) => r.id));
      if (de) throw de;
      for (const d of (dossiers ?? []) as unknown as Array<{ vehicle_id: string | null; tradein_status: string | null }>) {
        // Sans statut en base = demande encore en cours (statut déduit à l'écran).
        if (d.vehicle_id && ['', 'ouvert', 'collecte', 'envoye', 'accepte'].includes(d.tradein_status ?? '')) openIds.add(d.vehicle_id);
      }
    }
    const choice = repriseVehicleChoice(rows.map((r) => ({ id: r.id, status: r.status, created_at: r.created_at, openReprise: r.status === 'repris' && openIds.has(r.id) })));
    if (choice.kind === 'refuse') {
      throw new Error(t('tradein.vinAlreadyInDms').replace('{vin}', vin).replace('{status}', t(`vehicles.status_${choice.status}` as never) || choice.status));
    }
    if (choice.kind === 'reuse') {
      const current = rows.find((r) => r.id === choice.id)!;
      const notes = [current.notes, p.notes].filter((x) => typeof x === 'string' && x.trim()).join('\n') || null;
      const { error: ue } = await supabase.from('vehicles')
        .update({ ...repriseFillPatch(current, identity), ...prices, notes, status: 'repris' }).eq('id', choice.id);
      if (ue) throw ue;
      vehicleId = choice.id;
      reused = true;
    }
  }
  if (!vehicleId) {
    const { data: veh, error: ve } = await supabase.from('vehicles').insert({
      company_id: p.companyId, vin, ...identity, notes: p.notes ?? null, ...prices, status: 'repris',
    }).select('id').single();
    if (ve) throw ve;
    vehicleId = veh.id as string;
  }

  // 1b) Lien vendeur (propriétaire précédent) — pour recontacter le client.
  // Non bloquant : ne pas orpheliner une reprise si le lien échoue. Une fiche reprise qui
  // connaît déjà ce client ne reçoit pas une seconde ligne de propriétaire.
  const ownerKnown = reused && p.contactId
    ? ((await supabase.from('vehicle_owners').select('id').eq('vehicle_id', vehicleId).eq('contact_id', p.contactId).limit(1)).data?.length ?? 0) > 0
    : false;
  if (p.contactId && !ownerKnown) {
    await supabase.from('vehicle_owners').insert({
      vehicle_id: vehicleId, contact_id: p.contactId,
      from_date: p.firstRegistrationDate ?? new Date().toISOString().slice(0, 10),
      to_date: new Date().toISOString().slice(0, 10), is_current: false,
    });
  }

  // 2) Ouverture du dossier de reprise — la référence REP sert d'appel d'offres
  // Numéro pris seulement maintenant : une reprise refusée ne laisse pas de trou dans la série REP.
  const occNumber = await nextNumber(p.companyId, 'REP');
  const { data: oro, error: oe } = await supabase.from('oro').insert({
    company_id: p.companyId, number: occNumber, vehicle_id: vehicleId, status: 'ouvert',
  }).select('id').single();
  if (oe) throw oe;

  return { vehicleId, oroId: oro.id as string, occNumber };
}

/** Champs modifiables d'une reprise déjà enregistrée (fiche véhicule). */
export type RepriseVehiclePatch = {
  brand?: string | null;
  model?: string | null;
  vin?: string | null;
  engine_number?: string | null;
  model_year?: number | null;
  first_registration_date?: string | null;
  mileage?: number | null;
  power_cv?: number | null;
  power_kw?: number | null;
  displacement?: number | null;
  energy?: string | null;
  notes?: string | null;
};

/**
 * Met à jour les données d'une reprise (fiche véhicule + désignation de
 * l'article occasion associé) — la reprise reste modifiable à tout moment.
 * Le prix de reprise / coût de revient ne passe PAS par ici (ORO + validation).
 */
export async function updateRepriseVehicle(vehicleId: string, patch: RepriseVehiclePatch): Promise<void> {
  const { data, error } = await supabase
    .from('vehicles').update(patch).eq('id', vehicleId).select('article_id, brand, model').single();
  if (error) throw error;
  // Garde la désignation de l'article occasion alignée sur marque + modèle
  const articleId = (data as { article_id: string | null } | null)?.article_id ?? null;
  const designation = [patch.brand ?? data?.brand, patch.model ?? data?.model].filter(Boolean).join(' ').trim();
  if (articleId && designation) {
    await supabase.from('articles').update({ designation }).eq('id', articleId);
  }
}

export type OroLineInput = { kind: 'piece' | 'mo' | 'frais'; article_id?: string | null; designation: string; quantity: number; unit_cost: number };

/** Ajoute une ligne à un ORO (et sort la pièce du stock si article stocké) puis recalcule le coût de revient. */
export async function addOroLine(oroId: string, companyId: string, l: OroLineInput): Promise<void> {
  const line_cost = Math.round(l.quantity * l.unit_cost * 100) / 100;
  const { error } = await supabase.from('oro_lines').insert({
    oro_id: oroId, kind: l.kind, article_id: l.article_id ?? null, designation: l.designation,
    quantity: l.quantity, unit_cost: l.unit_cost, line_cost,
  });
  if (error) throw error;

  // Pièce stockée → cession de stock vers le véhicule (sortie valorisée, pas une vente).
  if (l.kind === 'piece' && l.article_id && l.quantity > 0) {
    const { error: me } = await supabase.rpc('record_stock_move', {
      // undefined : _unit_cost et _bin sont DEFAULT NULL cote SQL, les omettre equivaut a NULL.
      _article: l.article_id, _type: 'cession', _qty: -Math.abs(l.quantity), _unit_cost: undefined,
      _is_reservation: false, _bin: undefined, _origin: 'oro', _ref: oroId, _note: 'Remise en état occasion',
    });
    if (me) throw me;
  }
  const { error: re } = await supabase.rpc('recompute_oro_and_vehicle', { _oro: oroId });
  if (re) throw re;
}

export async function deleteOroLine(lineId: string, oroId: string): Promise<void> {
  const { error } = await supabase.from('oro_lines').delete().eq('id', lineId);
  if (error) throw error;
  await supabase.rpc('recompute_oro_and_vehicle', { _oro: oroId });
}

export async function closeOro(oroId: string): Promise<void> {
  await supabase.rpc('recompute_oro_and_vehicle', { _oro: oroId });
  const { error } = await supabase.from('oro').update({ status: 'cloture', closed_at: new Date().toISOString() }).eq('id', oroId);
  if (error) throw error;
}
