/**
 * M1 — Rattrapage G8 « clients » (18/11/2026) : accès base.
 * Tables et fonctions des migrations 20261118220000 (RGPD), 221000 (fiche, groupes, vente
 * groupement), 222000 (cascade, extraction, campagnes en essai). `types.ts` n'est pas régénéré :
 * on type ici localement. Avant les migrations, les lectures renvoient vide et l'écran le dit
 * (`isMissingSchema`).
 */
import { supabase } from '@/integrations/supabase/client';
import type { ConsentRow, ExtractionCriteria } from './rules';
import { criteriaPayload } from './rules';

type PgError = { message: string; code?: string; details?: string; hint?: string } | null;
type Res<T> = PromiseLike<{ data: T; error: PgError }>;
// Client sans types générés pour les nouvelles tables (même pratique que src/modules/orders/api.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any; rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Res<T> };

/** Table / fonction absente : migration pas encore appliquée. */
export function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = String((e as { message?: string } | null)?.message ?? '');
  return ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'].includes(code) || /Could not find|does not exist|schema cache/i.test(msg);
}

/** Erreur de base -> Error portant le code (les écrans traduisent CODE_* via le dictionnaire). */
function fail(e: PgError): never {
  const err = new Error(e?.message ?? 'erreur') as Error & { code?: string };
  err.code = e?.code;
  throw err;
}

/** Code métier d'une erreur (« CONSENT_IMMUTABLE », « FORBIDDEN »...) ou null. */
export function errorCode(e: unknown): string | null {
  const msg = String((e as { message?: string } | null)?.message ?? '');
  const m = msg.match(/\b([A-Z]+(?:_[A-Z]+)+)\b/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ RGPD */

export async function listConsents(contactId: string): Promise<{ rows: ConsentRow[]; missing: boolean }> {
  const { data, error } = await sb.from('contact_consents').select('*').eq('contact_id', contactId)
    .order('declared_at', { ascending: false }).order('created_at', { ascending: false });
  if (error) { if (isMissingSchema(error)) return { rows: [], missing: true }; fail(error); }
  return { rows: (data ?? []) as ConsentRow[], missing: false };
}

export async function addConsent(p: {
  contactId: string; companyId: string; declared_at: string; accepted: string[]; refused: string[];
  form: string | null; form_ref: string | null; expires_at: string | null; note: string | null;
}): Promise<void> {
  const { error } = await sb.from('contact_consents').insert({
    contact_id: p.contactId, company_id: p.companyId, declared_at: p.declared_at, accepted: p.accepted, refused: p.refused,
    form: p.form, form_ref: p.form_ref, expires_at: p.expires_at, note: p.note,
  });
  if (error) fail(error);
}

export async function revokeConsent(id: string, reason: string | null): Promise<void> {
  const { error } = await sb.from('contact_consents').update({ revoked_at: new Date().toISOString(), revoke_reason: reason }).eq('id', id);
  if (error) fail(error);
}

export async function deleteConsent(id: string): Promise<void> {
  const { error } = await sb.from('contact_consents').delete().eq('id', id);
  if (error) fail(error);
}

/** Toutes les données du client (portabilité / édition de la fiche RGPD). Tracé en base. */
export async function gdprExport(contactId: string, purpose: 'portabilite' | 'edition'): Promise<Record<string, unknown>> {
  const { data, error } = await sb.rpc<Record<string, unknown>>('contact_gdpr_export', { _contact: contactId, _purpose: purpose });
  if (error) fail(error);
  return data ?? {};
}

export type PurgeRun = {
  id: string; status: 'identifie' | 'execute' | 'abandonne'; reference_date: string;
  prospect_before: string; client_before: string; legal_before: string;
  candidates: number; kept_open: number; executed_count: number;
  identified_at: string; executed_at: string | null; abandoned_at: string | null;
};
export type PurgeItem = {
  id: string; contact_id: string | null; contact_code: string | null; reason: 'prospect' | 'client_sans_facture';
  last_activity_at: string | null; last_invoice_date: string | null; mode: 'complete' | 'partielle';
  kept_reason: string | null; outcome: string | null;
};

export async function listPurgeRuns(companyId: string): Promise<{ rows: PurgeRun[]; missing: boolean }> {
  const { data, error } = await sb.from('gdpr_purge_runs').select('*').eq('company_id', companyId)
    .order('identified_at', { ascending: false }).limit(20);
  if (error) { if (isMissingSchema(error)) return { rows: [], missing: true }; fail(error); }
  return { rows: (data ?? []) as PurgeRun[], missing: false };
}

export async function listPurgeItems(runId: string): Promise<PurgeItem[]> {
  const { data, error } = await sb.from('gdpr_purge_items').select('*').eq('run_id', runId).order('contact_code');
  if (error) fail(error);
  return (data ?? []) as PurgeItem[];
}

export async function purgeIdentify(companyId: string): Promise<string> {
  const { data, error } = await sb.rpc<string>('gdpr_purge_identify', { _company: companyId });
  if (error) fail(error);
  return data;
}

export async function purgeConfirm(runId: string, excluded: string[]): Promise<{ anonymised: number; skipped: number }> {
  const { data, error } = await sb.rpc<{ anonymised: number; skipped: number }>('gdpr_purge_confirm', { _run: runId, _excluded: excluded });
  if (error) fail(error);
  return data;
}

export async function purgeAbandon(runId: string): Promise<void> {
  const { error } = await sb.rpc('gdpr_purge_abandon', { _run: runId });
  if (error) fail(error);
}

/* ------------------------------------------------------------------ Groupes, vente groupement */

export type GroupDef = { code: string; label: string; category: string; sort_order: number; is_active: boolean };

export async function listGroupDefs(companyId: string): Promise<GroupDef[]> {
  const { data, error } = await supabase.from('reference_values').select('code, label, sort_order, is_active, extra')
    .eq('company_id', companyId).eq('table_key', 'contact_group').order('sort_order').order('label');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    code: r.code, label: r.label, sort_order: r.sort_order, is_active: r.is_active,
    category: String((r.extra as Record<string, unknown> | null)?.category ?? 'autre'),
  }));
}

