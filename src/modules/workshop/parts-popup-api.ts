/**
 * Popup « pieces d'entretien manquantes » — acces base (mission 09, carte 3).
 *
 * Calcul : moto → modele-annee du catalogue → plan d'entretien (usage de la moto) → echeance
 * choisie par le motif (meme regle que le check-up, pickServiceForReason) → kit de pieces
 * (`maintenance_kit_for_model_year`, mission 07) → detail du kit avec stock reel, reserve et
 * « en commande » (`maintenance_kit_detail`) → regles pures (parts-popup-rules.ts).
 *
 * Memoire : `workshop_parts_prompts` (migration 20261103120000) : les pieces deja proposees
 * pour le meme OR / RDV ne sont jamais redemandees.
 *
 * Mise en commande : `basket_add_lines(_company, _kind, _lines)` (panier standard / urgent de
 * l'agent « panier standard »). Si la fonction n'est pas en base, REPLI : une commande de
 * pieces (part_orders) en brouillon du type choisi, comme la mission 02, avec une ligne par
 * piece (part_order_line_save). L'appelant est prevenu (`fallback: true`).
 */
import { supabase } from '@/integrations/supabase/client';
import { createPartOrder, saveOrderLine } from '@/modules/orders/api';
import { guardSupplierLines } from '@/modules/articles/supply-guard';
import { getKitDetail, getKitForModelYear } from './kits/api';
import { getPlanServices, listPlansForModelYear, getCatalogModelYear } from './maintenance-api';
import { pickCurrent, planForUsage, DEFAULT_USAGE } from './maintenance-plans';
import { pickServiceForReason } from './checkup/rules';
import {
  DEFAULT_URGENT_WITHIN_DAYS, basketLines, partKey, promptLines, type KitStockLine, type MissingPart, type PopupKind,
} from './parts-popup-rules';

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

const normalizeCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Fonction SQL absente (migration non appliquee) : PostgREST PGRST202, Postgres 42883 / 42P01. */
export function isMissingObject(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = String((e as { message?: string } | null)?.message ?? '');
  return ['PGRST202', '42883', '42P01', '42703', 'PGRST204'].includes(code) || /Could not find the function|does not exist|schema cache/i.test(msg);
}

export type KitContext = { serviceName: string | null; reason: 'no_vehicle' | 'no_catalog' | 'no_plan' | 'no_kit' | null };

/** Pieces du kit de l'echeance avec leur stock (vide si la moto n'est pas reliee au catalogue). */
export async function maintenanceKitStock(companyId: string, vehicleId: string | null, reasonCode: string): Promise<{ lines: KitStockLine[]; ctx: KitContext }> {
  if (!vehicleId) return { lines: [], ctx: { serviceName: null, reason: 'no_vehicle' } };
  const { data: v } = await sb.from('vehicles').select('id, ducati_model_year_id, maintenance_usage').eq('id', vehicleId).maybeSingle();
  const myId = (v as { ducati_model_year_id?: string | null } | null)?.ducati_model_year_id ?? null;
  if (!myId) return { lines: [], ctx: { serviceName: null, reason: 'no_catalog' } };
  const usage = (v as { maintenance_usage?: string | null } | null)?.maintenance_usage ?? DEFAULT_USAGE;
  const [plans, modelYear] = await Promise.all([listPlansForModelYear(myId), getCatalogModelYear(myId)]);
  const plan = planForUsage(plans, usage);
  if (!plan) return { lines: [], ctx: { serviceName: null, reason: 'no_plan' } };
  const services = await getPlanServices(plan.id);
  const year = modelYear?.year ?? null;
  const candidates = services.map((s) => {
    const iv = pickCurrent(s.intervals, year);
    return { id: s.id, code: s.code, name: s.name, kmFirst: iv?.km_first ?? null, kmInterval: iv?.km_interval ?? null, months: iv?.months ?? null };
  });
  const picked = pickServiceForReason(candidates, reasonCode);
  if (!picked) return { lines: [], ctx: { serviceName: null, reason: 'no_plan' } };
  let kitId: string | null = null;
  for (const c of [picked.code, picked.name]) {
    try { kitId = await getKitForModelYear(companyId, myId, normalizeCode(c)); if (kitId) break; } catch { kitId = null; }
  }
  if (!kitId) return { lines: [], ctx: { serviceName: picked.name, reason: 'no_kit' } };
  let items: Awaited<ReturnType<typeof getKitDetail>> = [];
  try { items = await getKitDetail(kitId); } catch { items = []; }
  const lines: KitStockLine[] = items.map((i) => ({
    articleId: i.articleId, reference: i.reference, designation: i.designation, quantity: i.quantity,
    realQty: i.realQty, reservedQty: i.reservedQty, onOrderQty: i.onOrderQty, confidence: i.confidence,
  }));
  return { lines, ctx: { serviceName: picked.name, reason: null } };
}

