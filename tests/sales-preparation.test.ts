/**
 * Tests M6 — liste de préparation sur tablette (mission 05, carte 6) : documents préparables,
 * état affiché d'une ligne (étape posée à la main, sinon disponibilité calculée) et avancement.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { canPrepareDocument, prepDisplayState, prepProgress } from '../src/modules/sales/preparation';

const line = (p: Partial<Parameters<typeof prepDisplayState>[0]> = {}) => ({
  prep_step: null, mgmt_type: 'A', real_qty: 0, reserved_qty: 0, on_order_qty: 0, qty_ordered: 1, article_id: 'a1', ...p,
});

test('bouton Préparer : devis, bon de commande, réservation, BL, facture ; jamais un document annulé', () => {
  expect(canPrepareDocument({ doc_type: 'DEV', status: 'validee' })).toBe(true);
  expect(canPrepareDocument({ doc_type: 'BC', status: 'brouillon' })).toBe(true);
  expect(canPrepareDocument({ doc_type: 'FAC', status: 'payee' })).toBe(true);
  expect(canPrepareDocument({ doc_type: 'FAC', status: 'annulee' })).toBe(false);
  expect(canPrepareDocument({ doc_type: 'TIK', status: 'validee' })).toBe(false);
  expect(canPrepareDocument({ doc_type: 'AVO', status: 'validee' })).toBe(false);
});

test('sans étape posée, la ligne affiche la disponibilité calculée', () => {
  expect(prepDisplayState(line({ real_qty: 2 }))).toBe('disponible');
  expect(prepDisplayState(line({ real_qty: 1, reserved_qty: 1, on_order_qty: 1 }))).toBe('en_commande');
  expect(prepDisplayState(line({ qty_ordered: 3, real_qty: 1 }))).toBe('a_commander');
  expect(prepDisplayState(line({ article_id: null }))).toBe('na');
  expect(prepDisplayState(line({ mgmt_type: 'M' }))).toBe('na');
});

test('une étape posée à la main l\'emporte sur le calcul', () => {
  expect(prepDisplayState(line({ prep_step: 'commande', real_qty: 5 }))).toBe('commande');
  expect(prepDisplayState(line({ prep_step: 'prepare' }))).toBe('prepare');
  expect(prepDisplayState(line({ prep_step: 'monte' }))).toBe('monte');
});

test('avancement = lignes préparées ou montées / total', () => {
  expect(prepProgress([])).toEqual({ done: 0, total: 0 });
  expect(prepProgress([{ prep_step: 'prepare' }, { prep_step: 'monte' }, { prep_step: 'commande' }, { prep_step: null }]))
    .toEqual({ done: 2, total: 4 });
});
