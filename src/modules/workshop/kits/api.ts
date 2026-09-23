/**
 * M8 — Kits de pièces d'entretien : accès base (mission 07, carte 2).
 *
 * Toutes les écritures passent par les fonctions SQL `maintenance_kit_*`,
 * `picking_open_for_repair_order` et `part_order_create_for_workshop` : règles + trace
 * dans `events`. L'application n'écrit jamais dans les tables de kits.
 *
 * Les migrations 20260923160000 à 20260923163000 ne sont pas encore appliquées :
 * `types.ts` ne connaît donc pas ces fonctions. On passe par un appel non typé
 * (même parade que `journey/source.ts`), avec des types explicites côté lecture.
 * À régénérer une fois les migrations appliquées.
 */
import { supabase } from '@/integrations/supabase/client';
import type { OrderNeed } from '@/modules/orders/from-document';
import type { KitItem } from './rules';

type LooseResult = { data: unknown; error: { message: string } | null };
const loose = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<LooseResult> };

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await loose.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// --------------------------------------------------------------------------
// Les kits
// --------------------------------------------------------------------------

export type KitRow = {
  id: string;
  engineFamilyKey: string;
  engineFamilyLabel: string;
  serviceCode: string;
  serviceLabel: string;
  version: number;
  status: string;
  editedAt: string | null;
  editedByName: string | null;
  itemsCount: number;
  toConfirmCount: number;
  modelYearsCount: number;
  updatedAt: string;
};

export async function listKits(companyId: string, search?: string | null): Promise<KitRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('maintenance_kits_list', {
    _company: companyId, _search: search ?? null,
  });
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    engineFamilyKey: String(r.engine_family_key),
    engineFamilyLabel: String(r.engine_family_label),
    serviceCode: String(r.service_code),
    serviceLabel: String(r.service_label),
    version: num(r.version),
    status: String(r.status),
    editedAt: (r.edited_at as string) ?? null,
    editedByName: (r.edited_by_name as string) ?? null,
    itemsCount: num(r.items_count),
    toConfirmCount: num(r.to_confirm_count),
    modelYearsCount: num(r.model_years_count),
    updatedAt: String(r.updated_at),
  }));
}

export type KitDetailLine = KitItem & {
  mgmtType: string | null;
  bins: string[];
  realQty: number;
  reservedQty: number;
  onOrderQty: number;
  fluidProduct: string | null;
  fluidSpec: string | null;
  note: string | null;
  sortOrder: number;
};

export async function getKitDetail(kitId: string): Promise<KitDetailLine[]> {
  const rows = await rpc<Record<string, unknown>[]>('maintenance_kit_detail', { _kit: kitId });
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    familyCode: (r.family_code as string) ?? null,
    articleId: (r.article_id as string) ?? null,
    reference: (r.reference as string) ?? null,
    designation: String(r.designation),
    quantity: num(r.quantity),
    unit: (r.unit as string) ?? null,
    kind: (r.kind as KitItem['kind']) ?? 'piece',
    confidence: (r.confidence as KitItem['confidence']) ?? 'sur',
    origin: (r.origin as KitItem['origin']) ?? 'deduit',
    mgmtType: (r.mgmt_type as string) ?? null,
    bins: (r.bins as string[]) ?? [],
    realQty: num(r.real_qty),
    reservedQty: num(r.reserved_qty),
    onOrderQty: num(r.on_order_qty),
    fluidProduct: (r.fluid_product as string) ?? null,
    fluidSpec: (r.fluid_spec as string) ?? null,
    note: (r.note as string) ?? null,
    sortOrder: num(r.sort_order),
  }));
}

export type KitGenerationResult = {
  modelYears: number; created: number; reused: number; linked: number; skipped: number;
  nextOffset: number; done: boolean;
};

/**
 * Génère les kits par lots. Le `statement_timeout` du serveur est à 8 s : on avance
 * par tranches de modèles-années et on boucle côté écran (motif `tools/accessories-loader`).
 */
export async function generateKits(
  companyId: string, limit = 20, offset = 0, modelYearId?: string | null,
): Promise<KitGenerationResult> {
  const r = await rpc<Record<string, unknown>>('maintenance_kit_generate', {
    _company: companyId, _limit: limit, _offset: offset, _model_year: modelYearId ?? null,
  });
  return {
    modelYears: num(r?.model_years), created: num(r?.created), reused: num(r?.reused),
    linked: num(r?.linked), skipped: num(r?.skipped), nextOffset: num(r?.next_offset),
    done: r?.done === true,
  };
}

export async function saveKitItem(p: {
  kitId: string; itemId?: string | null; articleId?: string | null;
  quantity: number; designation?: string | null; note?: string | null;
}): Promise<string> {
  return rpc<string>('maintenance_kit_item_save', {
    _kit: p.kitId, _item: p.itemId ?? null, _article: p.articleId ?? null,
    _quantity: p.quantity, _designation: p.designation ?? null, _note: p.note ?? null,
  });
}