/** Cles des pieces deja proposees pour cet OR / ce RDV (table absente = rien). */
export async function askedPartKeys(p: { orId?: string | null; appointmentId?: string | null }): Promise<Set<string>> {
  if (!p.orId && !p.appointmentId) return new Set();
  let q = sb.from('workshop_parts_prompts').select('article_id, reference');
  q = p.orId ? q.eq('repair_order_id', p.orId) : q.eq('appointment_id', p.appointmentId);
  const { data, error } = await q;
  if (error) return new Set();
  return new Set(((data ?? []) as { article_id: string | null; reference: string | null }[]).map((r) => partKey({ articleId: r.article_id, reference: r.reference })));
}

/** Reglage « urgente si le RDV est a moins de N jours » (ligne urgente des regles de commande). */
export async function getUrgentWithinDays(companyId: string): Promise<number> {
  const { data } = await sb.from('reference_values').select('extra')
    .eq('company_id', companyId).eq('table_key', 'order_threshold').eq('code', 'urgente').maybeSingle();
  const n = Number((data?.extra as { urgent_within_days?: unknown } | null)?.urgent_within_days);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_URGENT_WITHIN_DAYS;
}

/** Enregistre la decision (commande / ignore) : memoire + trace events. Silencieux si la migration manque. */
export async function logPartsPrompt(p: {
  companyId: string; orId?: string | null; appointmentId?: string | null; missing: MissingPart[];
  decision: 'commande' | 'ignore'; kind?: PopupKind | null; partOrderId?: string | null;
}): Promise<boolean> {
  const { error } = await sb.rpc('workshop_parts_prompt_log', {
    _company: p.companyId, _or: p.orId ?? null, _appointment: p.appointmentId ?? null,
    _lines: promptLines(p.missing), _decision: p.decision, _kind: p.kind ?? null, _part_order: p.partOrderId ?? null,
  });
  if (!error) return true;
  if (isMissingObject(error)) return false;
  throw new Error(error.message);
}

/** `refused` / `substituted` : garde-fou TAR008 (fin de serie retiree, remplacee sous la nouvelle reference). */
export type BasketResult = { partOrderId: string | null; fallback: boolean; lines: number; refused?: string[]; substituted?: string[] };

/**
 * Met les pieces dans le panier du type choisi. `basket_add_lines` absent → commande de pieces
 * en brouillon (mission 02), reliee au client / a la moto de l'OR dans la note.
 */
export async function addMissingToBasket(p: {
  companyId: string; kind: PopupKind; missing: MissingPart[];
  contactId?: string | null; vehicleId?: string | null; orId?: string | null; orNumber?: string | null; note?: string | null;
}): Promise<BasketResult> {
  const raw = basketLines(p.missing);
  if (raw.length === 0) return { partOrderId: null, fallback: false, lines: 0 };
  // Garde-fou TAR008 : pas de fin de serie, une piece remplacee part sous la nouvelle reference.
  const withArticle = raw.filter((l): l is typeof l & { article_id: string } => !!l.article_id);
  const g = await guardSupplierLines(withArticle);
  const lines = [...raw.filter((l) => !l.article_id), ...g.lines];
  if (lines.length === 0) throw new Error(g.refused.join(' '));
  const notes = { refused: g.refused, substituted: g.substituted };
  const { data, error } = await sb.rpc('basket_add_lines', {
    _company: p.companyId, _kind: p.kind,
    _lines: lines.map((l) => ({ ...l, repair_order_id: p.orId ?? null, contact_id: p.contactId ?? null, vehicle_id: p.vehicleId ?? null, note: p.note ?? null })),
  });
  if (!error) {
    const id = typeof data === 'string' ? data : ((data as { basket_id?: string; id?: string } | null)?.basket_id ?? (data as { id?: string } | null)?.id ?? null);
    return { partOrderId: id, fallback: false, lines: lines.length, ...notes };
  }
  if (!isMissingObject(error)) throw new Error(error.message);

  // Repli mission 02 : commande de pieces en brouillon du type choisi.
  const ids = lines.map((l) => l.article_id).filter((x): x is string => !!x);
  const { data: arts } = ids.length ? await sb.from('articles').select('id, sale_price_ht, vat_rate, main_supplier_id').in('id', ids) : { data: [] };
  const byId = new Map(((arts ?? []) as { id: string; sale_price_ht: number | null; vat_rate: number | null; main_supplier_id: string | null }[]).map((a) => [a.id, a]));
  const orderId = await createPartOrder({
    companyId: p.companyId, orderKind: p.kind, contactId: p.contactId ?? null, channel: 'comptoir',
    notes: [p.note, p.orNumber ? `OR ${p.orNumber}` : null].filter(Boolean).join(' — ') || null,
  });
  for (const l of lines) {
    const a = l.article_id ? byId.get(l.article_id) : undefined;
    await saveOrderLine({
      orderId, articleId: l.article_id, designation: l.designation, supplierId: a?.main_supplier_id ?? null,
      qtyClient: p.contactId ? l.qty : 0, qtyShop: p.contactId ? 0 : l.qty,
      unitPriceHt: Number(a?.sale_price_ht ?? 0), vatRate: Number(a?.vat_rate ?? 21),
    });
  }
  return { partOrderId: orderId, fallback: true, lines: lines.length, ...notes };
}
