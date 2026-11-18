/**
 * Tests M6 — Remise en banque façon G8 + journal Z (rattrapage G8 du 18/11/2026, PDV009, décision Q31).
 * Le modèle `DrawerBook` reproduit les fonctions SQL de 20261118150000 ; chaque scénario suit l'argent
 * PHYSIQUE du tiroir et vérifie que (1) les espèces du tiroir calculées = l'argent réel, (2) le théorique
 * du Z reste juste, (3) le caissier n'est jamais bloqué (chaque refus a une sortie).
 */
import { test, expect, describe } from 'bun:test';
import {
  DrawerBook, BookError, newFloatFrom, depositedFromNewFloat, effectiveDeposited, depositCheck, selectionTotal,
} from '../src/modules/sales/cash-deposit-rules';

const code = (fn: () => unknown): string => { try { fn(); return 'ok'; } catch (e) { return (e as BookError).code; } };

describe('calculs de l écran (G8 : report + sélection − remis = nouveau fond)', () => {
  test('G8 parcours 23 : report 350, espèces 27,64, test consommable −10, remis 267,64 → fond 100', () => {
    const total = selectionTotal([350, 27.64, -10]);
    expect(total).toBe(367.64);
    expect(newFloatFrom('ESP', 'remise', total, 267.64)).toBe(100);
    expect(depositedFromNewFloat(total, 100)).toBe(267.64);
  });
  test('carte / virement : toute la sélection est remise, pas de fond', () => {
    expect(effectiveDeposited('MAE', 'remise', 3165.59, 0)).toBe(3165.59);
    expect(newFloatFrom('MAE', 'remise', 3165.59, 3165.59)).toBeNull();
  });
  test('archiver sans remise : rien n est remis, les espèces restent en report', () => {
    expect(effectiveDeposited('ESP', 'archive', 50, 40)).toBe(0);
    expect(newFloatFrom('ESP', 'archive', 50, 40)).toBe(50);
  });
  test('contrôles : vide, remis > sélection, total négatif', () => {
    expect(depositCheck('ESP', 'remise', 0, 0, 0)).toBe('empty');
    expect(depositCheck('ESP', 'remise', 2, 100, 120)).toBe('exceeds');
    expect(depositCheck('ESP', 'remise', 1, -20, 0)).toBe('negativeTotal');
    expect(depositCheck('ESP', 'archive', 1, -20, 0)).toBe('negativeTotal');
    expect(depositCheck('MAE', 'remise', 1, -20, 0)).toBe('negativeTotal');
    expect(depositCheck('ESP', 'remise', 2, 100, 100)).toBe('none');
  });
});

describe('journée type : ouverture, ventes, Z, remise, fond proposé le lendemain', () => {
  test('première ouverture = « ouverture fond de caisse », remise après le Z, report repris', () => {
    const b = new DrawerBook(); let physical = 0;
    b.open(100); physical += 100;                       // fond apporté : écart d ouverture +100
    expect(b.pending('ESP').map((i) => [i.type, i.amount])).toEqual([['opening_gap', 100]]);
    b.pay('ESP', 50); physical += 50;
    b.pay('MAE', 80);
    b.move('out', 'ESP', 10); physical -= 10;           // achat de consommables
    expect(b.expected(b.openSession()!.id)).toBe(140);
    b.close(140);
    expect(b.balance()).toBe(physical);
    b.deposit('ESP', 'remise', 40); physical -= 40;     // après le Z : pas de mouvement, la caisse est fermée
    expect(b.movements).toHaveLength(1);
    expect(b.balance()).toBe(100);
    expect(b.balance()).toBe(physical);
    // Lendemain : le fond proposé est le report, aucun écart d ouverture.
    const s2 = b.open(100);
    expect(b.sessions.find((s) => s.id === s2)!.proposed).toBe(100);
    expect(b.pending('ESP').map((i) => i.type)).toEqual(['report']);
    // Remise carte : toute la sélection, pas de report.
    b.deposit('MAE', 'remise', 0);
    expect(b.pending('MAE')).toHaveLength(0);
  });
});

