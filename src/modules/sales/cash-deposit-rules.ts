/**
 * M6 (POS) — Remise en banque façon G8 (rattrapage G8 du 18/11/2026, PDV009) : règles pures.
 *
 * G8 clôture la caisse par la REMISE EN BANQUE, mode par mode : report du fond précédent + encaissements
 * + mouvements de caisse (lignes sélectionnables) ; montant remis → nouveau fond de caisse (report +
 * sélection − remis), repris par la remise suivante. Le DMS garde EN PLUS le journal Z numéroté et figé
 * (caisse légale belge) : le Z clôture la session, la remise reprend les espèces (de sessions clôturées ou
 * de la session ouverte) et calcule le report. Décision de Simon (Q31, 18/11/2026) : les deux coexistent,
 * sans blocage du caissier.
 *
 * Ce fichier contient :
 *   - les calculs de l'écran (nouveau fond ↔ montant remis, contrôles) ;
 *   - `DrawerBook`, le MODÈLE de référence du grand livre du tiroir, écrit à l'identique des fonctions SQL
 *     de la migration 20261118150000 (`_cash_deposit_pool`, `cash_deposit_create`, `_cancel`, `_amend`,
 *     fond proposé à l'ouverture). Il sert aux tests des cas limites (tests/caisse-remise-banque.test.ts) :
 *     session oubliée la veille, Z déjà fait, remise avant le Z, plusieurs sessions entre deux remises,
 *     annulation d'une remise après un Z.
 */
import { CASH_METHOD } from './cash-rounding';

const r2 = (n: number) => Math.round(n * 100) / 100;

export type DepositKind = 'remise' | 'archive';
export type DepositSourceType = 'report' | 'payment' | 'movement' | 'opening_gap' | 'closing_gap';

/** Total des lignes sélectionnées (report compris), arrondi au cent. */
export const selectionTotal = (amounts: number[]): number => r2(amounts.reduce((s, a) => s + Number(a), 0));

/** Nouveau fond de caisse = sélection − montant remis (espèces seulement ; les autres modes n'ont pas de fond). */
export function newFloatFrom(method: string, kind: DepositKind, total: number, deposited: number): number | null {
  if (method !== CASH_METHOD) return null;
  return r2(total - (kind === 'archive' ? 0 : deposited));
}

/** L'inverse (G8 : on saisit le nouveau fond, le montant remis se calcule). */
export const depositedFromNewFloat = (total: number, newFloat: number): number => r2(total - newFloat);

/** Montant remis effectif : archive = 0 ; carte / virement = toute la sélection ; espèces = saisi. */
export function effectiveDeposited(method: string, kind: DepositKind, total: number, deposited: number): number {
  if (kind === 'archive') return 0;
  return method === CASH_METHOD ? r2(deposited) : r2(total);
}

export type DepositCheck = 'none' | 'empty' | 'negativeDeposit' | 'exceeds' | 'negativeTotal';

/** Contrôle avant « Générer remise » (mêmes refus qu'en base, message clair à l'écran). */
export function depositCheck(method: string, kind: DepositKind, lineCount: number, total: number, deposited: number): DepositCheck {
  if (lineCount === 0) return 'empty';
  const dep = effectiveDeposited(method, kind, total, deposited);
  if (dep < 0) return method === CASH_METHOD ? 'negativeDeposit' : 'negativeTotal';
  if (method === CASH_METHOD) {
    if (dep > total + 0.004) return total < 0 ? 'negativeTotal' : 'exceeds';
    if (r2(total - dep) < 0) return 'negativeTotal';
  }
  return 'none';
}

/* ------------------------------------------------------------------------------------------------
 * Modèle du grand livre du tiroir (référence des fonctions SQL, pour les tests).
 * ---------------------------------------------------------------------------------------------- */

export type BookSession = { id: string; opening: number; proposed: number | null; status: 'open' | 'closed'; expected: number | null; counted: number | null };
export type BookPayment = { id: string; method: string; amount: number; sessionId: string | null };
export type BookMovement = { id: string; kind: 'in' | 'out'; method: string; amount: number; sessionId: string; depositId: string | null };
export type BookDeposit = {
  id: string; number: number; method: string; kind: DepositKind; status: 'active' | 'annulee';
  total: number; deposited: number; newFloat: number | null; sessionId: string | null; createdSeq: number;
  lines: { type: DepositSourceType; id: string; amount: number; active: boolean }[];
};
export type PoolItem = { type: DepositSourceType; id: string; amount: number; depositId: string | null };

