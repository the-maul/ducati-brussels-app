/**
 * M6 — « Documents en attente » d'un client (G8 : affichés au choix du client à la création d'un
 * document, Rappeler / Visualiser) et disponibilité d'un acompte direct. Règles pures.
 * Lot rattrapage G8 du 18/11/2026.
 */

/** Types proposés : devis / proforma, bon de commande, réservation, BL, acompte direct, factures dues. */
export const PENDING_DOC_TYPES = ['DEV', 'BC', 'RES', 'BL', 'ACD', 'FAC', 'TIK'] as const;

type DocLike = { doc_type: string; status: string; total_ttc: number | string; paid_amount: number | string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Montant encore disponible d'un acompte direct (perçu, pas encore imputé). */
export function directDepositAvailable(d: DocLike): number {
  if (d.doc_type !== 'ACD' || d.status === 'converti' || d.status === 'annulee' || d.status === 'brouillon') return 0;
  return Math.max(0, r2(Number(d.paid_amount) - Number(d.total_ttc)));
}

/**
 * Document « en attente » : devis, BC, réservation, BL ouverts ; acompte direct encore disponible ;
 * facture ou ticket avec un reste à payer. Les documents clos (brouillon, annulé, converti,
 * compensé par un avoir) n'en sont jamais.
 */
export function isPendingDocument(d: DocLike): boolean {
  if (['brouillon', 'annulee', 'converti', 'avoir_emis'].includes(d.status)) return false;
  if (d.doc_type === 'ACD') return directDepositAvailable(d) > 0.004;
  if (d.doc_type === 'FAC' || d.doc_type === 'TIK') return Number(d.total_ttc) - Number(d.paid_amount) > 0.004;
  return (PENDING_DOC_TYPES as readonly string[]).includes(d.doc_type);
}

/** Acompte versé (G8 « Acompte ») d'un document en attente : réglé sur un document non facturé. */
export function pendingDeposit(d: DocLike): number {
  if (d.doc_type === 'FAC' || d.doc_type === 'TIK') return 0;
  return r2(Number(d.paid_amount));
}
