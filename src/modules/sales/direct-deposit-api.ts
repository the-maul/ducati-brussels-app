/**
 * M6 — Acompte direct (G8 Ventes › « Acompte direct » : client, mode de règlement, opérateur,
 * commentaire, montant, date) et « Documents en attente » d'un client (G8 : fenêtre affichée au
 * choix du client à la création d'un document). Lot rattrapage G8 du 18/11/2026.
 *
 * Un acompte direct est un document `ACD` (série « Acompte direct ») : une ligne texte, aucun
 * montant facturé, aucun mouvement de stock, et le règlement perçu dessus. Il passe par les mêmes
 * contrôles que tout encaissement (caisse ouverte pour les espèces, plafond, Z). Il s'impute ensuite
 * sur un document du client : le règlement est reporté (comme un acompte de réservation converti)
 * et l'acompte direct passe « converti ».
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { createDocument, addPayments, isClosedDocStatus, type DocumentRow } from './write-api';
import { linkSources, transferReceivedPayments } from './document-links-api';
import { directDepositAvailable, PENDING_DOC_TYPES } from './pending-documents';

export const DIRECT_DEPOSIT_DOC_TYPE = 'ACD';

export type DirectDepositInput = {
  companyId: string; contactId: string; method: string; amount: number; date: string; comment: string;
};

/** Crée l'acompte direct (document ACD validé) puis enregistre le règlement perçu. Retourne l'id. */
export async function createDirectDeposit(p: DirectDepositInput): Promise<string> {
  if (!(p.amount > 0)) throw new Error(t('directDeposit.needAmount'));
  if (!p.contactId) throw new Error(t('sales.needClient'));
  const label = [t('directDeposit.lineLabel'), p.comment.trim()].filter(Boolean).join(' — ');
  const id = await createDocument({
    companyId: p.companyId, docType: DIRECT_DEPOSIT_DOC_TYPE, contactId: p.contactId, issueDate: p.date,
    status: 'validee', notes: p.comment.trim() || null,
    lines: [{ article_id: null, line_type: 'texte', designation: label, quantity: 0, unit_price_ht: 0, vat_rate: 0, discount_pct: 0 }],
  });
  // Encaissement refusé (caisse fermée, plafond espèces…) : l'acompte numéroté reste, sans argent ;
  // l'erreur remonte telle quelle et il peut être réglé depuis sa fiche.
  await addPayments(id, [{ method: p.method, amount: p.amount, status: 'recu', note: `Acompte direct${p.comment.trim() ? ` ${p.comment.trim()}` : ''}` }]);
  return id;
}

/** Acomptes directs d'un client encore disponibles (perçus, pas encore imputés). */
export async function listAvailableDirectDeposits(contactId: string): Promise<(DocumentRow & { available: number })[]> {
  const { data, error } = await supabase.from('documents').select('*')
    .eq('contact_id', contactId).eq('doc_type', DIRECT_DEPOSIT_DOC_TYPE).not('status', 'in', '("brouillon","annulee","converti")')
    .order('issue_date');
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, available: directDepositAvailable(d) })).filter((d) => d.available > 0.004);
}

/**
 * Impute un acompte direct sur un document ouvert du même client : règlements reportés, acompte
 * direct « converti », filiation enregistrée. Refus si le document cible est clos ou d'un autre client.
 */
export async function applyDirectDeposit(depositId: string, target: Pick<DocumentRow, 'id' | 'company_id' | 'contact_id' | 'status' | 'doc_type'>): Promise<number> {
  const { data: dep, error } = await supabase.from('documents').select('*').eq('id', depositId).single();
  if (error) throw error;
  if (dep.doc_type !== DIRECT_DEPOSIT_DOC_TYPE || isClosedDocStatus(dep.status)) throw new Error(t('directDeposit.notAvailable'));
  if (!target.contact_id || dep.contact_id !== target.contact_id) throw new Error(t('directDeposit.otherClient'));
  if (isClosedDocStatus(target.status) || target.doc_type === DIRECT_DEPOSIT_DOC_TYPE || target.doc_type === 'AVO') throw new Error(t('directDeposit.targetClosed'));
  const amount = await transferReceivedPayments(dep, target.id);
  const { error: ue } = await supabase.from('documents').update({ status: 'converti' }).eq('id', depositId);
  if (ue) throw ue;
  await linkSources(target.company_id, target.id, [depositId], 'direct_deposit');
  return amount;
}

/** Documents ouverts d'un client (G8 « Documents en attente ») : devis, BC, réservations, BL, acomptes, factures dues. */
export async function listPendingDocuments(contactId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase.from('documents').select('*')
    .eq('contact_id', contactId).in('doc_type', [...PENDING_DOC_TYPES])
    .not('status', 'in', '("brouillon","annulee","converti","avoir_emis")')
    .order('issue_date', { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}
