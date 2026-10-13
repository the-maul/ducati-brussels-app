/**
 * M0 — Droits d'accès : les crochets React au-dessus de la grille
 * (`permissions.ts`). Toujours passer par ici dans les écrans, jamais relire
 * les rôles à la main.
 *
 *   const { canWrite, readOnly } = usePageAccess();
 *   <Button disabled={!canWrite}>Enregistrer</Button>
 */
import { useRouterState } from '@tanstack/react-router';
import { useAuth } from './auth-context';
import { accessLevel, effectiveLevel, type AccessLevel } from './permissions';

/** Niveau d'accès de l'utilisateur sur la page affichée. */
export function usePageAccess(): { level: AccessLevel; canWrite: boolean; readOnly: boolean } {
  const { rolesForActiveCompany } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const level = effectiveLevel(pathname, rolesForActiveCompany);
  return { level, canWrite: level === 'write', readOnly: level === 'read' };
}

/** Peut-on écrire sur la page affichée ? (raccourci le plus courant) */
export function useCanWrite(): boolean {
  return usePageAccess().canWrite;
}

/** Niveau d'accès sur une AUTRE page que celle affichée (liens, raccourcis). */
export function useAccessTo(path: string): AccessLevel {
  const { rolesForActiveCompany } = useAuth();
  return accessLevel(path, rolesForActiveCompany);
}
