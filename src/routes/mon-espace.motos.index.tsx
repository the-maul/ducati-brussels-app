import { createFileRoute } from '@tanstack/react-router';
import { VehicleListView } from '@/modules/portal/vehicles';
import { pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/mon-espace/motos/')({
  head: () => ({ meta: [{ title: pageTitle('portalBikes') }] }),
  component: VehicleListView,
});
