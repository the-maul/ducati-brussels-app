/**
 * M12 — Fonctions comptables réservées (rattrapage G8, 18/11/2026 ; bloquant n° 4, carte F1).
 *
 * Grille signée (M0-RBAC003, 13/10/2026) : Comptabilité = comptable en écriture, aucun autre rôle ;
 * l'administrateur a tout. Même règle en base : `can_manage_accounting` (migration
 * 20261118182000_m12_compta_reservee.sql) refuse la clôture, les écritures, le SEPA, la date de
 * bascule et le transfert à tout autre rôle. Ici, la même liste pour l'écran (test :
 * tests/compta-reservee.test.ts vérifie que les trois listes concordent).
 */
import type { AppRole } from './auth-context';

export const ACCOUNTING_ROLES: readonly AppRole[] = ['admin', 'comptable'];

/** L'opérateur peut-il travailler en comptabilité (clôture, écritures, SEPA, bascule, transfert) ? */
export function canManageAccounting(roles: readonly AppRole[]): boolean {
  return roles.some((r) => ACCOUNTING_ROLES.includes(r));
}

/** Refus de la base (rôle non autorisé) : erreur 42501 « accounting_forbidden ». */
export function isAccountingForbidden(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = (e as { message?: string } | null)?.message ?? '';
  return code === '42501' || /accounting_forbidden/.test(msg);
}