export async function listContactGroups(contactId: string): Promise<{ codes: string[]; missing: boolean }> {
  const { data, error } = await sb.from('contact_group_members').select('group_code').eq('contact_id', contactId);
  if (error) { if (isMissingSchema(error)) return { codes: [], missing: true }; fail(error); }
  return { codes: ((data ?? []) as { group_code: string }[]).map((r) => r.group_code), missing: false };
}

export async function setContactGroup(contactId: string, companyId: string, code: string, on: boolean): Promise<void> {
  if (on) {
    const { error } = await sb.from('contact_group_members').insert({ contact_id: contactId, company_id: companyId, group_code: code });
    if (error && error.code !== '23505') fail(error);
  } else {
    const { error } = await sb.from('contact_group_members').delete().eq('contact_id', contactId).eq('group_code', code);
    if (error) fail(error);
  }
}

export type GroupSale = { id: string; member_id: string; participation_rate: number; member_code: string | null; member_name: string };

export async function listGroupSales(contactId: string): Promise<{ rows: GroupSale[]; missing: boolean }> {
  const { data, error } = await sb.from('contact_group_sales')
    .select('id, member_id, participation_rate, member:contacts!contact_group_sales_member_id_fkey(code, first_name, last_name, company_name, type)')
    .eq('contact_id', contactId).order('created_at');
  if (error) { if (isMissingSchema(error)) return { rows: [], missing: true }; fail(error); }
  type Row = { id: string; member_id: string; participation_rate: number;
    member: { code: string | null; first_name: string | null; last_name: string | null; company_name: string | null; type: string | null } | null };
  return {
    missing: false,
    rows: ((data ?? []) as Row[]).map((r) => {
      const m = r.member;
      const person = [m?.first_name, m?.last_name].filter(Boolean).join(' ');
      return {
        id: r.id, member_id: r.member_id, participation_rate: Number(r.participation_rate),
        member_code: m?.code ?? null,
        member_name: (m?.type === 'particulier' && person) ? person : (m?.company_name || person || '—'),
      };
    }),
  };
}

export async function addGroupSale(contactId: string, companyId: string, memberId: string, rate: number): Promise<void> {
  const { error } = await sb.from('contact_group_sales').insert({ contact_id: contactId, company_id: companyId, member_id: memberId, participation_rate: rate });
  if (error) fail(error);
}

export async function deleteGroupSale(id: string): Promise<void> {
  const { error } = await sb.from('contact_group_sales').delete().eq('id', id);
  if (error) fail(error);
}

/* ------------------------------------------------------------------ Onglets de lecture */

