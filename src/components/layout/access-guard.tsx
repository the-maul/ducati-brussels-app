/**
 * M0 — Garde d'accès : applique la grille des droits (permissions.ts) à la
 * page affichée, sans que chaque écran ait à s'en occuper.
 *   - page interdite → écran « accès refusé » à la place du contenu ;
 *   - page en lecture seule → bandeau au-dessus du contenu.
 * Les boutons d'écriture, eux, se branchent écran par écran sur `useCanWrite`.
 */
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Eye, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePageAccess } from '@/lib/auth/use-access';
import { t } from '@/lib/i18n';

export function AccessGuard({ children }: { children: ReactNode }) {
  const { level } = usePageAccess();

  if (level === 'none') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card px-6 py-12 text-center">
        <Lock className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-display text-[18px] font-bold uppercase">{t('access.deniedTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('access.deniedText')}</p>
        <Button asChild variant="outline" className="mt-1">
          <Link to="/dashboard">{t('access.backHome')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      {level === 'read' && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-[13px] text-muted-foreground"
        >
          <Eye className="size-4 shrink-0" aria-hidden />
          <span><span className="font-medium text-foreground">{t('access.readOnly')}</span> — {t('access.readOnlyHint')}</span>
        </div>
      )}
      {children}
    </>
  );
}
