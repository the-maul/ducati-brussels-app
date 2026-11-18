/**
 * M6 — Filiation N → 1 entre documents (table `document_sources`, migration 20261118160000) et
 * report des acomptes perçus d'un document vers un autre (BL regroupés, acompte direct imputé).
 * Sans la migration : la filiation n'est pas enregistrée (la ligne « Livraison N° … » de la facture
 * et le statut « converti » du BL restent), rien ne bloque.
 */
import { supabase } from '@/integrations/supabase/client';
import { addPayments, isMissingDbObject, listPayments, type DocumentRow, type NewPayment } from './write-api';

export type SourceKind = 'bl_grouping' | 'rebill' | 'direct_deposit';

type LooseTable = {
  insert: (rows: unknown) => Promise<{ error: { code?: string; message: string } | null }>;
  select: (cols: string) => {
    eq: (col: string, v: string) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  };
};
const sourcesTable = () => (supabase.from as unknown as (t: string) => LooseTable)('document_sources');

/** Enregistre les documents d'origine d'un document (best-effort sans la migration). */
export async function linkSources(companyId: string, documentId: string, sourceIds: string[], kind: SourceKind): Promise<boolean> {
  if (!sourceIds.length) return true;
  const { error } = await sourcesTable().insert(sourceIds.map((s) => ({ company_id: companyId, document_id: documentId, source_document_id: s, kind })));
  if (error && isMissingDbObject(error)) return false;
  if (error) throw error;
  return true;
}

export type LinkedDocument = { id: string; number: string | null; doc_type: string; issue_date: string; kind: SourceKind };

/** Documents d'origine (BL regroupés, avoir refacturé, acompte imputé) d'un document. */
export async function listDocumentSources(documentId: string): Promise<LinkedDocument[]> {
  const { data, error } = await sourcesTable().select('kind, source:documents!document_sources_source_document_id_fkey(id, number, doc_type, issue_date)').eq('document_id', documentId);
  if (error) { if (isMissingDbObject(error)) return []; throw error; }
  return ((data ?? []) as { kind: SourceKind; source: Omit<LinkedDocument, 'kind'> | null }[])
    .filter((r) => r.source).map((r) => ({ ...(r.source as Omit<LinkedDocument, 'kind'>), kind: r.kind }));
}

/** Documents produits à partir d'un document (facture groupée d'un BL, facture qui a pris l'acompte). */
export async function listDocumentTargets(sourceId: string): Promise<LinkedDocument[]> {
  const { data, error } = await sourcesTable().select('kind, target:documents!document_sources_document_id_fkey(id, number, doc_type, issue_date)').eq('source_document_id', sourceId);
  if (error) { if (isMissingDbObject(error)) return []; throw error; }
  return ((data ?? []) as { kind: SourceKind; target: Omit<LinkedDocument, 'kind'> | null }[])
    .filter((r) => r.target).map((r) => ({ ...(r.target as Omit<LinkedDocument, 'kind'>), kind: r.kind }));
}

/**
 * Report des règlements PERÇUS d'un document sur un autre (même règle que la conversion : l'argent
 * a été encaissé le jour de l'acompte, le report n'est pas un nouvel encaissement). Colonnes
 * `transferred_from` / `deposit_invoice_id` (caisse et facture légales, migrations 1103) : envoyées,
 * puis retirées si la base ne les connaît pas encore. Retourne le montant reporté.
 */
export async function transferReceivedPayments(source: Pick<DocumentRow, 'id' | 'doc_type' | 'number'>, targetId: string): Promise<number> {
  const paid = (await listPayments(source.id)).filter((p) => p.status === 'recu' && Number(p.amount) !== 0);
  if (!paid.length) return 0;
  const lines: NewPayment[] = paid.map((p) => ({
    method: p.method, amount: Number(p.amount), status: 'recu',
    note: `Acompte reporté ${source.doc_type} ${source.number ?? ''}`.trim(),
    fromFinancing: !!p.from_financing, transferredFrom: p.id,
    depositInvoiceId: (p as { deposit_invoice_id?: string | null }).deposit_invoice_id ?? null,
  }));
  try {
    await addPayments(targetId, lines);
  } catch (e) {
    if (!isMissingDbObject(e)) throw e;
    await addPayments(targetId, lines.map((l) => ({ ...l, transferredFrom: null, depositInvoiceId: null })));
  }
  return Math.round(paid.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
}
