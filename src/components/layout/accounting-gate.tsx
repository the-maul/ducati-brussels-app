/**
 * M12 — Garde des écrans de comptabilité (clôture, écritures, SEPA, date de bascule, transfert).
 * En plus de la grille des droits (AccessGuard) : si la grille venait à ouvrir ces pages à un autre
 * rôle, l'écran resterait fermé, comme la base (`can_manage_accounting`).
 */
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { canManageAccounting } from '@/lib/auth/accounting-access';
import { t } from '@/lib/i18n';

export function AccountingGate({ children }: { children: ReactNode }) {
  const { rolesForActiveCompany } = useAuth();
  if (canManageAccounting(rolesForActiveCompany)) return <>{children}</>;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card px-6 py-12 text-center">
      <Lock className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-display text-[18px] font-bold uppercase">{t('accounting.forbiddenTitle')}</p>
      <p className="text-sm text-muted-foreground">{t('accounting.forbiddenText')}</p>
      <Button asChild variant="outline" className="mt-1">
        <Link to="/dashboard">{t('access.backHome')}</Link>
      </Button>
    </div>
  );
}