/** Erreur métier du modèle (même sens que les messages de la base). */
export class BookError extends Error {
  constructor(public code: string) { super(code); }
}

export class DrawerBook {
  sessions: BookSession[] = [];
  payments: BookPayment[] = [];
  movements: BookMovement[] = [];
  deposits: BookDeposit[] = [];
  private seq = 0;
  private sessionSeq: Record<string, number> = {};
  private next(p: string) { this.seq += 1; return `${p}${this.seq}`; }

  openSession(): BookSession | undefined { return this.sessions.find((s) => s.status === 'open'); }

  /** Ouverture : une seule caisse ouverte ; le fond attendu = espèces du tiroir (`cash_drawer_balance`). */
  open(openingFloat: number): string {
    if (this.openSession()) throw new BookError('alreadyOpen');
    const id = this.next('S');
    this.sessions.push({ id, opening: r2(openingFloat), proposed: this.balance(), status: 'open', expected: null, counted: null });
    this.sessionSeq[id] = this.seq;
    return id;
  }

  /** Règlement perçu (les espèces exigent une caisse ouverte, comme `document_payments_cash_guard`). */
  pay(method: string, amount: number): string {
    const s = this.openSession();
    if (method === CASH_METHOD && !s) throw new BookError('noSession');
    const id = this.next('P');
    this.payments.push({ id, method, amount: r2(amount), sessionId: s?.id ?? null });
    return id;
  }

  /** Mouvement de fond de caisse saisi dans la caisse ouverte. */
  move(kind: 'in' | 'out', method: string, amount: number, depositId: string | null = null): string {
    const s = this.openSession();
    if (!s) throw new BookError('noSession');
    const id = this.next('M');
    this.movements.push({ id, kind, method, amount: r2(amount), sessionId: s.id, depositId });
    return id;
  }

  /** Théorique du Z (`_cash_z_build`) : fond + ESP de la session + entrées − sorties ESP de la session. */
  expected(sessionId: string): number {
    const s = this.sessions.find((x) => x.id === sessionId)!;
    const esp = this.payments.filter((p) => p.sessionId === sessionId && p.method === CASH_METHOD).reduce((a, p) => a + p.amount, 0);
    const mv = this.movements.filter((m) => m.sessionId === sessionId && m.method === CASH_METHOD)
      .reduce((a, m) => a + (m.kind === 'in' ? m.amount : -m.amount), 0);
    return r2(s.opening + esp + mv);
  }

  /** Clôture Z : théorique figé, compté. */
  close(counted: number): void {
    const s = this.openSession();
    if (!s) throw new BookError('noSession');
    s.expected = this.expected(s.id); s.counted = r2(counted); s.status = 'closed';
  }

  private activeLine(type: DepositSourceType, id: string): BookDeposit | undefined {
    return this.deposits.find((d) => d.lines.some((l) => l.active && l.type === type && l.id === id));
  }

  /** Grand livre du mode (`_cash_deposit_pool`). */
  pool(method: string): PoolItem[] {
    const items: { type: DepositSourceType; id: string; amount: number }[] = [];
    if (method === CASH_METHOD) {
      for (const d of this.deposits) if (d.method === method && d.status === 'active' && (d.newFloat ?? 0) !== 0) items.push({ type: 'report', id: d.id, amount: d.newFloat! });
    }
    for (const p of this.payments) if (p.method === method) items.push({ type: 'payment', id: p.id, amount: p.amount });
    for (const m of this.movements) {
      if (m.method !== method) continue;
      const dep = m.depositId ? this.deposits.find((d) => d.id === m.depositId) : undefined;
      if (m.depositId && dep?.status !== 'annulee') continue;
      items.push({ type: 'movement', id: m.id, amount: m.kind === 'in' ? m.amount : -m.amount });
    }
    if (method === CASH_METHOD) {
      for (const s of this.sessions) {
        if (s.proposed != null && r2(s.opening - s.proposed) !== 0) items.push({ type: 'opening_gap', id: s.id, amount: r2(s.opening - s.proposed) });
        if (s.status === 'closed' && s.counted != null && s.expected != null && r2(s.counted - s.expected) !== 0) items.push({ type: 'closing_gap', id: s.id, amount: r2(s.counted - s.expected) });
      }
    }
    return items.map((i) => ({ ...i, depositId: this.activeLine(i.type, i.id)?.id ?? null }));
  }

