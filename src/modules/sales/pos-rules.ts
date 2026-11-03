/**
 * M6 (POS) — Regles pures de la vente comptoir (audit caisse du 03/11/2026, PDV000) :
 *  - un ticket ne se cree pas sans ligne ni sans montant (le TIK-2026-00001 a 0 EUR de juin 2026
 *    etait passe sans un mot) ;
 *  - le scan n ajoute un article que s il est seul a correspondre (sinon on choisit dans la liste) ;
 *  - le reste a encaisser d un ticket se calcule sur les reglements percus.
 * Testees dans tests/caisse-vente-comptoir.test.ts.
 */
import { documentValidationError, type DocumentValidationError, type LineInput } from './write-api';

export type PosCartLine = { article_id: string | null; designation: string; quantity: number; unit_price_ht: number; vat_rate: number };

/** Lignes du panier qui partent sur le ticket (quantite strictement positive, remise ligne 0). */
export function posTicketLines(cart: PosCartLine[]): LineInput[] {
  return cart.filter((l) => Number(l.quantity) > 0).map((l) => ({
    article_id: l.article_id, designation: l.designation, quantity: Number(l.quantity),
    unit_price_ht: Number(l.unit_price_ht), vat_rate: Number(l.vat_rate), discount_pct: 0, line_type: 'article',
  }));
}

/** Motif de refus d un encaissement (cle `sales.<motif>`), ou null si le ticket peut etre cree. */
export function posCartError(cart: PosCartLine[]): DocumentValidationError | null {
  return documentValidationError({ docType: 'TIK', status: 'validee', lines: posTicketLines(cart), requireAmount: true });
}

/** Article a ajouter d office sur Entree : seulement quand la recherche ne renvoie qu un resultat. */
export function scanAutoPick<T>(results: readonly T[] | null | undefined): T | null {
  return results && results.length === 1 ? results[0] : null;
}

/**
 * Date du ticket = date LOCALE du poste (AAAA-MM-JJ). `toISOString()` donnait la date UTC : un
 * ticket encaisse a 00 h 30 en hiver a Bruxelles etait date de la veille.
 */
export function localIsoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Reste a encaisser sur un ticket = TTC moins les reglements percus (jamais negatif). */
export function ticketRemaining(totalTtc: number, payments: { amount: number | string; status: string | null }[]): number {
  const paid = payments.filter((p) => (p.status ?? 'recu') === 'recu').reduce((s, p) => s + Number(p.amount), 0);
  const rest = Math.round((Number(totalTtc) - paid) * 100) / 100;
  return rest > 0 ? rest : 0;
}
