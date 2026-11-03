/**
 * Tests M6 (POS) — vente comptoir, audit caisse du 03/11/2026 (PDV000, PDV001) :
 *  - un ticket ne se cree ni sans ligne, ni a 0 EUR (TIK-2026-00001 de juin 2026 : 0 EUR, passe) ;
 *  - une quantite a 0 ou negative ne part pas sur le ticket ;
 *  - le scan n ajoute un article d office que s il est seul a correspondre ;
 *  - reste a encaisser = TTC − reglements percus (un reglement a echeance ne compte pas) ;
 *  - un avoir se genere depuis une facture ou un ticket, jamais depuis un document annule.
 */
import { test, expect, describe } from 'bun:test';
import { posCartError, posTicketLines, scanAutoPick, ticketRemaining, localIsoDate } from '../src/modules/sales/pos-rules';
import { canGenerateCreditNote, CREDIT_NOTE_SOURCE_TYPES } from '../src/modules/sales/write-api';

const art = (p: Partial<{ quantity: number; unit_price_ht: number }> = {}) => ({
  article_id: 'a1', designation: 'Casque', quantity: 1, unit_price_ht: 100, vat_rate: 21, ...p,
});

describe('posCartError — ce qui empeche d encaisser', () => {
  test('panier vide → needLine', () => {
    expect(posCartError([])).toBe('needLine');
  });
  test('seule ligne a quantite 0 → needLine (elle ne part pas sur le ticket)', () => {
    expect(posCartError([art({ quantity: 0 })])).toBe('needLine');
  });
  test('article a 0 EUR → needAmount (plus de ticket a 0 EUR)', () => {
    expect(posCartError([art({ unit_price_ht: 0 })])).toBe('needAmount');
  });
  test('article avec un prix → ticket possible, sans client (vente comptoir anonyme)', () => {
    expect(posCartError([art()])).toBeNull();
  });
});

describe('posTicketLines — lignes qui partent sur le ticket', () => {
  test('quantites nulles ou negatives ecartees, remise ligne a 0, type article', () => {
    const lines = posTicketLines([art(), art({ quantity: 0 }), art({ quantity: -2 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ article_id: 'a1', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 0, line_type: 'article' });
  });
});

describe('scanAutoPick — Entree n ajoute que l article unique', () => {
  test('un seul resultat → ajoute', () => {
    expect(scanAutoPick([{ id: 'x' }])).toEqual({ id: 'x' });
  });
  test('plusieurs resultats → rien (le vendeur choisit dans la liste)', () => {
    expect(scanAutoPick([{ id: 'x' }, { id: 'y' }])).toBeNull();
  });
  test('aucun resultat ou recherche pas encore faite → rien', () => {
    expect(scanAutoPick([])).toBeNull();
    expect(scanAutoPick(undefined)).toBeNull();
  });
});

describe('ticketRemaining — reste a encaisser', () => {
  test('rien de regle → tout le TTC', () => {
    expect(ticketRemaining(121, [])).toBe(121);
  });
  test('regle en deux fois (especes + carte) → 0', () => {
    expect(ticketRemaining(121, [{ amount: 21, status: 'recu' }, { amount: '100', status: 'recu' }])).toBe(0);
  });
  test('un reglement a echeance ne reduit pas le reste', () => {
    expect(ticketRemaining(121, [{ amount: 121, status: 'attendu' }])).toBe(121);
  });
  test('trop percu → 0, jamais negatif ; arrondi au cent', () => {
    expect(ticketRemaining(10.02, [{ amount: 10, status: 'recu' }, { amount: 0.02, status: 'recu' }])).toBe(0);
    expect(ticketRemaining(10.02, [{ amount: 10, status: 'recu' }])).toBe(0.02);
    expect(ticketRemaining(100, [{ amount: 150, status: 'recu' }])).toBe(0);
  });
});

describe('localIsoDate — la date du ticket est la date locale du poste', () => {
  test('00 h 30 le 15 janvier (heure locale) → 2026-01-15, pas la veille en UTC', () => {
    const d = new Date(2026, 0, 15, 0, 30, 0);
    expect(localIsoDate(d)).toBe('2026-01-15');
  });
  test('format AAAA-MM-JJ avec zeros', () => {
    expect(localIsoDate(new Date(2026, 2, 5, 12, 0, 0))).toBe('2026-03-05');
  });
});

describe('canGenerateCreditNote — l avoir annule une facture ou un ticket', () => {
  test('FAC, TIK et facture d acompte FAA (lot facture legale du 03/11/2026) sont les seules sources', () => {
    expect([...CREDIT_NOTE_SOURCE_TYPES]).toEqual(['FAC', 'TIK', 'FAA']);
  });
  test('ticket valide ou paye → oui ; devis, brouillon, annule, converti → non', () => {
    expect(canGenerateCreditNote({ doc_type: 'TIK', status: 'validee' })).toBe(true);
    expect(canGenerateCreditNote({ doc_type: 'TIK', status: 'payee' })).toBe(true);
    expect(canGenerateCreditNote({ doc_type: 'FAC', status: 'payee' })).toBe(true);
    expect(canGenerateCreditNote({ doc_type: 'DEV', status: 'validee' })).toBe(false);
    expect(canGenerateCreditNote({ doc_type: 'FAC', status: 'brouillon' })).toBe(false);
    expect(canGenerateCreditNote({ doc_type: 'FAC', status: 'annulee' })).toBe(false);
    expect(canGenerateCreditNote({ doc_type: 'TIK', status: 'converti' })).toBe(false);
    expect(canGenerateCreditNote({ doc_type: 'AVO', status: 'validee' })).toBe(false);
  });
});
