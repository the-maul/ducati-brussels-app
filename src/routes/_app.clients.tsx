import { createFileRoute, Outlet } from '@tanstack/react-router';

/** Layout du module Clients (M1) : les sous-pages (liste, fiche) rendent ici. */
export const Route = createFileRoute('/_app/clients')({
  component: () => <Outlet />,
});
