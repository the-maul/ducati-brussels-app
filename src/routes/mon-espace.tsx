import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { isClientHost } from '@/lib/portal-host';
import { getWhoami } from '@/modules/portal/api';
import { PortalShell } from '@/modules/portal/portal-shell';

/**
 * Espace client /mon-espace (mission 01, lot 3 ; décisions P-1 à P-4).
 * Réservé aux comptes rattachés à une fiche client (contact_accounts). Les données
 * ne sont lues que par les fonctions portal_* : voir src/modules/portal/api.ts.
 */
export const Route = createFileRoute('/mon-espace')({
  head: () => ({ meta: [{ title: 'Mon espace — Ducati Bruxelles' }] }),
  component: PortalLayout,
});

function PortalLayout() {
  const { loading, session, roles, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: '/login' });
  }, [loading, session, navigate]);

  const me = useQuery({
    queryKey: ['portal', 'whoami', session?.user.id],
    queryFn: getWhoami,
    enabled: !!session,
    staleTime: 60_000,
  });

  if (loading || !session || me.isPending) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Erreur réseau : on propose de réessayer plutôt que de conclure « pas client ».
  if (me.isError) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 rounded-md border border-border bg-card p-6 text-center">
          <p className="text-[13px] text-muted-foreground">{t('portal.errors.generic')}</p>
          <Button className="w-full" onClick={() => me.refetch()}>{t('portal.common.retry')}</Button>
        </div>
      </main>
    );
  }

  // Compte sans fiche client (ex. personnel) : cet espace ne le concerne pas.
  if (!me.data) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 rounded-md border border-border bg-card p-6 text-center">
          <h1 className="text-[17px] font-bold">{t('portal.reserved.title')}</h1>
          <p className="text-[13px] text-muted-foreground">{t('portal.reserved.text')}</p>
          {roles.length > 0 && !isClientHost() ? (
            <Button asChild className="w-full"><Link to="/dashboard">{t('portal.reserved.toStaff')}</Link></Button>
          ) : (
            <Button className="w-full" onClick={async () => { await signOut(); navigate({ to: '/login' }); }}>
              {t('portal.nav.logout')}
            </Button>
          )}
        </div>
      </main>
    );
  }

  return (
    <PortalShell me={me.data}>
      <Outlet />
    </PortalShell>
  );
}
