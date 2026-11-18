/**
 * Encaissements (rattrapage G8, 18/11/2026) — relances d'impayés : règles PURES, testées
 * (tests/encaissements-g8.test.ts). Aucune lecture de base ni envoi ici.
 *
 * G8 : modèles 01 Relevé de factures · 02 Première relance · 03 Deuxième relance · 04 Dernier
 * rappel (lettre AR) ; niveau, agio %, montant minimum ; à l'envoi « montant frais » et « majorer
 * de % » ; 4 blocs de texte. Ici : frais = frais fixes + majoration % du montant dû, arrondis au cent.
 *
 * ENVOI EN MODE TEST UNIQUEMENT (journal du 03/11 : « relances = test → simon@themaul.be ») :
 * `resolveDunningDelivery` ne connaît que « arrêté » (rien ne part) et « test » (tout part à
 * l'adresse de test, objet préfixé). Un mode « actif » éventuel est TRAITÉ COMME TEST : l'envoi
 * réel aux clients n'existe pas dans ce code. La base (contrainte sur `receivable_settings`) et
 * `graph-send-email` (purpose `dunning`) refont le même contrôle.
 */
import { isEmail, testSubject } from '../../../supabase/functions/_shared/followups-mode';

export type DunningTemplate = {
  code: string; label: string; level: number; format: 'A4' | 'ticket';
  min_amount: number; fee_fixed: number; surcharge_pct: number;
  subject: string; header_text: string; body_text: string; closing_text: string; footer_text: string;
  is_active?: boolean; sort_order?: number;
};

export const DUNNING_MEDIA = ['mail', 'courrier', 'pdf'] as const;
export type DunningMedia = (typeof DUNNING_MEDIA)[number];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Frais d'une relance : fixes + majoration % du montant dû (jamais négatifs). */
export function dunningFees(amountDue: number, feeFixed: number, surchargePct: number): number {
  const due = Math.max(0, Number(amountDue) || 0);
  return r2(Math.max(0, Number(feeFixed) || 0) + due * Math.max(0, Number(surchargePct) || 0) / 100);
}

/** Variables reconnues dans les textes des modèles. */
export const DUNNING_VARIABLES = ['client', 'date', 'total_du', 'frais', 'total_a_payer', 'societe', 'iban'] as const;
export type DunningVars = Partial<Record<(typeof DUNNING_VARIABLES)[number], string>>;

/** Remplace {client}, {total_du}… ; une variable inconnue ou vide est laissée vide. */
export function fillDunningText(text: string, vars: DunningVars): string {
  return String(text ?? '').replace(/\{([a-z_]+)\}/g, (_, k: string) => (vars as Record<string, string | undefined>)[k] ?? '');
}

export type DunningRow = {
  document_id: string; number: string | null; issue_date: string; due_date: string;
  amount_due: number; contact_id: string; contact_name: string; email: string | null;
  next_code: string | null;
};

export type DunningLetter = {
  contactId: string; contactName: string; email: string | null; templateCode: string;
  rows: DunningRow[]; totalDue: number;
};

/**
 * Une lettre par client et par modèle (G8 : la grille est par facture, la lettre reprend les
 * factures du client). Le modèle d'une ligne = celui choisi pour l'envoi, sinon le suivant proposé.
 */
export function groupLetters(rows: DunningRow[], forcedCode: string | null, fallbackCode: string): DunningLetter[] {
  const map = new Map<string, DunningLetter>();
  for (const r of rows) {
    const code = forcedCode || r.next_code || fallbackCode;
    const key = `${r.contact_id}|${code}`;
    let l = map.get(key);
    if (!l) { l = { contactId: r.contact_id, contactName: r.contact_name, email: r.email, templateCode: code, rows: [], totalDue: 0 }; map.set(key, l); }
    l.rows.push(r);
    l.totalDue = r2(l.totalDue + Number(r.amount_due));
  }
  return [...map.values()].sort((a, b) => a.contactName.localeCompare(b.contactName) || a.templateCode.localeCompare(b.templateCode));
}

/** Seules les lignes dont le dû atteint le minimum du modèle partent (G8 « Montant minimum »). */
export function meetsMinimum(letter: DunningLetter, tpl: Pick<DunningTemplate, 'min_amount'>): boolean {
  return letter.totalDue + 0.005 >= Number(tpl.min_amount || 0);
}

export type DunningMode = 'arrete' | 'test';
/** Tout ce qui n'est pas « arrêté » est TEST : il n'y a pas d'envoi réel aux clients. */
export function normalizeDunningMode(m: unknown): DunningMode {
  return m === 'arrete' ? 'arrete' : 'test';
}

export type DunningDelivery =
  | { send: false; reason: 'arrete' | 'no_test_recipient' }
  | { send: true; to: string; subject: string; isTest: true };

/** Où part la relance : jamais chez le client, toujours à l'adresse de test (ou nulle part). */
export function resolveDunningDelivery(mode: unknown, testRecipient: string | null | undefined, subject: string, clientLabel: string): DunningDelivery {
  if (normalizeDunningMode(mode) === 'arrete') return { send: false, reason: 'arrete' };
  const to = String(testRecipient ?? '').trim().toLowerCase();
  if (!isEmail(to)) return { send: false, reason: 'no_test_recipient' };
  return { send: true, to, subject: testSubject(subject, clientLabel), isTest: true };
}
