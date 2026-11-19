/**
 * M8 — Parcours mecanicien, lot D (19/11/2026) : reparation guidee par le plan d'entretien, reliee
 * a l'OR, regles pures (miroir de la migration 20261119271000).
 *  - avancement x / y (faite / non faite / obligatoires restantes) ;
 *  - « Terminer » propose seulement quand toutes les obligatoires sont reglees et l'OR ouvert ;
 *  - motifs « non faite » (intervention reportee), texte « operations non realisees » ;
 *  - lignes de l'OR consommees par operation, couleurs de statut.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  DEFAULT_NOT_DONE_REASONS, canEditOps, canFinish, isResolved, linesByOperation, notDoneText, opTone, planProgress,
  progressTone, reasonText, toNotDoneReason, type PlanOp,
} from '../src/modules/workshop/plan-ops/rules';

const op = (n: number, status: PlanOp['status'], extra: Partial<PlanOp> = {}): PlanOp => ({
  id: `o${n}`, or_id: 'or-1', op_key: `op${n}`, sort_order: n, label: `Operation ${n}`, source: 'manuel', service_code: 'oil',
  service_label: 'Oil Service', procedure_id: null, family_codes: [], mandatory: true, status, done_at: null, done_by_name: null,
  time_entry_id: null, time_entry_operation: null, not_done_reason: null, not_done_note: null, deferred_intervention_id: null, ...extra,
});
const tr = (k: string) => k;

describe('lot D — avancement', () => {
  test('x / y : faites et non faites reglees, obligatoires restantes', () => {
    const p = planProgress([op(1, 'fait'), op(2, 'non_fait'), op(3, 'a_faire'), op(4, 'a_faire', { mandatory: false })]);
    expect(p).toEqual({ total: 4, done: 1, notDone: 1, resolved: 2, mandatoryTotal: 3, mandatoryOpen: 1, percent: 50 });
  });
  test('liste vide : 0 %', () => {
    expect(planProgress([]).percent).toBe(0);
  });
  test('couleur de l avancement', () => {
    expect(progressTone({ total: 0, resolved: 0 })).toBe('neutral');
    expect(progressTone({ total: 5, resolved: 0 })).toBe('neutral');
    expect(progressTone({ total: 5, resolved: 2 })).toBe('info');
    expect(progressTone({ total: 5, resolved: 5 })).toBe('success');
  });
});

describe('lot D — « Terminer »', () => {
  test('propose quand toutes les obligatoires sont faites ou non faites, une complementaire peut rester', () => {
    const ops = [op(1, 'fait'), op(2, 'non_fait', { not_done_reason: 'refus_client' }), op(3, 'a_faire', { mandatory: false })];
    expect(canFinish(ops, 'en_cours')).toBe(true);
    expect(canFinish(ops, 'a_faire')).toBe(true);
  });
  test('refuse avec une obligatoire a faire, sans liste, ou OR deja pret / facture', () => {
    expect(canFinish([op(1, 'fait'), op(2, 'a_faire')], 'en_cours')).toBe(false);
    expect(canFinish([], 'en_cours')).toBe(false);
    expect(canFinish([op(1, 'fait')], 'pret')).toBe(false);
    expect(canFinish([op(1, 'fait')], 'facture')).toBe(false);
  });
  test('on ne coche plus sur un OR facture ou annule', () => {
    expect(canEditOps('en_cours')).toBe(true);
    expect(canEditOps('pret')).toBe(true);
    expect(canEditOps('facture')).toBe(false);
    expect(canEditOps('annule')).toBe(false);
  });
});

describe('lot D — non faite', () => {
  test('motifs par defaut : refus du client et piece indisponible creent une intervention reportee', () => {
    expect(DEFAULT_NOT_DONE_REASONS.filter((r) => r.defer).map((r) => r.code)).toEqual(['refus_client', 'piece_indisponible']);
    expect(toNotDoneReason({ code: 'x', label: 'X', extra: { defer: true } }).defer).toBe(true);
    expect(toNotDoneReason({ code: 'x', label: 'X', extra: null }).defer).toBe(false);
  });
  test('libelle du motif : Parametres, sinon traduction, sinon code', () => {
    expect(reasonText('refus_client', DEFAULT_NOT_DONE_REASONS, tr)).toBe('Refus du client');
    expect(reasonText('inconnu', [], tr)).toBe('inconnu');
  });
  test('texte des operations non realisees (impression, miroir des notes de facture)', () => {
    const ops = [op(2, 'non_fait', { label: 'Vidange liquide de frein', not_done_reason: 'refus_client', not_done_note: 'en mars' }), op(1, 'fait')];
    expect(notDoneText(ops, DEFAULT_NOT_DONE_REASONS, tr, 'Opérations non réalisées')).toBe('Opérations non réalisées : Vidange liquide de frein (Refus du client : en mars)');
    expect(notDoneText([op(1, 'fait')], DEFAULT_NOT_DONE_REASONS, tr, 'X')).toBeNull();
  });
  test('reglee = faite ou non faite', () => {
    expect(isResolved('fait')).toBe(true);
    expect(isResolved('non_fait')).toBe(true);
    expect(isResolved('a_faire')).toBe(false);
  });
});

describe('lot D — lignes de l OR et statuts', () => {
  test('lignes par operation, sans doublon', () => {
    const m = linesByOperation([
      { operation_id: 'o1', line_id: 'l1', family_code: 'huile_moteur', article_id: 'a1', designation: 'Huile', quantity: 3.4 },
      { operation_id: 'o1', line_id: 'l2', family_code: 'filtre_huile', article_id: 'a2', designation: 'Filtre', quantity: 1 },
      { operation_id: 'o1', line_id: 'l1', family_code: 'huile_moteur', article_id: 'a1', designation: 'Huile', quantity: 3.4 },
    ]);
    expect(m.get('o1')?.map((l) => l.line_id)).toEqual(['l1', 'l2']);
  });
  test('couleur du statut d une operation', () => {
    expect(opTone('fait')).toBe('success');
    expect(opTone('non_fait')).toBe('warning');
    expect(opTone('a_faire')).toBe('neutral');
  });
});