export type DispoRow = {
  key: string; kind: 'commande' | 'reservation'; date: string; reference: string; designation: string;
  qty: number; status: string; document: string | null;
};

/** Onglet Dispo/Doc : pièces commandées pour le client (ses commandes et les quantités du stock
 *  qui lui sont associées) + pièces réservées pour ses RDV / OR. */
export async function listDispo(contactId: string): Promise<DispoRow[]> {
  const out: DispoRow[] = [];
  type L = { id: string; reference: string | null; designation: string | null; qty_client: number };
  const { data: orders, error: e0 } = await sb.from('part_orders')
    .select('id, number, dispatch_status, created_at, lines:part_order_lines(id, reference, designation, qty_client)')
    .eq('contact_id', contactId).neq('dispatch_status', 'annulee').order('created_at', { ascending: false }).limit(100);
  if (e0 && !isMissingSchema(e0)) fail(e0);
  type O = { id: string; number: string | null; dispatch_status: string; created_at: string; lines: L[] | null };
  for (const o of (orders ?? []) as O[]) {
    for (const l of o.lines ?? []) {
      if (Number(l.qty_client) <= 0) continue;
      out.push({
        key: `o-${l.id}`, kind: 'commande', date: o.created_at.slice(0, 10), reference: l.reference ?? '',
        designation: l.designation ?? '', qty: Number(l.qty_client), status: o.dispatch_status, document: o.number,
      });
    }
  }
  const { data: alloc, error: e1 } = await sb.from('part_order_allocations')
    .select('id, qty, created_at, line:part_order_lines(reference, designation, order:part_orders(number, dispatch_status))')
    .eq('contact_id', contactId).is('cancelled_at', null).order('created_at', { ascending: false });
  if (e1 && !isMissingSchema(e1)) fail(e1);
  type A = { id: string; qty: number; created_at: string;
    line: { reference: string | null; designation: string | null; order: { number: string | null; dispatch_status: string } | null } | null };
  for (const a of (alloc ?? []) as A[]) {
    out.push({
      key: `a-${a.id}`, kind: 'commande', date: a.created_at.slice(0, 10), reference: a.line?.reference ?? '',
      designation: a.line?.designation ?? '', qty: Number(a.qty), status: a.line?.order?.dispatch_status ?? '',
      document: a.line?.order?.number ?? null,
    });
  }
  const { data: res, error: e2 } = await sb.from('stock_reservations')
    .select('id, reference, designation, qty_needed, qty_reserved, status, created_at, due_at')
    .eq('contact_id', contactId).eq('status', 'active').order('created_at', { ascending: false });
  if (e2 && !isMissingSchema(e2)) fail(e2);
  type R = { id: string; reference: string | null; designation: string; qty_needed: number; qty_reserved: number; status: string; created_at: string; due_at: string | null };
  for (const r of (res ?? []) as R[]) {
    out.push({
      key: `r-${r.id}`, kind: 'reservation', date: (r.due_at ?? r.created_at).slice(0, 10), reference: r.reference ?? '',
      designation: r.designation, qty: Number(r.qty_needed),
      status: Number(r.qty_reserved) >= Number(r.qty_needed) ? 'reservee' : 'a_commander', document: null,
    });
  }
  return out;
}

export type AppointmentRow = {
  id: string; starts_at: string; planned_minutes: number; work_description: string | null; mechanic_name: string | null;
  status: string; vehicle: { brand: string | null; model: string | null; vin: string | null; plate: string | null; color?: string | null } | null;
};

export async function listAppointments(contactId: string): Promise<AppointmentRow[]> {
  const { data, error } = await sb.from('workshop_appointments')
    .select('id, starts_at, planned_minutes, work_description, mechanic_name, status, vehicle:vehicles(brand, model, vin, plate)')
    .eq('contact_id', contactId).order('starts_at', { ascending: false }).limit(200);
  if (error) fail(error);
  return (data ?? []) as AppointmentRow[];
}

export type FollowupRow = { id: string; kind: string; label: string | null; due_date: string | null; send_at: string; status: string; channel: string; to_email: string | null; sent_at: string | null };

/** Onglet Relances : relances d'entretien et interventions reportées (M10) du client. */
export async function listFollowups(contactId: string): Promise<FollowupRow[]> {
  const { data, error } = await sb.from('followups')
    .select('id, kind, label, due_date, send_at, status, channel, to_email, sent_at')
    .eq('contact_id', contactId).order('send_at', { ascending: false }).limit(200);
  if (error) { if (isMissingSchema(error)) return []; fail(error); }
  return (data ?? []) as FollowupRow[];
}