  /** Éléments non remis du mode. */
  pending(method: string): PoolItem[] { return this.pool(method).filter((i) => !i.depositId); }

  /** Espèces du tiroir = somme des éléments espèces non remis (`cash_drawer_balance`). */
  balance(): number { return r2(this.pending(CASH_METHOD).reduce((a, i) => a + i.amount, 0)); }

  /** `cash_deposit_create`. `keys` absent = toutes les lignes non remises. */
  deposit(method: string, kind: DepositKind, deposited: number, keys?: { type: DepositSourceType; id: string }[]): string {
    const pool = this.pool(method);
    const wanted = keys ?? this.pending(method).map((i) => ({ type: i.type, id: i.id }));
    if (wanted.length === 0) throw new BookError('empty');
    const found = wanted.map((k) => pool.find((i) => i.type === k.type && i.id === k.id));
    if (found.some((f) => !f)) throw new BookError('notFound');
    if (found.some((f) => f!.depositId)) throw new BookError('alreadyDeposited');
    const total = selectionTotal(found.map((f) => f!.amount));
    const check = depositCheck(method, kind, found.length, total, deposited);
    if (check !== 'none') throw new BookError(check);
    const dep = effectiveDeposited(method, kind, total, deposited);
    const id = this.next('D');
    const open = this.openSession();
    const withMove = method === CASH_METHOD && kind === 'remise' && dep > 0 && !!open;
    const number = this.deposits.filter((d) => d.method === method).length + 1;
    this.deposits.push({
      id, number, method, kind, status: 'active', total, deposited: dep, newFloat: newFloatFrom(method, kind, total, dep),
      sessionId: method === CASH_METHOD ? open?.id ?? null : null, createdSeq: this.seq,
      lines: found.map((f) => ({ type: f!.type, id: f!.id, amount: f!.amount, active: true })),
    });
    if (withMove) this.move('out', CASH_METHOD, dep, id);
    return id;
  }

  /** `cash_deposit_cancel` : refus si le report est repris ; sortie compensée si sa caisse est encore ouverte. */
  cancel(depositId: string): void {
    const d = this.deposits.find((x) => x.id === depositId);
    if (!d) throw new BookError('notFound');
    if (d.status !== 'active') throw new BookError('alreadyCancelled');
    const taker = this.activeLine('report', d.id);
    if (taker) throw new BookError(`reportTaken:${taker.number}`);
    for (const l of d.lines) l.active = false;
    d.status = 'annulee';
    const bySession = new Map<string, number>();
    for (const m of this.movements.filter((x) => x.depositId === d.id)) {
      const s = this.sessions.find((x) => x.id === m.sessionId);
      if (s?.status !== 'open') continue;
      bySession.set(m.sessionId, (bySession.get(m.sessionId) ?? 0) + (m.kind === 'out' ? m.amount : -m.amount));
    }
    for (const [, net] of bySession) if (r2(net) !== 0) this.move(net > 0 ? 'in' : 'out', CASH_METHOD, Math.abs(net), d.id);
  }

  /** `cash_deposit_amend` (montant remis seulement). */
  amend(depositId: string, deposited: number): void {
    const d = this.deposits.find((x) => x.id === depositId);
    if (!d) throw new BookError('notFound');
    if (d.status !== 'active') throw new BookError('alreadyCancelled');
    const dep = d.kind === 'archive' ? 0 : r2(deposited);
    if (dep === d.deposited) return;
    if (dep < 0) throw new BookError('negativeDeposit');
    if (d.method === CASH_METHOD) {
      if (dep > d.total) throw new BookError('exceeds');
      if (this.activeLine('report', d.id)) throw new BookError('reportTaken');
      if (this.movements.some((m) => m.depositId === d.id && this.sessions.find((s) => s.id === m.sessionId)?.status === 'closed')
        || this.sessions.find((s) => s.id === d.sessionId)?.status === 'closed') throw new BookError('sessionClosed');
      if (this.sessions.some((s) => this.sessionSeq[s.id] > d.createdSeq && s.id !== d.sessionId)) throw new BookError('sessionOpenedSince');
      const delta = r2(dep - d.deposited);
      const s = this.sessions.find((x) => x.id === d.sessionId && x.status === 'open');
      if (s && delta !== 0) this.move(delta > 0 ? 'out' : 'in', CASH_METHOD, Math.abs(delta), d.id);
      d.newFloat = r2(d.total - dep);
    }
    d.deposited = dep;
  }
}