export async function deleteKitItem(itemId: string): Promise<void> {
  await rpc<null>('maintenance_kit_item_delete', { _item: itemId });
}

export async function setFluidArticle(companyId: string, familyCode: string, articleId: string | null): Promise<void> {
  await rpc<null>('maintenance_fluid_article_set', {
    _company: companyId, _family: familyCode, _article: articleId,
  });
}

export async function getKitForModelYear(
  companyId: string, modelYearId: string, serviceCode: string,
): Promise<string | null> {
  const id = await rpc<string | null>('maintenance_kit_for_model_year', {
    _company: companyId, _model_year_id: modelYearId, _service_code: serviceCode,
  });
  return id ?? null;
}

export type PartsCoverage = {
  modelYears: number; modelYearsWithParts: number; services: number;
  needs: number; needsFirm: number; resolvedFirm: number; toConfirm: number;
  optionalResolved: number; byFamily: Record<string, { needs: number; resolved: number }>;
};

export async function getPartsCoverage(limit = 40, offset = 0): Promise<PartsCoverage> {
  const r = await rpc<Record<string, unknown>>('maintenance_parts_coverage', { _limit: limit, _offset: offset });
  return {
    modelYears: num(r?.model_years), modelYearsWithParts: num(r?.model_years_with_parts),
    services: num(r?.services), needs: num(r?.needs), needsFirm: num(r?.needs_firm),
    resolvedFirm: num(r?.resolved_firm), toConfirm: num(r?.to_confirm),
    optionalResolved: num(r?.optional_resolved),
    byFamily: (r?.by_family as PartsCoverage['byFamily']) ?? {},
  };
}

// --------------------------------------------------------------------------
// Picking list depuis l'OR
// --------------------------------------------------------------------------

/** Crée (ou complète) la liste de préparation de l'OR : kit + pièces du technicien. */
export async function openPickingForRepairOrder(orId: string): Promise<string> {
  return rpc<string>('picking_open_for_repair_order', { _or: orId });
}

/** La liste de préparation déjà ouverte pour cet OR, s'il y en a une. */
export async function findPickingForRepairOrder(orId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('picking_lists')
    .select('id')
    // colonne ajoutée par 20260923162000 : inconnue de types.ts tant que la migration n'est pas appliquée
    .eq('repair_order_id' as never, orId as never)
    .maybeSingle();
  if (error) return null;
  return (data as { id: string } | null)?.id ?? null;
}

// --------------------------------------------------------------------------
// Commander les pièces manquantes
// --------------------------------------------------------------------------

/** Même forme que `document_order_needs` (module orders), plus l'origine de la ligne. */
export type WorkshopNeed = OrderNeed & { origin: string };

function mapNeeds(rows: Record<string, unknown>[]): WorkshopNeed[] {
  return (rows ?? []).map((r) => ({
    articleId: String(r.article_id),
    reference: (r.reference as string) ?? '',
    designation: (r.designation as string) ?? '',
    mgmtType: (r.mgmt_type as string) ?? '',
    lineIds: [],
    qtyNeeded: num(r.qty_needed),
    realQty: num(r.real_qty),
    reservedQty: num(r.reserved_qty),
    freeQty: num(r.free_qty),
    onOrderQty: num(r.on_order_qty),
    draftQty: num(r.draft_qty),
    missingQty: num(r.missing_qty),
    supplierId: (r.supplier_id as string) ?? null,
    supplierName: (r.supplier_name as string) ?? null,
    unitPriceHt: num(r.unit_price_ht),
    vatRate: num(r.vat_rate),
    bin: (r.bin_location as string) ?? null,
    origin: (r.origin as string) ?? 'kit',
  }));
}

export async function getRepairOrderNeeds(orId: string): Promise<WorkshopNeed[]> {
  return mapNeeds(await rpc<Record<string, unknown>[]>('repair_order_order_needs', { _or: orId }));
}

export async function getPickingNeeds(pickingId: string): Promise<WorkshopNeed[]> {
  return mapNeeds(await rpc<Record<string, unknown>[]>('picking_order_needs', { _picking: pickingId }));
}

/** Crée la commande de pièces (brouillon) avec LE TYPE CHOISI, reliée à l'OR. */
export async function createPartOrderForWorkshop(p: {
  orId?: string | null;
  pickingId?: string | null;
  kind: string;
  channel: 'comptoir' | 'mail';
  lines: { article_id: string; qty_client: number; qty_shop: number; supplier_id: string | null; unit_price_ht: number }[];
  notes?: string | null;
}): Promise<string> {
  return rpc<string>('part_order_create_for_workshop', {
    _or: p.orId ?? null,
    _picking: p.pickingId ?? null,
    _kind: p.kind,
    _channel: p.channel,
    _lines: p.lines,
    _notes: p.notes ?? null,
  });
}
