import { createFileRoute, Outlet } from '@tanstack/react-router';
import { MinimaxNightNotice } from '@/modules/purchases/minimax-night-notice';

// Achats et paniers : bandeau de la liste de la nuit (reassort minimax en proposition manuelle, Q52).
export const Route = createFileRoute('/_app/purchases')({
  component: () => (
    <>
      <MinimaxNightNotice />
      <Outlet />
    </>
  ),
});
