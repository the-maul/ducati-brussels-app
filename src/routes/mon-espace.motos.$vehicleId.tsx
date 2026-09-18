import { createFileRoute } from '@tanstack/react-router';
import { VehicleDetailView } from '@/modules/portal/vehicles';

export const Route = createFileRoute('/mon-espace/motos/$vehicleId')({
  head: () => ({ meta: [{ title: 'Ma moto — Ducati Bruxelles' }] }),
  component: VehiclePage,
});

function VehiclePage() {
  const { vehicleId } = Route.useParams();
  return <VehicleDetailView vehicleId={vehicleId} />;
}
