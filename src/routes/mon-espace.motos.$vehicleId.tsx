import { createFileRoute } from '@tanstack/react-router';
import { VehicleDetailView } from '@/modules/portal/vehicles';
import { pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/mon-espace/motos/$vehicleId')({
  head: () => ({ meta: [{ title: pageTitle('portalBike') }] }),
  component: VehiclePage,
});

function VehiclePage() {
  const { vehicleId } = Route.useParams();
  return <VehicleDetailView vehicleId={vehicleId} />;
}
