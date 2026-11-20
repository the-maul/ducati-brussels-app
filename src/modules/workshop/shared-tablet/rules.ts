/**
 * M8 — Decision client Q60 (20/11/2026) : tablettes d'atelier, les deux modes. Regles PURES.
 *
 *  - Mode personnel : chaque mecanicien sur sa tablette, connecte avec son compte (deja en place).
 *  - Mode partage : un compte « tablette atelier » ; chaque geste demande « Qui etes-vous ? »
 *    (le compagnon touche son nom, tape son code a 4 chiffres) ; l'identite reste « collee »
 *    2 min (reglable : workshop_planning_settings.shared_identity_seconds), prolongee a chaque geste.
 *  - Reglage par compte (base : workshop_tablet_accounts) ou par poste (ce navigateur : case
 *    « Cette tablette est partagee ») : un poste peut passer en partage, jamais l'inverse (un compte
 *    tablette ne pointe jamais a son propre nom, la base le refuse).
 * Miroir SQL : supabase/migrations/20261120100000_m8_tablette_partagee.sql.
 * Tests : tests/atelier-decisions-q57-q60.test.ts.
 */

export type TabletMode = 'personal' | 'shared';
export const PIN_LENGTH = 4;
export const DEFAULT_IDENTITY_SECONDS = 120;
/** Cle du reglage par poste (navigateur). */
export const POSTE_SHARED_KEY = 'ducati.workshop.sharedTablet';

export type SharedIdentity = {
  session: string;
  mechanicId: string;
  name: string;
  /** Code du pointage (compagnon sans compte) ou null (compagnon relie a un compte). */
  code: string | null;
  userId: string | null;
  expiresAt: number; // ms epoch
  ttlSeconds: number;
};

/** Mode effectif : partage si le compte l'est OU si ce poste est declare partage. */
export function effectiveTabletMode(account: TabletMode | null | undefined, posteShared: boolean): TabletMode {
  return account === 'shared' || posteShared ? 'shared' : 'personal';
}

/** L'identite est-elle encore valable a `now` (marge de 2 s pour l'aller-retour reseau) ? */
export function identityValid(id: SharedIdentity | null | undefined, now: number = Date.now()): id is SharedIdentity {
  return !!id && id.expiresAt - 2_000 > now;
}

/** Secondes restantes (0 si expiree). */
export function identitySecondsLeft(id: SharedIdentity | null | undefined, now: number = Date.now()): number {
  if (!id) return 0;
  return Math.max(0, Math.round((id.expiresAt - now) / 1000));
}

/** Apres un geste reussi, la base a prolonge l'identite : on fait pareil a l'ecran. */
export function renewIdentity(id: SharedIdentity, now: number = Date.now()): SharedIdentity {
  return { ...id, expiresAt: now + id.ttlSeconds * 1000 };
}

/** Clavier : ajoute un chiffre (4 au plus), efface, vide. */
export function keypadPress(pin: string, key: string): string {
  if (key === 'clear') return '';
  if (key === 'back') return pin.slice(0, -1);
  if (/^[0-9]$/.test(key) && pin.length < PIN_LENGTH) return pin + key;
  return pin;
}
export const isFullPin = (pin: string) => new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin);
/** Code mecano de la pointeuse (lettres et chiffres) accepte tant qu'aucun code a 4 chiffres n'est pose. */
export const isPinValue = (pin: string) => /^[0-9]{4}$/.test(pin.trim());

export type IdentifyResponse =
  | { status: 'ok'; session: string; expires_at: string; ttl_seconds: number; mechanic_id: string; mechanic_name: string; mechanic_code: string | null; mechanic_user_id: string | null }
  | { status: 'wrong_code'; mechanic_name: string; attempts_left: number }
  | { status: 'locked'; mechanic_name: string }
  | { status: 'no_code'; mechanic_name: string };

/** Reponse de workshop_shared_identify → identite collee, ou cle i18n du message d'erreur. */
export function identifyOutcome(r: IdentifyResponse, now: number = Date.now()):
  | { ok: true; identity: SharedIdentity }
  | { ok: false; messageKey: 'sharedTablet.wrongCode' | 'sharedTablet.locked' | 'sharedTablet.noCode'; attemptsLeft?: number } {
  if (r.status === 'ok') {
    const ttl = Number(r.ttl_seconds) > 0 ? Number(r.ttl_seconds) : DEFAULT_IDENTITY_SECONDS;
    const exp = Date.parse(r.expires_at);
    return {
      ok: true,
      identity: {
        session: r.session, mechanicId: r.mechanic_id, name: r.mechanic_name, code: r.mechanic_code ?? null,
        userId: r.mechanic_user_id ?? null, ttlSeconds: ttl, expiresAt: Number.isFinite(exp) ? exp : now + ttl * 1000,
      },
    };
  }
  if (r.status === 'wrong_code') return { ok: false, messageKey: 'sharedTablet.wrongCode', attemptsLeft: r.attempts_left };
  if (r.status === 'locked') return { ok: false, messageKey: 'sharedTablet.locked' };
  return { ok: false, messageKey: 'sharedTablet.noCode' };
}

/** Erreur « identite expiree ou absente » renvoyee par la base (SQLSTATE 28000). */
export function isIdentityError(e: unknown): boolean {
  const o = e as { code?: string; message?: string } | null;
  return o?.code === '28000' || /Identification expir|Qui etes-vous/i.test(o?.message ?? '');
}

/** Compagnons proposes, dans l'ordre du planning ; ceux sans code en dernier (ils ne peuvent pas encore pointer). */
export type SharedMechanic = { id: string; name: string; sort_order: number; has_pin: boolean; has_pointeuse_code: boolean; linked: boolean };
export function sortSharedMechanics(ms: readonly SharedMechanic[]): SharedMechanic[] {
  return [...ms].sort((a, b) =>
    Number(!(a.has_pin || a.has_pointeuse_code)) - Number(!(b.has_pin || b.has_pointeuse_code))
    || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}
