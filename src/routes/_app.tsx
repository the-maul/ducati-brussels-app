import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth/auth-context';
import { isPortalClient } from '@/lib/auth/home-path';
import { isClientHost, PORTAL_HOME } from '@/lib/portal-host';

/**
 * Route layout (pathless) : protège les pages du personnel + AppShell.
 * - sans session → /login ;
 * - compte client (aucun rôle, fiche liée) → /mon-espace ;
 * - hôte réservé aux clients (VITE_CLIENT_APP_HOST) → /mon-espace pour tout le monde.
 * Le personnel (au moins un rôle) n'est pas concerné : aucune requête en plus.
 */
export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout() {
  const { loading, session, roles } = useAuth();
  const navigate = useNavigate();
  const clientHost = isClientHost();
  const noRole = !loading && !!session && roles.length === 0;

  // Sans rôle : est-ce un client ? (sinon, l'écran « aucun accès » habituel s'affiche)
  const clientCheck = useQuery({
    queryKey: ['portal', 'is-client', session?.user.id],
    queryFn: isPortalClient,
    enabled: noRole && !clientHost,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (loading) return;
    if (!session) { navigate({ to: '/login' }); return; }
    if (clientHost || clientCheck.data === true) navigate({ to: PORTAL_HOME });
  }, [loading, session, clientHost, clientCheck.data, navigate]);

  const waiting = loading || (noRole && !clientHost && clientCheck.isPending);
  if (waiting) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session || clientHost || clientCheck.data === true) return null;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