describe('cas limites (décision Q31 : aucun blocage)', () => {
  test('remise AVANT le Z : sortie 01 dans la session, le Z reste juste, pas d écart à la clôture', () => {
    const b = new DrawerBook(); let physical = 0;
    b.open(100); physical += 100;
    b.pay('ESP', 30); physical += 30;
    const d = b.deposit('ESP', 'remise', 30); physical -= 30;
    const out = b.movements.find((m) => m.depositId === d)!;
    expect(out.kind).toBe('out');
    expect(out.amount).toBe(30);
    expect(b.expected(b.openSession()!.id)).toBe(physical);   // 100 + 30 − 30
    b.pay('ESP', 12); physical += 12;                          // vente après la remise : en attente
    b.close(physical);
    expect(b.sessions[0].counted! - b.sessions[0].expected!).toBe(0);
    expect(b.balance()).toBe(physical);
    expect(b.pending('ESP').map((i) => i.type).sort()).toEqual(['payment', 'report']);
  });

  test('session oubliée la veille : la remise reste possible, la clôture tardive aussi, ouvrir une 2e caisse est refusé avec un message', () => {
    const b = new DrawerBook(); let physical = 0;
    b.open(50); physical += 50;
    b.pay('ESP', 20); physical += 20;
    // Lendemain : la caisse d hier est encore ouverte.
    expect(code(() => b.open(70))).toBe('alreadyOpen');       // sortie : clôturer le Z d hier
    expect(code(() => b.deposit('ESP', 'remise', 20))).toBe('ok'); physical -= 20;
    b.close(physical);                                         // Z tardif, juste
    expect(b.sessions[0].counted).toBe(b.sessions[0].expected);
    const s2 = b.open(physical);
    expect(b.sessions.find((s) => s.id === s2)!.proposed).toBe(physical);
    expect(b.balance()).toBe(physical);
  });

  test('plusieurs sessions entre deux remises : écarts de clôture et d ouverture repris, tiroir exact', () => {
    const b = new DrawerBook(); let physical = 0;
    b.open(100); physical += 100;
    b.pay('ESP', 40); physical += 40;
    b.close(138); physical = 138;                               // il manque 2 € : écart −2
    b.open(150); physical += 12;                                // le gérant complète le fond : +12
    b.pay('ESP', 25); physical += 25;
    b.move('in', 'ESP', 7000);                                  // encaissement dépôt-vente en espèces
    physical += 7000;
    b.close(physical);
    const types = b.pending('ESP').map((i) => i.type).sort();
    expect(types).toEqual(['closing_gap', 'movement', 'opening_gap', 'opening_gap', 'payment', 'payment']);
    expect(b.balance()).toBe(physical);
    b.deposit('ESP', 'remise', 7075); physical -= 7075;
    expect(b.balance()).toBe(physical);
    expect(b.balance()).toBe(100);
  });

  test('annulation d une remise APRÈS le Z : pas de mouvement dans une caisse fermée, lignes de nouveau disponibles, tiroir exact', () => {
    const b = new DrawerBook(); let physical = 0;
    b.open(100); physical += 100;
    b.pay('ESP', 60); physical += 60;
    const d = b.deposit('ESP', 'remise', 60);                   // remise saisie... mais l argent n est jamais parti
    b.close(physical);                                          // compté 160, théorique 100 : écart +60 (motivé)
    expect(b.sessions[0].counted! - b.sessions[0].expected!).toBe(60);
    expect(code(() => b.cancel(d))).toBe('ok');
    expect(b.movements.filter((m) => m.depositId === d)).toHaveLength(1);   // aucune compensation (caisse fermée)
    expect(b.balance()).toBe(physical);                         // 100 + 60 + 60 (écart) − 60 (sortie 01 rendue au grand livre)
    expect(code(() => b.deposit('ESP', 'remise', 60))).toBe('ok'); physical -= 60;
    expect(b.balance()).toBe(physical);
  });

  test('annulation d une remise caisse OUVERTE : sortie compensée par une entrée, Z inchangé', () => {
    const b = new DrawerBook(); let physical = 0;
    b.open(100); physical += 100;
    b.pay('ESP', 60); physical += 60;
    const d = b.deposit('ESP', 'remise', 60);
    b.cancel(d);                                                 // l argent est toujours dans le tiroir
    const linked = b.movements.filter((m) => m.depositId === d);
    expect(linked.map((m) => m.kind)).toEqual(['out', 'in']);
    expect(b.expected(b.openSession()!.id)).toBe(physical);
    expect(b.balance()).toBe(physical);
  });

  test('annuler une remise dont le report est repris : refus clair, sortie = annuler la plus récente d abord', () => {
    const b = new DrawerBook();
    b.open(100); b.pay('ESP', 50); b.close(150);
    const d1 = b.deposit('ESP', 'remise', 50);
    b.open(100); b.pay('ESP', 20); b.close(120);
    const d2 = b.deposit('ESP', 'remise', 20);
    expect(code(() => b.cancel(d1))).toBe('reportTaken:2');
    expect(code(() => b.cancel(d2))).toBe('ok');
    expect(code(() => b.cancel(d1))).toBe('ok');
    // Les deux remises annulées : rien n est parti, tout redevient disponible (100 + 50 + 20).
    expect(b.balance()).toBe(170);
    expect(b.pending('ESP').some((i) => i.type === 'report')).toBe(false);
  });

  test('une ligne ne se remet qu une fois ; une ligne non sélectionnée reste pour la remise suivante', () => {
    const b = new DrawerBook();
    b.open(0);
    const p1 = b.pay('ESP', 10); const p2 = b.pay('ESP', 15);
    b.close(25);
    b.deposit('ESP', 'remise', 10, [{ type: 'payment', id: p1 }]);
    expect(code(() => b.deposit('ESP', 'remise', 10, [{ type: 'payment', id: p1 }]))).toBe('alreadyDeposited');
    expect(b.pending('ESP').map((i) => i.id)).toEqual([p2]);
    expect(b.balance()).toBe(15);
  });

  test('archiver sans remise (espèces) : rien ne sort, tout passe dans le report', () => {
    const b = new DrawerBook();
    b.open(0); b.pay('ESP', 30); b.close(30);
    b.deposit('ESP', 'archive', 999);
    expect(b.movements).toHaveLength(0);
    expect(b.pending('ESP').map((i) => [i.type, i.amount])).toEqual([['report', 30]]);
  });

  test('modifier le montant d une remise : possible caisse ouverte (écart de mouvement), refusé avec sortie sinon', () => {
    const b = new DrawerBook(); let physical = 0;
    b.open(100); physical += 100;
    b.pay('ESP', 80); physical += 80;
    const d = b.deposit('ESP', 'remise', 50); physical -= 50;
    b.amend(d, 70); physical -= 20;                              // 20 de plus sont partis à la banque
    expect(b.expected(b.openSession()!.id)).toBe(physical);
    expect(b.balance()).toBe(physical);
    b.close(physical);
    expect(code(() => b.amend(d, 60))).toBe('sessionClosed');   // sortie : annuler (lignes libérées) puis refaire
    const e = b.deposit('ESP', 'remise', 0);                      // remise hors caisse (après Z)
    b.open(b.balance());
    expect(code(() => b.amend(e, 10))).toBe('sessionOpenedSince');
  });

  test('remise à 0 caisse ouverte puis corrigée à 10 : la sortie est ajoutée à la session ; après le Z, refus avec sortie (annuler puis refaire)', () => {
    const b = new DrawerBook(); let physical = 0;
    b.open(50); physical += 50;
    b.pay('ESP', 20); physical += 20;
    const d = b.deposit('ESP', 'remise', 0);
    b.amend(d, 10); physical -= 10;
    expect(b.movements.filter((m) => m.depositId === d).map((m) => [m.kind, m.amount])).toEqual([['out', 10]]);
    expect(b.expected(b.openSession()!.id)).toBe(physical);
    b.close(physical);
    expect(code(() => b.amend(d, 5))).toBe('sessionClosed');
    expect(code(() => b.cancel(d))).toBe('ok');
    expect(b.balance()).toBe(physical);
  });

  test('remise avec un remboursement en espèces (règlement négatif) et sans report : refus si négatif, sortie = ajouter le report', () => {
    const b = new DrawerBook();
    b.open(100); b.close(100);
    b.deposit('ESP', 'archive', 0);                               // report 100
    b.open(100);
    const refund = b.pay('ESP', -30);
    b.close(70);
    expect(code(() => b.deposit('ESP', 'remise', 0, [{ type: 'payment', id: refund }]))).toBe('negativeTotal');
    const report = b.pending('ESP').find((i) => i.type === 'report')!;
    expect(code(() => b.deposit('ESP', 'remise', 0, [{ type: 'payment', id: refund }, { type: 'report', id: report.id }]))).toBe('ok');
    expect(b.balance()).toBe(70);
  });
});
