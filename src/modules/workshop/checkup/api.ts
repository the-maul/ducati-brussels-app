/**
 * M8 — Check-up a l'accueil, proposition d'intervention, accord client, interventions
 * reportees : ACCES BASE (ATE008 / ATE009, decision client du 30/10/2026).
 *
 * Les ecritures de parcours passent par les fonctions SQL de la migration 20261031110000
 * (`proposal_create_from_or`, `proposal_sign_link`, `repair_order_verbal_approval`) : regles +
 * trace dans `events` en une transaction. Les photos du check-up vont dans la GED de l'OR
 * (bucket `ged`, dossier « Check-up »), jamais en base64 en base.
 *
 * `types.ts` ne connait pas encore ces fonctions ni ces colonnes (migration non appliquee) :
 * appels non types, meme parade que `workshop/kits/api.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { clientAppUrl } from '@/lib/client-app-url';
import { compressImageFile } from '@/lib/image-tools';
import { uploadAttachment, signedUrl } from '@/modules/documents/ged-api';
import { listRef } from '@/modules/settings/reference-api';
import { getKitDetail, getKitForModelYear } from '../kits/api';
import { getPlanServices, listPlansForModelYear, getCatalogModelYear, loadHourlyRateHt } from '../maintenance-api';
import { pickCurrent, planForUsage, DEFAULT_USAGE } from '../maintenance-plans';
import { blankCard, blankPart, pickServiceForReason, newCheckupKey, type CheckupCard } from './rules';

type LooseResult = { data: unknown; error: { code?: string; message: string } | null };
/** Requete sur une table inconnue de types.ts (deferred_interventions, vehicle_maintenance_due). */
type LooseBuilder = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseBuilder;
  update: (values: Record<string, unknown>) => LooseBuilder;
  eq: (col: string, value: unknown) => LooseBuilder;
  in: (col: string, values: unknown[]) => LooseBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => LooseBuilder;
  limit: (n: number) => LooseBuilder;
  maybeSingle: () => Promise<LooseResult>;
};
const loose = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<LooseResult>;
  from: (table: string) => LooseBuilder;
};

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
// Motif d'entree (Parametres → Tables → Motifs d'entree atelier)
// --------------------------------------------------------------------------

export const WORKSHOP_REASON_TABLE_KEY = 'workshop_reason';

/** Memes valeurs que celles prechargees par la migration (repli tant qu'elle n'est pas posee). */
export const DEFAULT_WORKSHOP_REASONS: { code: string; label: string }[] = [
  { code: 'entretien_annuel', label: 'Entretien annuel' },
  { code: 'entretien_1000', label: 'Entretien 1 000 km' },
  { code: 'entretien_15000', label: 'Entretien 15 000 km' },
  { code: 'entretien_30000', label: 'Entretien 30 000 km' },
  { code: 'vidange', label: 'Vidange' },
  { code: 'pneus', label: 'Pneus' },
  { code: 'freins', label: 'Freins' },
  { code: 'accident', label: 'Accident' },
  { code: 'garantie', label: 'Garantie' },
  { code: 'diagnostic', label: 'Diagnostic' },
  { code: 'autre', label: 'Autre' },
];

export async function listWorkshopReasons(companyId: string): Promise<{ code: string; label: string }[]> {
  try {
    const rows = await listRef(companyId, WORKSHOP_REASON_TABLE_KEY);
    const active = rows.filter((r) => r.is_active).map((r) => ({ code: r.code, label: r.label }));
    return active.length ? active : DEFAULT_WORKSHOP_REASONS;
  } catch {
    return DEFAULT_WORKSHOP_REASONS;
  }
}

// --------------------------------------------------------------------------
// Photos (GED de l'OR, dossier « Check-up »)
// --------------------------------------------------------------------------

export const CHECKUP_GED_FOLDER = 'Check-up';

/** Reduit la photo (2 000 px, JPEG) puis la depose dans la GED de l'OR ; renvoie le chemin. */
export async function uploadCheckupPhoto(companyId: string, orId: string, file: File, label: string): Promise<string> {
  const compact = await compressImageFile(file, 'upload');
  const note = label.trim() ? `${CHECKUP_GED_FOLDER} - ${label.trim()}` : CHECKUP_GED_FOLDER;
  return uploadAttachment(companyId, 'repair_order', orId, compact, Date.now(), note, CHECKUP_GED_FOLDER);
}

/** URL signee (1 h) d'une photo du check-up, null si illisible. */
export async function checkupPhotoUrl(path: string): Promise<string | null> {
  try { return await signedUrl(path); } catch { return null; }
}

// --------------------------------------------------------------------------
// Pre-remplissage depuis le plan d'entretien de la moto (plans + kits, mission 07)
// --------------------------------------------------------------------------

export type PrefillResult = { cards: CheckupCard[]; serviceName: string | null; reason: 'no_vehicle' | 'no_catalog' | 'no_plan' | null };

