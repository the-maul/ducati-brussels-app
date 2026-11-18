/**
 * Rattrapage G8 (18/11/2026, lot parc) — « Devis de reparation » recopiant les lignes de l'OR et
 * « Dupliquer » un OR (G8 : edition de l'OR en Devis ; bouton Dupliquer du rappel d'OR).
 * Logique PURE, testee dans tests/kits-insertion.test.ts.
 *
 * Memes regles que la facture de l'OR (`transformToInvoice`) : les actions du check-up « OK » ou
 * « reportees » ne sont ni devisees ni recopiees ; une carte sans heures devient un texte ; une
 * ligne en garantie est devisee a 0 €.
 */
import { invoiceableRoLines } from './checkup/rules';

export type RoRowLike = {
  kind: string; article_id: string | null; designation: string; quantity: number | string; unit_price_ht: number | string;
  vat_rate: number | string; discount_pct: number | string; is_warranty: boolean; checkup_state?: string | null;
};

export type QuoteLine = {
  article_id: string | null; designation: string; quantity: number; unit_price_ht: number; vat_rate: number;
  discount_pct: number; line_type: 'article' | 'main_oeuvre' | 'texte';
};

/** Lignes du devis de reparation (document DEV) depuis les lignes de l'OR. */
export function roLinesToQuoteLines(lines: ReadonlyArray<RoRowLike>): QuoteLine[] {
  return invoiceableRoLines(lines.slice() as RoRowLike[]).map((l) => {
    const text = l.as_text || l.kind === 'texte';
    return {
      article_id: text ? null : l.article_id,
      designation: l.designation,
      quantity: text ? 0 : Number(l.quantity),
      unit_price_ht: text || l.is_warranty ? 0 : Number(l.unit_price_ht),
      vat_rate: Number(l.vat_rate),
      discount_pct: text ? 0 : Number(l.discount_pct),
      line_type: text ? 'texte' : l.kind === 'mo' ? 'main_oeuvre' : 'article',
    };
  });
}

export type DuplicatedRoLine = {
  kind: 'piece' | 'mo' | 'texte'; article_id: string | null; designation: string; quantity: number;
  unit_price_ht: number; vat_rate: number; discount_pct: number; is_warranty: boolean;
};

/**
 * Lignes d'un OR duplique : memes pieces, MO et textes, prix d'origine ; sans etat de check-up,
 * photo ni lien a la proposition signee (un nouvel OR repart d'un accord client vierge) ;
 * la garantie n'est pas recopiee (a redemander au constructeur).
 */
export function duplicateRoLines(lines: ReadonlyArray<RoRowLike>): DuplicatedRoLine[] {
  return invoiceableRoLines(lines.slice() as RoRowLike[]).map((l) => ({
    kind: (l.as_text ? 'texte' : (['piece', 'mo', 'texte'].includes(l.kind) ? l.kind : 'piece')) as DuplicatedRoLine['kind'],
    article_id: l.as_text ? null : l.article_id,
    designation: l.designation,
    quantity: l.as_text ? 0 : Number(l.quantity),
    unit_price_ht: l.as_text ? 0 : Number(l.unit_price_ht),
    vat_rate: Number(l.vat_rate),
    discount_pct: Number(l.discount_pct),
    is_warranty: false,
  }));
}
