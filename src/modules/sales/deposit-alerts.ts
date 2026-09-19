/**
 * M6 — « Commander les pièces dès l'acompte et ne laisser aucun solde impayé » (mission 05, carte 10).
 * Règles pures testées par tests/sales-deposit-alerts.test.ts ; le serveur fait foi (migration
 * 20260919351000 : _sales_deposit_alert, _sales_unpaid_alert, _sales_resolve_alerts,
 * _cron_sales_alerts, sales_open_balances).
 *
 * Domenico (vidéo G8, 8:19) : « une règle pour que le bon de commande soit toujours lancé une fois
 * qu'il y a un acompte versé, et ne pas laisser traîner des factures à payer ou des soldes ».
 * Décisions du 19/09 : acompte versé = ENCAISSÉ (au moins une partie) ; alerte = vendeur du
 * document + administrateurs.
 */
import { supabase } from '@/integrations/supabase/client';
import { documentBalance, type BalanceDoc, type BalancePayment } from './balance';

/** Documents qui reçoivent un acompte et déclenchent l'alerte « pièces à commander ». */
export const DEPOSIT_ALERT_DOC_TYPES = ['DEV', 'BC', 'RES'] as const;
const CLOSED = ['brouillon', 'annulee', 'converti'];

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Acompte ENCAISSÉ : règlements perçus du client (un règlement « attendu » ou de l'organisme ne compte pas). */
export function depositReceived(payments: BalancePayment[]): number {
  return Math.round(payments
    .filter((p) => p.status === 'recu' && !p.from_financing && n(p.amount) > 0)
    .reduce((s, p) => s + n(p.amount), 0) * 100) / 100;
}

/**
 * Faut-il alerter (bandeau + cloche) ? Acompte encaissé ET pièces manquantes pas encore commandées,
 * sur un devis / proforma, bon de commande ou réservation ouvert.
 */
export function needsOrderAfterDeposit(
  doc: { doc_type: string; status: string },
  payments: BalancePayment[],
  missingPieces: number,
): boolean {
  if (!(DEPOSIT_ALERT_DOC_TYPES as readonly string[]).includes(doc.doc_type)) return false;
  if (CLOSED.includes(doc.status)) return false;
  return depositReceived(payments) > 0 && missingPieces > 0;
}

/** Clé anti-doublon du rappel « pièces à commander » : une alerte par document et par jour. */
export function depositAlertKey(documentId: string, day: string): string {
  return `${documentId}:${day}`;
}

/** Clé anti-doublon d'un impayé : une seule alerte par document et par échéance. */
export function unpaidAlertKey(documentId: string, dueDate: string): string {
  return `${documentId}:${dueDate}`;
}

/** Une facture échue (échéance dépassée) avec un reste à payer par le client (financement accepté déduit). */
export function isUnpaidOverdueInvoice(
  doc: BalanceDoc & { doc_type: string; status: string; due_date?: string | null },
  payments: BalancePayment[] | null,
  today: string,
): boolean {
  if (doc.doc_type !== 'FAC' || CLOSED.includes(doc.status) || !doc.due_date || doc.due_date >= today) return false;
  return documentBalance(doc, payments, today).clientDue > 0.005;
}

/**
 * Anti-doublon : parmi les factures échues impayées, celles qui n'ont pas encore d'alerte pour leur
 * échéance (`existingKeys` = clés déjà en base). Même règle que l'index unique
 * (société, type, clé) de team_notifications.
 */
export function newUnpaidAlerts<T extends { id: string; due_date?: string | null }>(overdue: T[], existingKeys: Set<string>): T[] {
  const seen = new Set(existingKeys);
  const out: T[] = [];
  for (const d of overdue) {
    if (!d.due_date) continue;
    const k = unpaidAlertKey(d.id, d.due_date);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

// ---- Cloche ----

export type DocumentAlertKind = 'order_after_deposit' | 'unpaid_balance';

export type DocumentAlert = {
  id: string;
  kind: DocumentAlertKind;
  documentId: string | null;
  contactId: string | null;
  title: string;
  payload: { number?: string | null; doc_type?: string; missing_lines?: number; missing_qty?: number; deposit?: number; due_date?: string; client_due?: number };
  createdAt: string;
  read: boolean;
};

/** Une alerte par document : la plus récente (le rappel quotidien en crée une par jour). */
export function latestPerDocument(alerts: DocumentAlert[]): DocumentAlert[] {
  const byDoc = new Map<string, DocumentAlert>();
  for (const a of alerts) {
    const k = a.documentId ?? a.id;
    const cur = byDoc.get(k);
    if (!cur || a.createdAt > cur.createdAt) byDoc.set(k, a);
  }
  return [...byDoc.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Jours d'affichage dans la cloche (tant que l'alerte n'est pas réglée). */
export const DOCUMENT_ALERT_DAYS = 30;

/**
 * Alertes non réglées d'un type, visibles par l'utilisateur (le vendeur du document et les
 * administrateurs : filtré en base), avec l'état « lu » de l'utilisateur.
 */
export async function listDocumentAlerts(companyId: string, userId: string, kind: DocumentAlertKind): Promise<DocumentAlert[]> {
  const since = new Date(Date.now() - DOCUMENT_ALERT_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('team_notifications')
    .select('id, kind, document_id, contact_id, title, payload, created_at, team_notification_reads(user_id)')
    .eq('company_id', companyId)
    .eq('kind', kind)
    .is('resolved_at', null)
    .gte('created_at', since)
    .eq('team_notification_reads.user_id', userId)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return latestPerDocument((data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as DocumentAlertKind,
    documentId: r.document_id,
    contactId: r.contact_id,
    title: r.title,
    payload: (r.payload ?? {}) as DocumentAlert['payload'],
    createdAt: r.created_at,
    read: (r.team_notification_reads ?? []).length > 0,
  })));
}

// ---- Soldes à encaisser ----

export type OpenBalance = {
  id: string;
  docType: string;
  number: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  contactId: string | null;
  contactName: string | null;
  operatorUserId: string | null;
  operatorName: string | null;
  ttc: number;
  paid: number;
  toReceiveFromOrg: number;
  financingPending: number;
  clientDue: number;
  overdue: boolean;
  daysOverdue: number;
  ageDays: number;
};

/** Documents ouverts avec un reste à payer par le client (fonction SQL sales_open_balances). */
export async function listOpenBalances(companyId: string, operatorId?: string | null): Promise<OpenBalance[]> {
  const { data, error } = await supabase.rpc('sales_open_balances', { _company: companyId, _operator: operatorId ?? undefined });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    docType: r.doc_type,
    number: r.number ?? null,
    status: r.status,
    issueDate: r.issue_date,
    dueDate: r.due_date ?? null,
    contactId: r.contact_id ?? null,
    contactName: r.contact_name ?? null,
    operatorUserId: r.operator_user_id ?? null,
    operatorName: r.operator_name ?? null,
    ttc: n(r.ttc),
    paid: n(r.paid),
    toReceiveFromOrg: n(r.to_receive_from_org),
    financingPending: n(r.financing_pending),
    clientDue: n(r.client_due),
    overdue: !!r.overdue,
    daysOverdue: n(r.days_overdue),
    ageDays: n(r.age_days),
  }));
}

export type BalanceSort = 'due' | 'age' | 'amount';

/** Tri de la liste : échéance (échues d'abord, puis la plus proche), ancienneté, ou montant. */
export function sortOpenBalances(rows: OpenBalance[], sort: BalanceSort): OpenBalance[] {
  const out = [...rows];
  if (sort === 'age') out.sort((a, b) => b.ageDays - a.ageDays || (a.number ?? '').localeCompare(b.number ?? ''));
  else if (sort === 'amount') out.sort((a, b) => b.clientDue - a.clientDue);
  else out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const da = a.dueDate ?? '9999-12-31';
    const db = b.dueDate ?? '9999-12-31';
    return da.localeCompare(db) || a.issueDate.localeCompare(b.issueDate);
  });
  return out;
}

export function totalOpenBalances(rows: OpenBalance[]): { clientDue: number; overdueDue: number; count: number; overdueCount: number } {
  let clientDue = 0, overdueDue = 0, overdueCount = 0;
  for (const r of rows) {
    clientDue += r.clientDue;
    if (r.overdue) { overdueDue += r.clientDue; overdueCount += 1; }
  }
  return { clientDue: Math.round(clientDue * 100) / 100, overdueDue: Math.round(overdueDue * 100) / 100, count: rows.length, overdueCount };
}
