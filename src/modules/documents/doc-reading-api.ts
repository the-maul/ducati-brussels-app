/**
 * M9 (Simon, 26/11/2026) — lecture automatique des fichiers de la fiche client / moto.
 * 1. readAttachment : la fonction serveur read-id-doc (mode « document ») lit le fichier, le range
 *    et garde ce qu'elle a lu sur le fichier (attachments.doc_kind / extracted / read_at / read_status).
 * 2. loadReadingContext : valeurs actuelles des fiches concernées (client, moto, certifications DCS, banques).
 * 3. applyReading : écrit SEULEMENT les propositions choisies par l'utilisateur, avec une trace dans
 *    events (fichier source compris). Règles pures : doc-reading-rules.ts.
 */
import { supabase } from '@/integrations/supabase/client';
import { setVehicleFinancing } from '@/modules/vehicles/fiche-g8-api';
import type { Attachment } from './ged-api';
import {
  pickVehicle, planWrites, type Bank, type ContactSnapshot, type DocKind, type DocReading, type Proposal,
  type ReadingContext, type VehicleSnapshot,
} from './doc-reading-rules';

export type DocReadErrorCode =
  | 'not_configured' | 'not_deployed' | 'no_credit' | 'unsupported' | 'too_large' | 'refused' | 'read_failed' | 'forbidden';
export class DocReadError extends Error {
  constructor(public code: DocReadErrorCode) { super(code); }
}

/** Colonnes ajoutées par la migration 20261126280000 (hors types générés tant qu'ils ne sont pas régénérés). */
export type ReadableAttachment = Attachment & {
  doc_kind?: DocKind | null; extracted?: DocReading | null; read_at?: string | null; read_status?: string | null;
};

const KNOWN: DocReadErrorCode[] = ['not_configured', 'no_credit', 'unsupported', 'too_large', 'refused', 'read_failed', 'forbidden'];

async function errorCode(error: unknown): Promise<DocReadErrorCode> {
  const e = error as { name?: string; message?: string; context?: { json?: () => Promise<unknown>; status?: number } };
  const status = e.context?.status;
  if (e.context?.json) {
    const body = await e.context.json().catch(() => null) as { error?: string } | null;
    const c = body?.error as DocReadErrorCode | undefined;
    if (c && KNOWN.includes(c)) return c;
  }
  if (status === 404 || /FunctionsFetchError|FunctionsRelayError/.test(e.name ?? '') || /Failed to send|not found/i.test(e.message ?? '')) return 'not_deployed';
  if (status === 403) return 'forbidden';
  return 'read_failed';
}

/** Lit un fichier déjà dans la GED. keepFolder : l'utilisateur a choisi le dossier, on ne range pas. */
export async function readAttachment(attachmentId: string, keepFolder: boolean): Promise<{ doc_kind: DocKind; folder: string | null; extracted: DocReading }> {
  const { data, error } = await supabase.functions.invoke('read-id-doc', {
    body: { mode: 'document', attachment_id: attachmentId, keep_folder: keepFolder },
  });
  if (error) throw new DocReadError(await errorCode(error));
  const body = data as { data?: { doc_kind: DocKind; folder: string | null; extracted: DocReading }; error?: string } | null;
  if (body?.error) throw new DocReadError(KNOWN.includes(body.error as DocReadErrorCode) ? body.error as DocReadErrorCode : 'read_failed');
  if (!body?.data) throw new DocReadError('read_failed');
  return body.data;
}

type Res = { data: unknown; error: { message: string; code?: string } | null };
type Q = PromiseLike<Res> & {
  eq: (c: string, v: unknown) => Q; in: (c: string, v: unknown[]) => Q; limit: (n: number) => Q;
  maybeSingle: () => PromiseLike<Res>;
};
const loose = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => Q;
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<Res> };
    insert: (v: Record<string, unknown> | Record<string, unknown>[]) => PromiseLike<Res>;
  };
};
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

const CONTACT_COLS = 'id, first_name, last_name, company_name, contact_name, address, street_number, zip, city, email, mobile, phone, gsm, birth_date, vat_number, license_number, license_date';
const VEHICLE_COLS = 'id, vin, plate, plate_custom, engine_number, type_mine, brand, model, category, model_year, first_registration_date, warranty_type, warranty_plan, warranty_start, warranty_end, financing_contact_id, financing_contract, insurance, next_inspection_date';

async function contactById(id: string): Promise<ContactSnapshot | null> {
  const { data, error } = await loose.from('contacts').select(CONTACT_COLS).eq('id', id).maybeSingle();
  fail(error);
  return (data as ContactSnapshot | null) ?? null;
}

