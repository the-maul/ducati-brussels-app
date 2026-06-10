import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/app-shell';

/** Route layout (pathless) : enveloppe toutes les pages applicatives dans l'AppShell. */
export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
