import { createFileRoute } from '@tanstack/react-router';
import { VehicleListView } from '@/modules/portal/vehicles';

export const Route = createFileRoute('/mon-espace/motos/')({
  head: () => ({ meta: [{ title: 'Mes motos — Ducati Bruxelles' }] }),
  component: VehicleListView,
});
