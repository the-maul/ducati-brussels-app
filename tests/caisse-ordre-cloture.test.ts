/**
 * Chantier C6 (CAI-06) — ordre de clôture : comptage → remise en banque → clôture Z, sans blocage (Q31).
 * Les calculs de caisse restent couverts par caisse-cloture, caisse-legale et caisse-remise-banque.
 */
import { test, expect, describe } from 'bun:test';
import {
  CLOSE_ORDER, closeOrderTrail, depositCashOut, depositProgress, drawerChangeSinceCount, methodsToCheck,
} from '../src/modules/sales/cash-close-order';
import { DrawerBook } from '../src/modules/sales/cash-deposit-rules';
import { cashVariance } from '../src/modules/sales/cash-rules';

const line = (method: string, source_type: string, amount: number, deposit_id: string | null = null) => ({ method, source_type, amount, deposit_id });

describe('ordre affiché', () => {
  test('comptage, puis remise en banque, puis clôture Z', () => {
    expect([...CLOSE_ORDER]).toEqual(['count', 'deposit', 'z']);
  });
  test('au départ, seul le comptage est en cours', () => {
    const s = closeOrderTrail('count', { counted: false, deposit: null });
    expect(s.map((x) => x.current)).toEqual([true, false, false]);
    expect(s.map((x) => x.state)).toEqual(['todo', 'todo', 'todo']);
  });
  test('remise faite : comptage et remise cochés au Z', () => {
    const s = closeOrderTrail('z', { counted: true, deposit: 'done' });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'todo']);
    expect(s[2].current).toBe(true);
  });
  test('rien à remettre : la remise est cochée', () => {
    expect(closeOrderTrail('z', { counted: true, deposit: 'nothing' })[1].state).toBe('done');
  });
  test('remise manquante : prévenue une fois dépassée, le Z reste accessible', () => {
    expect(closeOrderTrail('deposit', { counted: true, deposit: 'pending' })[1].state).toBe('todo');
    const s = closeOrderTrail('z', { counted: true, deposit: 'pending' });
    expect(s[1].state).toBe('warning');
    expect(s[2].current).toBe(true);
  });
  test('contrôle indisponible : aucune alerte inventée', () => {
    expect(closeOrderTrail('z', { counted: true, deposit: null })[1].state).toBe('todo');
  });
});

describe('état de la remise', () => {
  test('lignes non remises : détail par mode, espèces en premier', () => {
    const p = depositProgress([line('MAE', 'payment', 80), line('ESP', 'payment', 50), line('ESP', 'movement', -10)]);
    expect(p.state).toBe('pending');
    expect(p.pendingCount).toBe(3);
    expect(p.byMethod).toEqual([{ method: 'ESP', count: 2, amount: 40 }, { method: 'MAE', count: 1, amount: 80 }]);
  });
  test('tout remis : faite', () => {
    expect(depositProgress([line('ESP', 'payment', 50, 'D1')]).state).toBe('done');
  });
  test('le report et les écarts sont le fond du tiroir, pas une remise à faire', () => {
    const p = depositProgress([line('ESP', 'report', 100), line('ESP', 'opening_gap', 100), line('ESP', 'closing_gap', -2)]);
    expect(p.state).toBe('nothing');
  });
  test('remise annulée : sa sortie et sa compensation ne sont pas un oubli', () => {
    expect(depositProgress([line('ESP', 'movement', -60), line('ESP', 'movement', 60)]).state).toBe('nothing');
  });
  test('règlement et remboursement de même montant : restent à traiter', () => {
    expect(depositProgress([line('ESP', 'payment', 30), line('ESP', 'payment', -30)]).state).toBe('pending');
  });
  test('modes contrôlés : ceux de la caisse, sans avoir, arrondi, reprise ni retenue dépôt', () => {
    expect(methodsToCheck(['ESP', 'MAE', 'AVO', 'ARR'], ['ESP', 'DEP', 'REP', 'VIR'])).toEqual(['ESP', 'MAE', 'VIR']);
  });
});

describe('comptage fait avant la remise (scénario de la journée type)', () => {
  test('la remise est détectée, la grille corrigée donne un Z sans écart et sans changer le calcul', () => {
    const b = new DrawerBook();
    b.open(100); b.pay('ESP', 900);
    const sid = b.openSession()!.id;
    const toRows = () => b.movements.map((m) => ({ kind: m.kind, method: m.method, amount: m.amount, deposit_id: m.depositId }));

    const counted = 1000;
    const outAtCount = depositCashOut(toRows());
    expect(cashVariance(counted, b.expected(sid))).toBe(0);

    b.deposit('ESP', 'remise', 900);
    expect(drawerChangeSinceCount(outAtCount, toRows())).toBe(900);
    // Sans correction, le Z afficherait un faux écart de 900 € : c'est ce que le fil évite.
    expect(cashVariance(counted, b.expected(sid))).toBe(900);

    const recounted = 100;
    expect(cashVariance(recounted, b.expected(sid))).toBe(0);
    b.close(recounted);
    expect(b.sessions[0].counted).toBe(b.sessions[0].expected);
  });
  test('remise annulée après le comptage : la compensation ramène au comptage d origine', () => {
    const b = new DrawerBook();
    b.open(100); b.pay('ESP', 60);
    const rows = () => b.movements.map((m) => ({ kind: m.kind, method: m.method, amount: m.amount, deposit_id: m.depositId }));
    const base = depositCashOut(rows());
    const d = b.deposit('ESP', 'remise', 60);
    expect(drawerChangeSinceCount(base, rows())).toBe(60);
    b.cancel(d);
    expect(drawerChangeSinceCount(base, rows())).toBe(0);
  });
  test('vente ou mouvement ordinaire après le comptage : pas confondu avec une remise', () => {
    const rows = [{ kind: 'out', method: 'ESP', amount: 10, deposit_id: null }];
    expect(drawerChangeSinceCount(0, rows)).toBe(0);
  });
  test('remise en carte : aucune espèce ne sort du tiroir', () => {
    expect(depositCashOut([{ kind: 'out', method: 'MAE', amount: 50, deposit_id: 'D1' }])).toBe(0);
  });
  test('pas encore de comptage : rien à corriger', () => {
    expect(drawerChangeSinceCount(null, [{ kind: 'out', method: 'ESP', amount: 50, deposit_id: 'D1' }])).toBe(0);
  });
});
