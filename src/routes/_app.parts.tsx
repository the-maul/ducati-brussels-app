import { createFileRoute, Outlet } from '@tanstack/react-router';

/** Layout du module Pièces & Accessoires (M2) : les sous-pages rendent ici. */
export const Route = createFileRoute('/_app/parts')({
  component: () => <Outlet />,
});
