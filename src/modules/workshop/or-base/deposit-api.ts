/**
 * M8 — Acompte sur l'OR (decision du client Q45 du 18/11/2026, comme G8 « Saisie d'acompte »).
 *
 * MEME mecanisme que l'acompte de vente (pas de second systeme) : l'acompte est un reglement
 * `document_payments` porte par un bon de commande (BC) rattache a l'OR (`documents.repair_order_id`,
 * numerote du n° de l'OR), cree a la premiere saisie par `repair_order_deposit_document`. Encaissement,
 * caisse, facture d'acompte FAA, rappel « avant le 15 » : ceux des ventes (PaymentPanel,
 * DepositInvoicePanel). A la validation de la facture de l'OR, la base reporte l'acompte sur elle
 * (declencheur trg_documents_repair_order_deposit, migration 20261119191000).
 * Avant la migration : rien (liste vide, panneau qui le dit).
 */
import { supabase } from '@/integrations/supabase/client';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const rpc = supabase.rpc as unknown as Rpc;

/** Fonction / colonne inconnue de la base (migration pas encore posee). */
export const isMissingDepositSchema = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42703' || /repair_order_deposit/.test(e.message ?? ''));

export type OrDeposit = { documentId: string; number: string | null; status: string; amount: number };

/** Acompte net (percu, contre-passations deduites) de chaque OR ; OR sans acompte : absent. */
export async function listOrDeposits(orIds: string[]): Promise<Map<string, OrDeposit>> {
  const out = new Map<string, OrDeposit>();
  const ids = [...new Set(orIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await rpc('repair_order_deposits', { _ors: ids.slice(i, i + 500) });
    if (error) { if (isMissingDepositSchema(error)) return out; throw error; }
    for (const r of (data ?? []) as { repair_order_id: string; document_id: string; number: string | null; status: string; amount: number | string }[]) {
      out.set(r.repair_order_id, { documentId: r.document_id, number: r.number, status: r.status, amount: Number(r.amount) || 0 });
    }
  }
  return out;
}

/** Document d'acompte de l'OR (null = pas encore d'acompte ; undefined = migration absente). */
export async function getOrDeposit(orId: string): Promise<OrDeposit | null | undefined> {
  const { data, error } = await rpc('repair_order_deposits', { _ors: [orId] });
  if (error) { if (isMissingDepositSchema(error)) return undefined; throw error; }
  const r = ((data ?? []) as { document_id: string; number: string | null; status: string; amount: number | string }[])[0];
  return r ? { documentId: r.document_id, number: r.number, status: r.status, amount: Number(r.amount) || 0 } : null;
}

/** Cree (ou retrouve) le document qui porte l'acompte de l'OR. */
export async function ensureOrDepositDocument(orId: string): Promise<string> {
  const { data, error } = await rpc('repair_order_deposit_document', { _or: orId });
  if (error) throw error;
  return data as string;
}
