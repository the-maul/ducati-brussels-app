/**
 * M6 — Reste à payer d'un document et d'un client (mission 05, carte 9), règles pures testées par
 * tests/sales-balance.test.ts. « Important d'avoir en grand le solde restant dû » (Domenico, 7:59).
 *
 * Financement (organisme, montant, statut demandé / accepté / refusé) : seul un financement
 * ACCEPTÉ est déduit de ce que doit le client ; il est affiché « à recevoir de l'organisme » tant
 * que l'organisme n'a pas versé (règlements marqués `from_financing`).
 *   à recevoir de l'organisme = min(financé accepté − déjà versé par l'organisme, TTC − réglé)
 *   reste à payer par le client = max(0, TTC − réglé − à recevoir de l'organisme)
 * Seuls les règlements perçus comptent (un règlement « à échéance » n'est pas encore payé).
 */
export type FinancingStatus = 'demande' | 'accepte' | 'refuse';
export const FINANCING_STATUSES: readonly FinancingStatus[] = ['demande', 'accepte', 'refuse'];

export type BalancePayment = { amount: number | string; status: string; from_financing?: boolean | null };

export type BalanceDoc = {
  total_ttc: number | string;
  paid_amount?: number | string | null;
  financing_amount?: number | string | null;
  financing_status?: string | null;
  due_date?: string | null;
};

export type DocBalance = {
  ttc: number;
  paid: number;              // règlements perçus (client + organisme)
  paidByOrg: number;         // perçus de l'organisme de financement
  financed: number;          // montant financé accepté (0 si demandé / refusé)
  financingPending: number;  // montant demandé, pas encore accepté (information)
  toReceiveFromOrg: number;  // financement accepté pas encore versé
  clientDue: number;         // reste à payer par le client
  overdue: boolean;          // reste à payer > 0 et échéance passée
};

const n = (v: number | string | null | undefined) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * `payments` : règlements du document ; s'il n'y en a aucun (null ou vide), `paid_amount` du document
 * est pris comme réglé par le client (aucun versement de l'organisme connu).
 */
export function documentBalance(doc: BalanceDoc, payments: BalancePayment[] | null, today: string): DocBalance {
  const ttc = n(doc.total_ttc);
  // Pas de règlement enregistré (ex. factures reprises de G8) : on se fie au réglé du document.
  const received = payments && payments.length > 0 ? payments.filter((p) => p.status === 'recu') : null;
  const paid = received ? received.reduce((s, p) => s + n(p.amount), 0) : n(doc.paid_amount);
  const paidByOrg = received ? received.filter((p) => !!p.from_financing).reduce((s, p) => s + n(p.amount), 0) : 0;
  const amount = n(doc.financing_amount);
  const financed = doc.financing_status === 'accepte' ? amount : 0;
  const financingPending = doc.financing_status === 'demande' ? amount : 0;
  const open = Math.max(ttc - paid, 0);
  const toReceiveFromOrg = Math.min(Math.max(financed - paidByOrg, 0), open);
  const clientDue = Math.max(ttc - paid - toReceiveFromOrg, 0);
  const overdue = clientDue > 0.005 && !!doc.due_date && doc.due_date < today;
  return {
    ttc: r2(ttc), paid: r2(paid), paidByOrg: r2(paidByOrg), financed: r2(financed), financingPending: r2(financingPending),
    toReceiveFromOrg: r2(toReceiveFromOrg), clientDue: r2(clientDue), overdue,
  };
}

/** Documents qui comptent dans l'encours d'un client : ventes engagées, ni brouillon, ni annulées, ni converties. */
export const OPEN_BALANCE_DOC_TYPES = ['FAC', 'TIK', 'BC', 'RES', 'BL'] as const;
export function isOpenForBalance(d: { doc_type: string; status: string }): boolean {
  return (OPEN_BALANCE_DOC_TYPES as readonly string[]).includes(d.doc_type)
    && !['brouillon', 'annulee', 'converti'].includes(d.status);
}

export type ContactBalance = { clientDue: number; toReceiveFromOrg: number; financingPending: number; openDocs: number; overdue: boolean };

/** Encours d'un client : somme sur ses documents ouverts (même calcul que pour un document). */
export function contactBalance(
  docs: (BalanceDoc & { id: string; doc_type: string; status: string })[],
  paymentsByDoc: Map<string, BalancePayment[]>,
  today: string,
): ContactBalance {
  let clientDue = 0, toReceive = 0, pending = 0, openDocs = 0, overdue = false;
  for (const d of docs) {
    if (!isOpenForBalance(d)) continue;
    const b = documentBalance(d, paymentsByDoc.get(d.id) ?? null, today);
    if (b.clientDue <= 0.005 && b.toReceiveFromOrg <= 0.005 && b.financingPending <= 0.005) continue;
    openDocs += 1;
    clientDue += b.clientDue;
    toReceive += b.toReceiveFromOrg;
    pending += b.financingPending;
    overdue = overdue || b.overdue;
  }
  return { clientDue: r2(clientDue), toReceiveFromOrg: r2(toReceive), financingPending: r2(pending), openDocs, overdue };
}
