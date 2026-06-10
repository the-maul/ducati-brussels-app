import { createFileRoute, Outlet } from '@tanstack/react-router';

/** Layout du module Véhicules (M3) : les sous-pages rendent ici. */
export const Route = createFileRoute('/_app/vehicles')({
  component: () => <Outlet />,
});