export type ArchiveLine = {
  id: string; document_id: string; doc_type: string; number: string | null; issue_date: string; status: string;
  reference: string | null; designation: string; quantity: number; line_ht: number; line_ttc: number;
};

/** Onglet Archives : détail ligne par ligne des documents clos (payés, annulés, convertis, avoirs). */
export async function listArchiveLines(contactId: string): Promise<ArchiveLine[]> {
  const { data, error } = await sb.from('documents')
    .select('id, doc_type, number, issue_date, status, lines:document_lines(id, designation, quantity, line_ht, line_ttc, sort_order, article:articles(reference))')
    .eq('contact_id', contactId).in('status', ['payee', 'annulee', 'converti', 'avoir_emis'])
    .order('issue_date', { ascending: false }).limit(500);
  if (error) fail(error);
  type D = { id: string; doc_type: string; number: string | null; issue_date: string; status: string;
    lines: { id: string; designation: string; quantity: number; line_ht: number; line_ttc: number; sort_order: number; article: { reference: string | null } | null }[] };
  const out: ArchiveLine[] = [];
  for (const d of (data ?? []) as D[]) {
    for (const l of [...(d.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order)) {
      out.push({
        id: l.id, document_id: d.id, doc_type: d.doc_type, number: d.number, issue_date: d.issue_date, status: d.status,
        reference: l.article?.reference ?? null, designation: l.designation, quantity: Number(l.quantity),
        line_ht: Number(l.line_ht), line_ttc: Number(l.line_ttc),
      });
    }
  }
  return out;
}

export type ContactCampaignRow = {
  id: string; created_at: string; address: string | null; status: 'pret' | 'ignore'; skip_reason: string | null;
  rendered_subject: string | null; rendered_body: string | null;
  campaign: { name: string; channel: 'email' | 'sms'; mode: string; status: string } | null;
};

export async function listContactCampaigns(contactId: string): Promise<ContactCampaignRow[]> {
  const { data, error } = await sb.from('marketing_campaign_recipients')
    .select('id, created_at, address, status, skip_reason, rendered_subject, rendered_body, campaign:marketing_campaigns(name, channel, mode, status)')
    .eq('contact_id', contactId).order('created_at', { ascending: false }).limit(200);
  if (error) { if (isMissingSchema(error)) return []; fail(error); }
  return (data ?? []) as ContactCampaignRow[];
}

/* ------------------------------------------------------------------ Liste : immatriculation */

/** Fiches propriétaires (actuels ou passés) d'une moto dont la plaque contient le texte. */
export async function contactIdsByPlate(companyId: string, plate: string): Promise<string[]> {
  const norm = plate.replace(/[\s.-]/g, '').toUpperCase();
  if (norm.length < 2) return [];
  const { data: vs, error } = await supabase.from('vehicles').select('id, plate').eq('company_id', companyId)
    .ilike('plate', `%${norm.split('').join('%')}%`).limit(200);
  if (error) throw error;
  const ids = (vs ?? []).filter((v) => (v.plate ?? '').replace(/[\s.-]/g, '').toUpperCase().includes(norm)).map((v) => v.id);
  if (ids.length === 0) return [];
  const { data: owners, error: e2 } = await supabase.from('vehicle_owners').select('contact_id, is_current').in('vehicle_id', ids)
    .order('is_current', { ascending: false });
  if (e2) throw e2;
  return Array.from(new Set((owners ?? []).map((o) => o.contact_id)));
}

/* ------------------------------------------------------------------ Cascade */

export type CascadeFilters = {
  type: string; civility: string; category: string; price_list: string; code_from: string; code_to: string;
  place: string; balance_min: string; balance_max: string; include_archived: boolean;
};
export type CascadeRow = {
  id: string; code: string | null; type: string; civility: string | null; legal_form: string | null;
  first_name: string | null; last_name: string | null; company_name: string | null; zip: string | null; city: string | null;
  category: string | null; price_list: string | null; payment_terms: string | null;
  is_blocked: boolean; is_detaxe: boolean; mode_ht: boolean; marketing_opt_out: boolean; is_account: boolean;
  is_watch: boolean; show_discounts_pos: boolean | null; is_active: boolean; balance: number;
};

export async function cascadeList(companyId: string, f: CascadeFilters): Promise<CascadeRow[]> {
  const payload: Record<string, unknown> = { include_archived: f.include_archived };
  for (const k of ['type', 'civility', 'category', 'price_list', 'code_from', 'code_to', 'place', 'balance_min', 'balance_max'] as const) {
    const v = String(f[k] ?? '').trim();
    if (v && v !== 'all') payload[k] = k.startsWith('balance') ? v.replace(',', '.') : v;
  }
  const { data, error } = await sb.rpc<CascadeRow[]>('contacts_cascade_list', { _company: companyId, _f: payload, _limit: 5000 });
  if (error) fail(error);
  return (data ?? []).map((r) => ({ ...r, balance: Number(r.balance) }));
}

export type CascadeAction =
  | 'set_zip' | 'set_civility' | 'clear_civility' | 'set_category' | 'clear_category' | 'add_group' | 'remove_group'
  | 'set_payment_terms' | 'add_comment' | 'set_flag' | 'archive';

export async function cascadeApply(companyId: string, ids: string[], action: CascadeAction, value: Record<string, unknown>): Promise<number> {
  const { data, error } = await sb.rpc<number>('contacts_cascade_apply', { _company: companyId, _ids: ids, _action: action, _value: value });
  if (error) fail(error);
  return Number(data ?? 0);
}

/* ------------------------------------------------------------------ Extraction et campagnes */

export type ExtractRow = {
  id: string; code: string | null; type: string; status: string; civility: string | null; legal_form: string | null;
  first_name: string | null; last_name: string | null; company_name: string | null; email: string | null; mobile: string | null;
  address: string | null; street_number: string | null; address_complement: string | null; zip: string | null; city: string | null;
  country: string | null; birth_date: string | null; category: string | null; price_list: string | null; created_at: string;
  marketing_opt_out: boolean; npai: boolean; consent_email: string | null; consent_sms: string | null;
  province: string | null; region: string | null;
};

export async function extractContacts(companyId: string, c: ExtractionCriteria): Promise<ExtractRow[]> {
  const { data, error } = await sb.rpc<ExtractRow[]>('contacts_extract', { _company: companyId, _c: criteriaPayload(c) });
  if (error) fail(error);
  return data ?? [];
}

export async function prepareCampaign(p: {
  companyId: string; channel: 'email' | 'sms'; name: string; subject: string; body: string; contactIds: string[]; criteria: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await sb.rpc<string>('marketing_campaign_prepare', {
    _company: p.companyId, _channel: p.channel, _name: p.name, _subject: p.subject, _body: p.body,
    _contacts: p.contactIds, _criteria: p.criteria,
  });
  if (error) fail(error);
  return data;
}

export type CampaignRow = {
  id: string; channel: 'email' | 'sms'; name: string; subject: string | null; mode: string; status: string;
  recipients_count: number; skipped_count: number; created_at: string;
};

export async function listCampaigns(companyId: string): Promise<{ rows: CampaignRow[]; missing: boolean }> {
  const { data, error } = await sb.from('marketing_campaigns').select('id, channel, name, subject, mode, status, recipients_count, skipped_count, created_at')
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(30);
  if (error) { if (isMissingSchema(error)) return { rows: [], missing: true }; fail(error); }
  return { rows: (data ?? []) as CampaignRow[], missing: false };
}

export type CampaignRecipient = { id: string; contact_id: string | null; address: string | null; status: 'pret' | 'ignore'; skip_reason: string | null; rendered_subject: string | null; rendered_body: string | null };

export async function listCampaignRecipients(campaignId: string): Promise<CampaignRecipient[]> {
  const { data, error } = await sb.from('marketing_campaign_recipients')
    .select('id, contact_id, address, status, skip_reason, rendered_subject, rendered_body').eq('campaign_id', campaignId).limit(20000);
  if (error) fail(error);
  return (data ?? []) as CampaignRecipient[];
}

export async function cancelCampaign(id: string): Promise<void> {
  const { error } = await sb.rpc('marketing_campaign_cancel', { _id: id });
  if (error) fail(error);
}

/** Fiches par lots de 150 identifiants (une liste de purge peut en compter des milliers). */
export async function contactsByIdsChunked(ids: string[]): Promise<import('../api').Contact[]> {
  const out: import('../api').Contact[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('contacts').select('*').in('id', ids.slice(i, i + 150));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}
