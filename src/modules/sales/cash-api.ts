/**
 * M6 (POS) — Caisse : sessions (fond de caisse), mouvements de fond de caisse,
 * clôture / journal Z. Réf. G8 Facturation p.128-131, p.164-179.
 *
 * PDV010 (03/11/2026, caisse conforme au droit belge) : le journal Z se calcule PAR SESSION
 * (`cash_z_report_session` : rapport X tant que la session est ouverte, Z numéroté et FIGÉ à la
 * clôture), la clôture exige le motif d'un écart, le PDF du Z est rangé en GED de la session et
 * se réimprime depuis l'instantané figé. Migration 20261103170000 ; avant elle, le rapport X
 * retombe sur l'ancien calcul par plage horaire (`cash_z_report`).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { t } from '@/lib/i18n';
import { uploadAttachment, listAttachments, signedUrl } from '@/modules/documents/ged-api';
import { isMissingDbObject } from './write-api';
import { parseZReport, zPdfFileName, type ZReport } from './z-report';

export type CashSession = Database['public']['Tables']['cash_sessions']['Row'];
export type CashMovement = Database['public']['Tables']['cash_movements']['Row'];

/** Session ouverte de la société (au plus une à la fois), sinon null. */
export async function getOpenSession(companyId: string): Promise<CashSession | null> {
  const { data, error } = await supabase
    .from('cash_sessions').select('*').eq('company_id', companyId).eq('status', 'open')
    .order('opened_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function listSessions(companyId: string): Promise<CashSession[]> {
  const { data, error } = await supabase
    .from('cash_sessions').select('*').eq('company_id', companyId)
    .order('opened_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}

/**
 * Sessions clôturées d'une période (journal des recettes) : bornes sur la date de clôture,
 * `fromISO` incluse, `toISO` exclue. Les plus récentes d'abord.
 */
export async function listClosedSessions(companyId: string, fromISO?: string, toISO?: string): Promise<CashSession[]> {
  let q = supabase.from('cash_sessions').select('*').eq('company_id', companyId).eq('status', 'closed');
  if (fromISO) q = q.gte('closed_at', fromISO);
  if (toISO) q = q.lt('closed_at', toISO);
  const { data, error } = await q.order('closed_at', { ascending: false }).limit(400);
  if (error) throw error;
  return data ?? [];
}

/**
 * Ouvre la session du jour. Une seule session ouverte par société (audit caisse du 03/11/2026 :
 * rien ne l'empêchait ; la migration 20261103150000 pose la même règle en base).
 */
export async function openSession(companyId: string, openingFloat: number, note?: string): Promise<string> {
  if (!(openingFloat >= 0)) throw new Error(t('cash.amountPositive'));
  if (await getOpenSession(companyId)) throw new Error(t('cash.alreadyOpen'));
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('cash_sessions').insert({
    company_id: companyId, opening_float: openingFloat, opened_by: user?.id ?? null, note: note ?? null,
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Clôture : seulement une session encore ouverte (une session clôturée ne se rejoue pas). La base
 * prend le numéro de Z, calcule les espèces attendues, refuse un écart sans motif et fige le Z.
 * Renvoie la session clôturée (numéro et Z figé compris).
 */
export async function closeSession(sessionId: string, countedCash: number, denominations: Record<string, number>, varianceReason?: string | null): Promise<CashSession> {
  const reason = (varianceReason ?? '').trim();
  const { data, error } = await supabase.from('cash_sessions').update({
    status: 'closed', closed_at: new Date().toISOString(),
    counted_cash: countedCash, denominations,
    ...(reason ? { variance_reason: reason } : {}),
  }).eq('id', sessionId).eq('status', 'open').select('*');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(t('cash.alreadyClosed'));
  return data[0];
}

export async function listSessionMovements(companyId: string, fromISO: string, toISO: string): Promise<CashMovement[]> {
  const { data, error } = await supabase
    .from('cash_movements').select('*').eq('company_id', companyId)
    .gte('occurred_at', fromISO).lt('occurred_at', toISO).order('occurred_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addMovement(companyId: string, sessionId: string | null, kind: 'in' | 'out', amount: number, method: string, reason: string): Promise<void> {
  if (!(amount > 0)) throw new Error(t('cash.amountPositive'));
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('cash_movements').insert({
    company_id: companyId, session_id: sessionId, kind, amount: Math.abs(amount), method, reason, operator_id: user?.id ?? null,
  });
  if (error) throw error;
}

/**
 * Rapport de la session : X (session ouverte, recalculé, non numéroté) ou Z figé (session clôturée :
 * l'instantané de la clôture, jamais recalculé). Avant la migration 20261103170000 : ancien calcul
 * sur la plage horaire de la session.
 */
export async function getSessionReport(session: Pick<CashSession, 'id' | 'company_id' | 'opened_at' | 'closed_at' | 'opening_float'>): Promise<ZReport> {
  const { data, error } = await supabase.rpc('cash_z_report_session', { _session: session.id });
  if (!error) return parseZReport(data);
  if (!isMissingDbObject(error)) throw error;
  const to = session.closed_at ?? new Date().toISOString();
  const { data: legacy, error: le } = await supabase.rpc('cash_z_report', { _company: session.company_id, _from: session.opened_at, _to: to });
  if (le) throw le;
  return parseZReport({ ...(legacy as object ?? {}), session_id: session.id, opened_at: session.opened_at, closed_at: to, opening_float: session.opening_float });
}

/** Z figé d'une session clôturée (l'instantané de la clôture), sinon null. */
export const frozenZ = (s: Pick<CashSession, 'z_report'>): ZReport | null => (s.z_report ? parseZReport(s.z_report) : null);

/** Dossier GED des journaux Z (pièce jointe de la session de caisse). */
export const Z_GED_ENTITY = 'cash_session';
export const Z_GED_FOLDER = 'Journal Z';

/** Range le PDF du Z dans la GED de la session (archive du journal des recettes). */
export async function archiveZPdf(companyId: string, z: ZReport, bytes: Uint8Array): Promise<void> {
  const file = new File([new Blob([bytes as BlobPart], { type: 'application/pdf' })], zPdfFileName(z), { type: 'application/pdf' });
  await uploadAttachment(companyId, Z_GED_ENTITY, z.session_id, file, Date.now(), t('cash.zGedNote'), Z_GED_FOLDER);
}

/** PDF du Z archivé en GED à la clôture (le plus ancien : l'original), lien signé, sinon null. */
export async function archivedZPdfUrl(sessionId: string): Promise<string | null> {
  const atts = await listAttachments(Z_GED_ENTITY, sessionId);
  const original = [...atts].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return original ? signedUrl(original.storage_path) : null;
}