/** Valeurs actuelles : la fiche ouverte + la fiche liée (moto du client par VIN/plaque, ou propriétaire de la moto). */
export async function loadReadingContext(companyId: string, entityType: 'contact' | 'vehicle', entityId: string, reading: DocReading): Promise<ReadingContext> {
  let contact: ContactSnapshot | null = null;
  let vehicle: VehicleSnapshot | null = null;
  if (entityType === 'contact') {
    contact = await contactById(entityId);
    const { data: owned, error } = await loose.from('vehicle_owners').select('vehicle_id').eq('contact_id', entityId).eq('is_current', true).limit(200);
    fail(error);
    const ids = ((owned ?? []) as { vehicle_id: string }[]).map((o) => o.vehicle_id);
    if (ids.length > 0) {
      const { data: vs, error: ve } = await loose.from('vehicles').select(VEHICLE_COLS).in('id', ids);
      fail(ve);
      vehicle = pickVehicle(reading, (vs ?? []) as VehicleSnapshot[]);
    }
  } else {
    const { data: v, error } = await loose.from('vehicles').select(VEHICLE_COLS).eq('id', entityId).maybeSingle();
    fail(error);
    vehicle = (v as VehicleSnapshot | null) ?? null;
    // Le propriétaire est le motard (vehicle_owners) ; la banque n'est jamais propriétaire.
    const { data: own, error: oe } = await loose.from('vehicle_owners').select('contact_id').eq('vehicle_id', entityId).eq('is_current', true).limit(1);
    fail(oe);
    const ownerId = ((own ?? []) as { contact_id: string }[])[0]?.contact_id;
    if (ownerId) contact = await contactById(ownerId);
  }
  let certified: string[] = [];
  if (vehicle) {
    const { data: st } = await loose.from('vehicle_field_status').select('field').eq('vehicle_id', vehicle.id).eq('status', 'certifie');
    certified = ((st ?? []) as { field: string }[]).map((s) => s.field);
  }
  const { data: bk } = await loose.from('contacts').select('id, company_name, contact_name, last_name')
    .eq('company_id', companyId).eq('type', 'banque_leasing').limit(1000);
  const banks: Bank[] = ((bk ?? []) as { id: string; company_name: string | null; contact_name: string | null; last_name: string | null }[])
    .map((b) => ({ id: b.id, name: b.company_name || b.contact_name || b.last_name || '' })).filter((b) => b.name);
  return { entityType, contact, vehicle, certified, banks };
}

/**
 * Écrit les propositions choisies (un clic de l'utilisateur) et trace chaque fiche modifiée dans
 * events, avec le fichier source. Renvoie le nombre de valeurs écrites.
 */
export async function applyReading(companyId: string, ctx: ReadingContext, proposals: Proposal[], chosen: string[], source: ReadableAttachment): Promise<number> {
  const plan = planWrites(proposals, chosen, {
    contactId: (ctx.vehicle?.financing_contact_id as string | null | undefined) ?? null,
    contract: (ctx.vehicle?.financing_contract as string | null | undefined) ?? null,
  });
  const { data: { user } } = await supabase.auth.getUser();
  const src = { attachment_id: source.id, file_name: source.file_name, storage_path: source.storage_path, doc_kind: source.doc_kind ?? null };
  const events: Record<string, unknown>[] = [];
  let n = 0;
  if (ctx.contact && Object.keys(plan.contact).length > 0) {
    const { error } = await loose.from('contacts').update(plan.contact).eq('id', ctx.contact.id);
    fail(error);
    n += Object.keys(plan.contact).length;
    events.push({ company_id: companyId, actor_id: user?.id ?? null, action: 'document.values_applied', entity_type: 'contact',
      entity_id: ctx.contact.id, origin: 'lecture_document', old_data: plan.old.contact, new_data: { ...plan.contact, source: src } });
  }
  if (ctx.vehicle && (Object.keys(plan.vehicle).length > 0 || plan.financing)) {
    if (Object.keys(plan.vehicle).length > 0) {
      const { error } = await loose.from('vehicles').update(plan.vehicle).eq('id', ctx.vehicle.id);
      fail(error);
      n += Object.keys(plan.vehicle).length;
    }
    if (plan.financing) { await setVehicleFinancing(ctx.vehicle.id, plan.financing); n += 1; }
    events.push({ company_id: companyId, actor_id: user?.id ?? null, action: 'document.values_applied', entity_type: 'vehicle',
      entity_id: ctx.vehicle.id, origin: 'lecture_document', old_data: plan.old.vehicle,
      new_data: { ...plan.vehicle, ...(plan.financing ? { financing_contact_id: plan.financing.contactId, financing_contract: plan.financing.contract || null } : {}), source: src } });
  }
  if (events.length > 0) {
    const { error } = await loose.from('events').insert(events);
    fail(error);
  }
  return n;
}