/**
 * Motif « entretien » : l'echeance du plan de la moto (usage route par defaut) donne une carte
 * « Entretien … » (temps Ducati en vigueur x taux horaire + pieces du kit) puis une carte par
 * operation du plan. Rien n'est invente : sans plan, aucune carte.
 */
export async function prefillFromMaintenancePlan(companyId: string, vehicleId: string | null, reasonCode: string): Promise<PrefillResult> {
  if (!vehicleId) return { cards: [], serviceName: null, reason: 'no_vehicle' };
  const { data: v } = await supabase.from('vehicles')
    .select('id, ducati_model_year_id, maintenance_usage').eq('id', vehicleId).maybeSingle();
  const myId = (v as { ducati_model_year_id?: string | null } | null)?.ducati_model_year_id ?? null;
  if (!myId) return { cards: [], serviceName: null, reason: 'no_catalog' };
  const usage = (v as { maintenance_usage?: string | null } | null)?.maintenance_usage ?? DEFAULT_USAGE;

  const [plans, modelYear, rate] = await Promise.all([
    listPlansForModelYear(myId), getCatalogModelYear(myId), loadHourlyRateHt(companyId),
  ]);
  const plan = planForUsage(plans, usage);
  if (!plan) return { cards: [], serviceName: null, reason: 'no_plan' };
  const services = await getPlanServices(plan.id);
  const year = modelYear?.year ?? null;
  const candidates = services.map((s) => {
    const iv = pickCurrent(s.intervals, year);
    return { id: s.id, code: s.code, name: s.name, kmFirst: iv?.km_first ?? null, kmInterval: iv?.km_interval ?? null, months: iv?.months ?? null, raw: s };
  });
  const picked = pickServiceForReason(candidates, reasonCode);
  if (!picked) return { cards: [], serviceName: null, reason: 'no_plan' };
  const time = pickCurrent(picked.raw.times, year);
  const hours = time?.hours != null ? num(time.hours) : 0;

  // Pieces du kit de l'echeance (si les kits de la mission 07 sont en base et retrouvent l'echeance).
  const parts = await kitPartsFor(companyId, myId, [picked.code, picked.name]);

  const head = blankCard({
    label: picked.name, state: 'a_faire', hours, hourly_rate_ht: rate ?? null, parts, origin: 'plan', suggested_hours: hours || null,
  });
  const ops = picked.raw.operations
    .map((o) => String((o as { text?: string | null; label?: string | null }).text ?? (o as { label?: string | null }).label ?? '').trim())
    .filter(Boolean)
    .map((text) => blankCard({ label: text, state: 'a_faire', hours: 0, hourly_rate_ht: rate ?? null, origin: 'plan' }));
  return { cards: [head, ...ops], serviceName: picked.name, reason: null };
}

const normalizeCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Pieces du kit d'entretien (famille de moteur x echeance) → pieces de la carte, au prix de vente. */
async function kitPartsFor(companyId: string, modelYearId: string, codes: string[]): Promise<CheckupCard['parts']> {
  let kitId: string | null = null;
  for (const c of codes) {
    try {
      kitId = await getKitForModelYear(companyId, modelYearId, normalizeCode(c));
      if (kitId) break;
    } catch { kitId = null; }
  }
  if (!kitId) return [];
  try {
    const items = (await getKitDetail(kitId)).filter((i) => i.articleId && i.confidence === 'sur');
    if (!items.length) return [];
    const ids = items.map((i) => i.articleId as string);
    const { data: arts } = await supabase.from('articles').select('id, reference, designation, sale_price_ht, vat_rate').in('id', ids);
    const byId = new Map((arts ?? []).map((a) => [a.id, a]));
    return items.map((i) => {
      const a = byId.get(i.articleId as string);
      return blankPart({
        article_id: i.articleId, reference: a?.reference ?? i.reference, designation: a?.designation ?? i.designation,
        quantity: i.quantity || 1, unit_price_ht: num(a?.sale_price_ht), vat_rate: num(a?.vat_rate) || 21,
      });
    });
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// Prochain entretien (table de l'agent « dates d'entretien » : lecture silencieuse)
// --------------------------------------------------------------------------

export type MaintenanceDue = { label: string | null; due_date: string | null; due_km: number | null } | null;

export async function vehicleMaintenanceDue(vehicleId: string): Promise<MaintenanceDue> {
  try {
    const { data, error } = await loose.from('vehicle_maintenance_due').select('*').eq('vehicle_id', vehicleId).limit(1).maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    return {
      label: (r.service_label as string) ?? (r.label as string) ?? null,
      due_date: (r.due_date as string) ?? null,
      due_km: r.due_km != null ? num(r.due_km) : null,
    };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Proposition d'intervention, lien de signature, accord verbal
// --------------------------------------------------------------------------

export type ProposalCreated = { documentId: string; number: string | null; token: string; lines: number };

/** « Envoyer la proposition » : devis Proposition d'intervention cree depuis les actions a faire / a prevoir. */
export async function createProposalFromOr(orId: string): Promise<ProposalCreated> {
  const r = await rpc<Record<string, unknown>>('proposal_create_from_or', { _or: orId });
  return { documentId: String(r.document_id), number: (r.number as string) ?? null, token: String(r.token), lines: num(r.lines) };
}

/** Jeton de signature (renouvele s'il a expire). */
export async function getProposalSignToken(documentId: string): Promise<string> {
  return rpc<string>('proposal_sign_link', { _document: documentId });
}

/** Adresse publique du lien de signature (cote client : VITE_CLIENT_APP_URL). */
export function proposalSignUrl(token: string): string {
  return `${clientAppUrl()}/signer/${token}`;
}

export type VerbalApprovalInput = { byName: string; at: string; channel: 'telephone' | 'comptoir' | 'mail'; note: string };

export async function recordVerbalApproval(orId: string, p: VerbalApprovalInput): Promise<void> {
  await rpc<null>('repair_order_verbal_approval', {
    _or: orId, _by_name: p.byName, _at: p.at || null, _channel: p.channel, _note: p.note || null,
  });
}

/** La proposition reliee a l'OR (numero, etat, signature), null s'il n'y en a pas. */
export type ProposalSummary = {
  id: string; number: string | null; status: string; accepted_at: string | null; total_ttc: number; issue_date: string;
  sign_token_expires_at: string | null;
};

export async function getOrProposal(documentId: string | null | undefined): Promise<ProposalSummary | null> {
  if (!documentId) return null;
  const { data, error } = await supabase.from('documents')
    .select('id, number, status, total_ttc, issue_date, accepted_at, sign_token_expires_at' as never).eq('id', documentId).maybeSingle();
  if (error || !data) return null;
  const d = data as unknown as Record<string, unknown>;
  return {
    id: String(d.id), number: (d.number as string) ?? null, status: String(d.status), total_ttc: num(d.total_ttc),
    issue_date: String(d.issue_date), accepted_at: (d.accepted_at as string) ?? null,
    sign_token_expires_at: (d.sign_token_expires_at as string) ?? null,
  };
}

// --------------------------------------------------------------------------
// Interventions reportees
// --------------------------------------------------------------------------

export type DeferredStatus = 'a_planifier' | 'planifie' | 'relance' | 'fait' | 'abandonne';

export type DeferredIntervention = {
  id: string; company_id: string; vehicle_id: string | null; contact_id: string | null; repair_order_id: string | null;
  document_id: string | null; document_line_id: string | null; label: string; amount_ttc: number;
  planned_date: string | null; status: DeferredStatus; created_at: string; updated_at: string;
};

const mapDeferred = (r: Record<string, unknown>): DeferredIntervention => ({
  id: String(r.id), company_id: String(r.company_id), vehicle_id: (r.vehicle_id as string) ?? null,
  contact_id: (r.contact_id as string) ?? null, repair_order_id: (r.repair_order_id as string) ?? null,
  document_id: (r.document_id as string) ?? null, document_line_id: (r.document_line_id as string) ?? null,
  label: String(r.label ?? ''), amount_ttc: num(r.amount_ttc), planned_date: (r.planned_date as string) ?? null,
  status: (r.status as DeferredStatus) ?? 'a_planifier', created_at: String(r.created_at), updated_at: String(r.updated_at),
});

export async function listDeferredInterventions(filter: { vehicleId?: string; contactId?: string; repairOrderId?: string }): Promise<DeferredIntervention[]> {
  try {
    let q = loose.from('deferred_interventions').select('*').order('created_at', { ascending: false });
    if (filter.vehicleId) q = q.eq('vehicle_id', filter.vehicleId);
    if (filter.contactId) q = q.eq('contact_id', filter.contactId);
    if (filter.repairOrderId) q = q.eq('repair_order_id', filter.repairOrderId);
    const { data, error } = await q;
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[]).map(mapDeferred);
  } catch {
    return [];
  }
}

/** Interventions reportees encore a planifier pour cette moto (etape du comptoir a la facturation). */
export async function listDeferredToPlan(vehicleId: string): Promise<DeferredIntervention[]> {
  return (await listDeferredInterventions({ vehicleId })).filter((d) => d.status === 'a_planifier');
}

/** Fixe la date convenue au comptoir : les interventions passent « planifiees ». */
export async function planDeferredInterventions(ids: string[], plannedDate: string): Promise<void> {
  if (!ids.length) return;
  const { error } = await loose.from('deferred_interventions')
    .update({ planned_date: plannedDate, status: 'planifie' }).in('id', ids);
  if (error) throw new Error(error.message);
}

export async function setDeferredStatus(id: string, status: DeferredStatus, plannedDate?: string | null): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (plannedDate !== undefined) patch.planned_date = plannedDate;
  const { error } = await loose.from('deferred_interventions').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Nouvelle cle de carte exposee a l'ecran (pour les constats ajoutes a la main). */
export const nextCardKey = () => newCheckupKey();
