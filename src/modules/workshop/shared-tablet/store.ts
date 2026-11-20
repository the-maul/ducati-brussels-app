/**
 * M8 — Q60 (20/11/2026) : etat de la tablette partagee, partage par tous les ecrans de l'atelier.
 *
 * Un seul endroit sait si le poste est en mode partage et qui est identifie. Les fonctions de
 * pointage (pointage/api.ts), d'operations (plan-ops) et de photos (reception) passent par
 * `withIdentityIfShared` : en mode partage, elles demandent d'abord « Qui etes-vous ? » (fenetre
 * montee par SharedTabletProvider), puis agissent sous cette identite ; en mode personnel, rien
 * ne change. L'identite expiree cote base (SQLSTATE 28000) est redemandee une fois, puis le geste
 * est rejoue.
 */
import { effectiveTabletMode, identityValid, isIdentityError, POSTE_SHARED_KEY, renewIdentity, type SharedIdentity, type TabletMode } from './rules';

type Prompt = { resolve: (id: SharedIdentity) => void; reject: (e: Error) => void };
export type SharedTabletState = {
  companyId: string | null;
  accountMode: TabletMode;
  posteShared: boolean;
  ttlSeconds: number;
  ready: boolean;
  identity: SharedIdentity | null;
  prompting: boolean;
};

let state: SharedTabletState = {
  companyId: null, accountMode: 'personal', posteShared: readPosteShared(), ttlSeconds: 120, ready: false, identity: null, prompting: false,
};
let prompt: Prompt | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const set = (patch: Partial<SharedTabletState>) => { state = { ...state, ...patch }; emit(); };

export const subscribeSharedTablet = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getSharedTabletState = () => state;

/** Geste annule par l'utilisateur (« Annuler » dans « Qui etes-vous ? »). */
export class IdentityCancelled extends Error {
  constructor(message = 'identity_cancelled') { super(message); this.name = 'IdentityCancelled'; }
}

export function readPosteShared(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(POSTE_SHARED_KEY) === '1'; } catch { return false; }
}
export function writePosteShared(v: boolean): void {
  try { if (v) localStorage.setItem(POSTE_SHARED_KEY, '1'); else localStorage.removeItem(POSTE_SHARED_KEY); } catch { /* stockage indisponible */ }
  set({ posteShared: v });
}

export function configureSharedTablet(p: { companyId: string | null; accountMode: TabletMode; ttlSeconds: number; ready: boolean }): void {
  const companyChanged = p.companyId !== state.companyId;
  set({ companyId: p.companyId, accountMode: p.accountMode, ttlSeconds: p.ttlSeconds, ready: p.ready, ...(companyChanged ? { identity: null } : {}) });
}

/** Le poste est-il en mode partage (compte « tablette atelier » ou poste declare partage) ? */
export function sharedModeActive(): boolean {
  return effectiveTabletMode(state.accountMode, state.posteShared) === 'shared';
}

export function currentIdentity(): SharedIdentity | null {
  return identityValid(state.identity) ? state.identity : null;
}
export function setIdentity(id: SharedIdentity | null): void { set({ identity: id }); }

/** Identite valable, sinon la fenetre « Qui etes-vous ? » s'ouvre et on attend. */
export function requestIdentity(): Promise<SharedIdentity> {
  const id = currentIdentity();
  if (id) return Promise.resolve(id);
  if (prompt) prompt.reject(new IdentityCancelled());
  return new Promise<SharedIdentity>((resolve, reject) => {
    prompt = { resolve, reject };
    set({ prompting: true });
  });
}
/** Appele par la fenetre : identite choisie et verifiee par la base. */
export function resolveIdentityPrompt(id: SharedIdentity): void {
  set({ identity: id, prompting: false });
  const p = prompt; prompt = null;
  p?.resolve(id);
}
export function cancelIdentityPrompt(): void {
  set({ prompting: false });
  const p = prompt; prompt = null;
  p?.reject(new IdentityCancelled());
}

/** Geste sous identite (mode partage) : demande l'identite, agit, prolonge ; 28000 → redemande une fois. */
export async function withIdentity<T>(fn: (id: SharedIdentity) => Promise<T>): Promise<T> {
  let id = await requestIdentity();
  try {
    const r = await fn(id);
    if (state.identity?.session === id.session) setIdentity(renewIdentity(id));
    return r;
  } catch (e) {
    if (!isIdentityError(e)) throw e;
    setIdentity(null);
    id = await requestIdentity();
    const r = await fn(id);
    if (state.identity?.session === id.session) setIdentity(renewIdentity(id));
    return r;
  }
}

/** Mode partage : sous identite ; mode personnel : tel quel (identite null). */
export function withIdentityIfShared<T>(fn: (id: SharedIdentity | null) => Promise<T>): Promise<T> {
  return sharedModeActive() ? withIdentity(fn) : fn(null);
}

/** Pour les tests. */
export function __resetSharedTablet(p: Partial<SharedTabletState> = {}): void {
  prompt = null;
  state = { companyId: null, accountMode: 'personal', posteShared: false, ttlSeconds: 120, ready: false, identity: null, prompting: false, ...p };
  emit();
}
