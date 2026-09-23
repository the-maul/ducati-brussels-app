/**
 * Tests M6 — gestion des listes de préparation (mission 02, carte « picking list »).
 * Règles miroir des fonctions SQL picking_cancel / picking_regenerate (migration 20260919380000) :
 *   - suppression réelle seulement si rien n'est préparé ni monté, sinon annulation avec motif ;
 *   - régénération depuis le document : ajoute, signale les lignes retirées, GARDE les états.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  pickingCancelMode, pickingDisplayStatus, pickingActions, planRegeneration, filterPickings, sortPickings,
  DEFAULT_PICKING_FILTERS, type RegenItem, type RegenDocLine, type PickingFilterRow,
} from '../src/modules/sales/preparation';

test('annuler / supprimer : suppression réelle si rien n\'est préparé ni monté', () => {
  expect(pickingCancelMode('en_cours', [])).toBe('delete');
  expect(pickingCancelMode('en_cours', [{ prep_step: null, qty_picked: 0 }, { prep_step: null, qty_picked: 0 }])).toBe('delete');
  // « commandé » seul ne sort rien du casier : la liste peut encore être supprimée
  expect(pickingCancelMode('en_cours', [{ prep_step: 'commande', qty_picked: 0 }])).toBe('delete');
});

test('annuler / supprimer : annulation (avec motif) dès qu\'une ligne est préparée ou montée', () => {
  expect(pickingCancelMode('en_cours', [{ prep_step: null, qty_picked: 0 }, { prep_step: 'prepare', qty_picked: 1 }])).toBe('cancel');
  expect(pickingCancelMode('pret', [{ prep_step: 'monte', qty_picked: 1 }])).toBe('cancel');
  // ancienne saisie de quantité préparée sans étape
  expect(pickingCancelMode('en_cours', [{ prep_step: null, qty_picked: 2 }])).toBe('cancel');
  // une liste terminée n'est jamais supprimée
  expect(pickingCancelMode('livre', [])).toBe('cancel');
});

const item = (p: Partial<RegenItem> & { id: string }): RegenItem => ({
  document_line_id: null, article_id: null, designation: null, qty_ordered: 1, prep_step: null, removed: false, ...p,
});
const dl = (p: Partial<RegenDocLine> & { id: string }): RegenDocLine => ({
  article_id: null, designation: null, quantity: 1, line_type: 'article', ...p,
});

test('régénération : nouvelles lignes ajoutées, lignes retirées signalées, états gardés', () => {
  const items = [
    item({ id: 'i1', document_line_id: 'l1', article_id: 'a1', designation: 'Moto', prep_step: 'prepare' }),
    item({ id: 'i2', document_line_id: 'l2', article_id: 'a2', designation: 'Valises', prep_step: 'commande' }),
    item({ id: 'i3', document_line_id: 'l3', article_id: 'a3', designation: 'Échappement', prep_step: 'monte' }),
  ];
  const doc = [
    dl({ id: 'l1', article_id: 'a1', designation: 'Moto', quantity: 1 }),
    dl({ id: 'l2', article_id: 'a2', designation: 'Valises', quantity: 2 }),
    // l3 retirée du document ; l4 ajoutée ; texte / MO ignorés
    dl({ id: 'l4', article_id: 'a4', designation: 'Poignées chauffantes' }),
    dl({ id: 'l5', designation: 'Commentaire', line_type: 'texte', quantity: 0 }),
    dl({ id: 'l6', designation: 'MO montage', line_type: 'main_oeuvre', quantity: 5.5 }),
  ];
  const plan = planRegeneration(items, doc);
  expect(plan.added).toEqual(['l4']);
  expect(plan.removed).toEqual(['i3']);
  const kept = Object.fromEntries(plan.kept.map((k) => [k.itemId, k]));
  expect(kept.i1.prep_step).toBe('prepare');
  expect(kept.i1.qtyChanged).toBe(false);
  expect(kept.i2.prep_step).toBe('commande');
  expect(kept.i2.qty).toBe(2);
  expect(kept.i2.qtyChanged).toBe(true);
});

test('régénération : une ligne recréée dans le document (lien perdu) retrouve son état par article + désignation', () => {
  const items = [item({ id: 'i1', document_line_id: null, article_id: 'a1', designation: 'Moto', prep_step: 'monte' })];
  const plan = planRegeneration(items, [dl({ id: 'l9', article_id: 'a1', designation: 'Moto' })]);
  expect(plan.added).toEqual([]);
  expect(plan.removed).toEqual([]);
  expect(plan.kept[0]).toMatchObject({ itemId: 'i1', lineId: 'l9', prep_step: 'monte' });
});

test('régénération : une ligne déjà signalée retirée n\'est pas re-signalée, et revient si le document la reprend', () => {
  const removed = item({ id: 'i1', article_id: 'a1', designation: 'Moto', prep_step: 'prepare', removed: true });
  expect(planRegeneration([removed], []).removed).toEqual([]);
  const back = planRegeneration([removed], [dl({ id: 'l1', article_id: 'a1', designation: 'Moto' })]);
  expect(back.kept[0]).toMatchObject({ restored: true, prep_step: 'prepare' });
});

test('régénération sans changement : rien à ajouter ni à retirer', () => {
  const items = [item({ id: 'i1', document_line_id: 'l1', article_id: 'a1', designation: 'Moto' })];
  const plan = planRegeneration(items, [dl({ id: 'l1', article_id: 'a1', designation: 'Moto' })]);
  expect(plan).toEqual({ kept: [{ itemId: 'i1', lineId: 'l1', qty: 1, prep_step: null, qtyChanged: false, restored: false }], removed: [], added: [] });
});

const counts = (p: Partial<Parameters<typeof pickingDisplayStatus>[0]> = {}) => ({
  status: 'en_cours', lines_total: 3, lines_ordered: 0, lines_prepared: 0, lines_mounted: 0, ...p,
});

test('statut affiché d\'une liste', () => {
  expect(pickingDisplayStatus(counts())).toBe('a_preparer');
  expect(pickingDisplayStatus(counts({ lines_ordered: 1 }))).toBe('en_cours');
  expect(pickingDisplayStatus(counts({ lines_prepared: 2 }))).toBe('en_cours');
  expect(pickingDisplayStatus(counts({ status: 'pret', lines_prepared: 3, lines_mounted: 1 }))).toBe('prete');
  expect(pickingDisplayStatus(counts({ status: 'pret', lines_prepared: 3, lines_mounted: 3 }))).toBe('montee');
  expect(pickingDisplayStatus(counts({ status: 'livre', lines_prepared: 3 }))).toBe('terminee');
  expect(pickingDisplayStatus(counts({ status: 'annulee', lines_prepared: 3 }))).toBe('annulee');
  expect(pickingDisplayStatus(counts({ lines_total: 0 }))).toBe('a_preparer');
});

test('actions possibles selon le statut', () => {
  const base = { document_id: 'd1', lines_total: 2, lines_prepared: 2 };
  // `order` : mission 07 carte 2 — commander les pièces manquantes depuis la liste elle-même.
  expect(pickingActions({ ...base, status: 'pret' })).toEqual({ cancel: true, reopen: false, regenerate: true, finish: true, editSteps: true, order: true });
  expect(pickingActions({ ...base, status: 'en_cours', lines_prepared: 1 }).finish).toBe(false);
  expect(pickingActions({ ...base, status: 'annulee' })).toEqual({ cancel: false, reopen: true, regenerate: false, finish: false, editSteps: false, order: false });
  expect(pickingActions({ ...base, status: 'livre' })).toMatchObject({ cancel: true, reopen: true, editSteps: false });
  expect(pickingActions({ ...base, status: 'en_cours', document_id: null }).regenerate).toBe(false);
  // une liste ouverte depuis un OR n'a pas de document : elle se commande quand même
  expect(pickingActions({ ...base, status: 'en_cours', document_id: null }).order).toBe(true);
  expect(pickingActions({ ...base, status: 'en_cours', lines_total: 0 }).order).toBe(false);
});

const row = (p: Partial<PickingFilterRow>): PickingFilterRow => ({
  ...counts(), client_name: null, doc_number: null, seller_name: null, created_at: '2026-09-19T10:00:00Z', vehicle_label: null, ...p,
});

test('filtres et tri de la page des listes', () => {
  const rows = [
    row({ client_name: 'Moreau Simon', doc_number: 'DEV-001', seller_name: 'Domenico', created_at: '2026-09-18T10:00:00Z' }),
    row({ client_name: 'Dupont', doc_number: 'BC-002', seller_name: 'Simon', lines_prepared: 3, status: 'pret' }),
    row({ client_name: 'Élodie Martin', doc_number: 'FAC-003', status: 'annulee' }),
  ];
  expect(filterPickings(rows, DEFAULT_PICKING_FILTERS).length).toBe(2); // annulée masquée par défaut
  expect(filterPickings(rows, { ...DEFAULT_PICKING_FILTERS, status: 'toutes', search: 'elodie' }).length).toBe(1);
  expect(filterPickings(rows, { ...DEFAULT_PICKING_FILTERS, search: 'dev-001' })[0].client_name).toBe('Moreau Simon');
  expect(filterPickings(rows, { ...DEFAULT_PICKING_FILTERS, seller: 'Simon' })[0].client_name).toBe('Dupont');
  expect(filterPickings(rows, { ...DEFAULT_PICKING_FILTERS, status: 'prete' }).length).toBe(1);
  expect(filterPickings(rows, { ...DEFAULT_PICKING_FILTERS, from: '2026-09-19' }).length).toBe(1);
  expect(sortPickings(rows, 'client', 'asc').map((r) => r.doc_number)).toEqual(['BC-002', 'FAC-003', 'DEV-001']);
  expect(sortPickings(rows, 'date', 'desc')[2].doc_number).toBe('DEV-001');
});
