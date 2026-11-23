/**
 * M6 (POS) — Ordre de clôture de la caisse (chantier C6, parcours CAI-06, 23/11/2026) : règles pures.
 *
 * Fil d'étapes : comptage → remise en banque → clôture Z. Décision Q31 du client : « les deux, sans
 * blocage » : ces règles GUIDENT et PRÉVIENNENT, elles n'interdisent rien. Aucun calcul de caisse ici
 * (fond, espèces théoriques, écart et contrôles de remise restent dans `cash-rules` et
 * `cash-deposit-rules`).
 *
 * Point d'attention : une remise faite caisse ouverte pose une sortie 01 dans la session, donc le
 * théorique baisse. Un comptage fait AVANT la remise ne correspond plus au tiroir : `drawerChangeSinceCount`
 * le détecte pour faire corriger la grille, au lieu de faire apparaître un faux écart sur le Z.
 * Testées dans tests/caisse-ordre-cloture.test.ts.
 */
import { CASH_METHOD } from './cash-rounding';

const r2 = (n: number) => Math.round(n * 100) / 100;

export const CLOSE_ORDER = ['count', 'deposit', 'z'] as const;
export type CloseOrderStep = (typeof CLOSE_ORDER)[number];

/** Modes qui ne se remettent jamais en banque (lettrage d'avoir, arrondi, reprise moto, retenue dépôt-vente). */
export const NOT_DEPOSITABLE_METHODS: ReadonlySet<string> = new Set(['AVO', 'ARR', 'REP', 'DEP']);

/** Modes à contrôler pour cette caisse : ceux de ses règlements et de ses mouvements, sans doublon. */
export function methodsToCheck(paymentMethods: string[], movementMethods: string[]): string[] {
  return [...new Set([...paymentMethods, ...movementMethods])].filter((m) => !!m && !NOT_DEPOSITABLE_METHODS.has(m)).sort();
}

export type DepositLineLike = { method: string; source_type: string; amount: number; deposit_id: string | null };
export type PendingByMethod = { method: string; count: number; amount: number };
export type DepositProgress = {
  /** pending : il reste à remettre ; done : tout est remis ; nothing : rien à remettre pour cette caisse. */
  state: 'pending' | 'done' | 'nothing';
  pendingCount: number;
  depositedCount: number;
  byMethod: PendingByMethod[];
};

/**
 * État de la remise pour les lignes de la caisse. Seuls les règlements et mouvements comptent : le report
 * et les écarts d'ouverture ou de clôture sont le fond du tiroir, pas de l'argent à remettre. Une remise
 * annulée laisse sa sortie et sa compensation (net nul, mouvements seuls) : ce n'est pas un oubli.
 */
export function depositProgress(lines: DepositLineLike[]): DepositProgress {
  const real = lines.filter((l) => (l.source_type === 'payment' || l.source_type === 'movement') && Number(l.amount) !== 0);
  const depositedCount = real.filter((l) => !!l.deposit_id).length;
  const groups = new Map<string, DepositLineLike[]>();
  for (const l of real) {
    if (l.deposit_id) continue;
    groups.set(l.method, [...(groups.get(l.method) ?? []), l]);
  }
  const byMethod: PendingByMethod[] = [];
  for (const [method, rows] of groups) {
    const amount = r2(rows.reduce((s, l) => s + Number(l.amount), 0));
    if (amount === 0 && rows.every((l) => l.source_type === 'movement')) continue;
    byMethod.push({ method, count: rows.length, amount });
  }
  byMethod.sort((a, b) => (a.method === CASH_METHOD ? -1 : b.method === CASH_METHOD ? 1 : a.method.localeCompare(b.method)));
  const pendingCount = byMethod.reduce((s, m) => s + m.count, 0);
  return { state: pendingCount > 0 ? 'pending' : depositedCount > 0 ? 'done' : 'nothing', pendingCount, depositedCount, byMethod };
}

export type TrailState = 'done' | 'todo' | 'warning';
export type CloseTrailStep = { key: CloseOrderStep; state: TrailState; current: boolean };

/** Fil d'étapes. Une remise manquante passe en « à vérifier » une fois dépassée, sans jamais verrouiller la suite. */
export function closeOrderTrail(current: CloseOrderStep, p: { counted: boolean; deposit: DepositProgress['state'] | null }): CloseTrailStep[] {
  const at = CLOSE_ORDER.indexOf(current);
  return CLOSE_ORDER.map((key, i) => {
    let state: TrailState = 'todo';
    if (key === 'count') state = p.counted && at > 0 ? 'done' : 'todo';
    if (key === 'deposit') {
      if (p.deposit === 'done' || p.deposit === 'nothing') state = 'done';
      else if (p.deposit === 'pending' && at > i) state = 'warning';
    }
    return { key, state, current: key === current };
  });
}

type MovementLike = { kind: string; method: string; amount: number | string; deposit_id?: string | null };

/** Espèces sorties du tiroir par les remises de la session (sorties − compensations d'annulation). */
export function depositCashOut(movements: MovementLike[]): number {
  return r2(movements
    .filter((m) => m.method === CASH_METHOD && !!m.deposit_id)
    .reduce((s, m) => s + (m.kind === 'out' ? Number(m.amount) : -Number(m.amount)), 0));
}

/** Espèces parties (+) ou revenues (−) par une remise depuis le comptage ; 0 = le comptage reste valable. */
export function drawerChangeSinceCount(outAtCount: number | null, movements: MovementLike[]): number {
  if (outAtCount == null) return 0;
  return r2(depositCashOut(movements) - outAtCount);
}
