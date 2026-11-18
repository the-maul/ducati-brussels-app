/**
 * M12 — Remises de prélèvements SEPA (rattrapage G8 « Encaissements », 18/11/2026, migration
 * 20261118173000). G8 « Gestion des L.C.R., traites et prélèvements » : Nouvelle remise, Remises
 * en attente ou archivées, banque / BIC / IBAN / ICS, échéances du … au …, client.
 *
 * Circuit : candidats (échéances DOM attendues + factures ouvertes de clients avec mandat actif)
 * → « Nouvelle remise » (en attente, fichier pain.008 construit ici et rangé sur la remise) →
 * « Archiver » quand la banque a prélevé (encaissement noté à ce moment) → impayé éventuel par ligne
 * (contre-passation). Réutilise le générateur pain.008 de `sepa.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { buildPain008Batch, download, type SepaTx } from './sepa';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type SepaCandidate = {
  kind: 'installment' | 'invoice'; payment_id: string | null; document_id: string; number: string | null; due_date: string | null;
  contact_id: string; contact_name: string; amount: number; mandate_ref: string; iban: string; bic: string | null;
  seq_type: string; installment_no: number | null;
};
export const candidateKey = (c: Pick<SepaCandidate, 'kind' | 'payment_id' | 'document_id'>) => (c.kind === 'installment' ? `p:${c.payment_id}` : `d:${c.document_id}`);

export async function listSepaCandidates(companyId: string, f: { from?: string | null; to?: string | null; contactId?: string | null }): Promise<SepaCandidate[]> {
  const { data, error } = await db.rpc('sepa_collectable_installments', { _company: companyId, _due_from: f.from || null, _due_to: f.to || null, _contact: f.contactId || null });
  if (error) throw error;
  return ((data ?? []) as SepaCandidate[]).map((r) => ({ ...r, amount: num(r.amount) }));
}

export type SepaBatch = {
  id: string; reference: string; status: 'en_attente' | 'archivee' | 'annulee'; collection_date: string; total: number; tx_count: number;
  creditor_name: string | null; creditor_id: string; creditor_iban: string; creditor_bic: string | null; xml: string | null;
  created_at: string; archived_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
};
export type SepaBatchItem = {
  id: string; batch_id: string; payment_id: string; document_id: string; contact_id: string | null; mandate_ref: string; iban: string;
  bic: string | null; signature_date: string; seq_type: string; debtor_name: string | null; document_number: string | null; amount: number;
  end_to_end_id: string; status: 'en_attente' | 'encaisse' | 'impaye' | 'annule'; unpaid_reason: string | null;
};

export async function listSepaBatches(companyId: string): Promise<SepaBatch[]> {
  const { data, error } = await db.from('sepa_batches').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return ((data ?? []) as SepaBatch[]).map((b) => ({ ...b, total: num(b.total) }));
}
export async function listSepaBatchItems(batchId: string): Promise<SepaBatchItem[]> {
  const { data, error } = await db.from('sepa_batch_items').select('*').eq('batch_id', batchId).order('debtor_name');
  if (error) throw error;
  return ((data ?? []) as SepaBatchItem[]).map((i) => ({ ...i, amount: num(i.amount) }));
}

/** Fichier pain.008 d'une remise (transactions encore vivantes). */
export function batchXml(b: SepaBatch, items: SepaBatchItem[], now = new Date()): string {
  const txs: SepaTx[] = items.filter((i) => i.status !== 'annule').map((i) => ({
    endToEndId: i.end_to_end_id, amount: i.amount, mandateRef: i.mandate_ref, signatureDate: i.signature_date, iban: i.iban, bic: i.bic,
    debtorName: i.debtor_name ?? '', remittance: i.document_number ?? i.end_to_end_id, seqType: i.seq_type,
  }));
  return buildPain008Batch({
    msgId: b.reference, creationDateTime: now.toISOString().slice(0, 19), collectionDate: b.collection_date,
    creditorName: b.creditor_name ?? '', creditorIban: b.creditor_iban, creditorBic: b.creditor_bic, creditorId: b.creditor_id, txs,
  });
}

/** Nouvelle remise : création en base (en attente), fichier construit, rangé et téléchargé. */
export async function createSepaBatch(companyId: string, collectionDate: string, selected: SepaCandidate[]): Promise<SepaBatch> {
  const payments = selected.filter((c) => c.kind === 'installment' && c.payment_id).map((c) => c.payment_id as string);
  const documents = selected.filter((c) => c.kind === 'invoice').map((c) => c.document_id);
  const { data: id, error } = await db.rpc('sepa_batch_create', { _company: companyId, _collection_date: collectionDate, _payments: payments, _documents: documents });
  if (error) throw error;
  const { data: b, error: be } = await db.from('sepa_batches').select('*').eq('id', id).single();
  if (be) throw be;
  const batch = { ...(b as SepaBatch), total: num((b as SepaBatch).total) };
  const xml = batchXml(batch, await listSepaBatchItems(batch.id));
  const { error: xe } = await db.rpc('sepa_batch_set_xml', { _batch: batch.id, _xml: xml });
  if (xe) throw xe;
  download(`SEPA_${batch.reference}.xml`, xml, 'application/xml;charset=utf-8;');
  return { ...batch, xml };
}

export async function downloadSepaBatch(b: SepaBatch): Promise<void> {
  const xml = b.xml ?? batchXml(b, await listSepaBatchItems(b.id));
  download(`SEPA_${b.reference}.xml`, xml, 'application/xml;charset=utf-8;');
}
export async function archiveSepaBatch(batchId: string): Promise<void> {
  const { error } = await db.rpc('sepa_batch_archive', { _batch: batchId });
  if (error) throw error;
}
export async function cancelSepaBatch(batchId: string, reason: string): Promise<void> {
  const { error } = await db.rpc('sepa_batch_cancel', { _batch: batchId, _reason: reason });
  if (error) throw error;
}
export async function markSepaItemUnpaid(itemId: string, reason: string): Promise<void> {
  const { error } = await db.rpc('sepa_item_unpaid', { _item: itemId, _reason: reason });
  if (error) throw error;
}

export type SepaCreditor = { sepa_creditor_id: string | null; iban: string | null; bic: string | null; name: string };
export async function getSepaCreditor(companyId: string): Promise<SepaCreditor> {
  const { data, error } = await supabase.from('companies').select('name, legal_name, sepa_creditor_id, iban, bic').eq('id', companyId).maybeSingle();
  if (error) throw error;
  return { sepa_creditor_id: data?.sepa_creditor_id ?? null, iban: data?.iban ?? null, bic: data?.bic ?? null, name: data?.legal_name || data?.name || '' };
}
export async function saveSepaCreditor(companyId: string, c: { sepa_creditor_id: string; iban: string; bic: string }): Promise<void> {
  const { error } = await supabase.from('companies').update({
    sepa_creditor_id: c.sepa_creditor_id.trim() || null, iban: c.iban.replace(/\s/g, '').toUpperCase() || null, bic: c.bic.trim().toUpperCase() || null,
  }).eq('id', companyId);
  if (error) throw error;
}

/** ICS belge : « BE » + 2 chiffres de contrôle + « ZZZ » + n° d'entreprise (10 chiffres). Contrôle de forme seulement. */
export function looksLikeCreditorId(v: string | null | undefined): boolean {
  const s = String(v ?? '').replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(s) && !/^BE00ZZZ0+$/.test(s);
}
