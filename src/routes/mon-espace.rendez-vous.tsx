import { createFileRoute } from '@tanstack/react-router';
import { AppointmentsView } from '@/modules/portal/appointments';
import { pageTitle } from '@/lib/i18n';

// ?nouveau=1 ouvre directement le formulaire de demande ; ?moto=<id> présélectionne la moto
// (simple préremplissage : la base vérifie que la moto appartient bien au client).
export const Route = createFileRoute('/mon-espace/rendez-vous')({
  head: () => ({ meta: [{ title: pageTitle('portalAppointments') }] }),
  validateSearch: (s: Record<string, unknown>): { nouveau?: boolean; moto?: string } => ({
    ...(s.nouveau === true || s.nouveau === 1 || s.nouveau === '1' || s.nouveau === 'true' ? { nouveau: true } : {}),
    ...(typeof s.moto === 'string' && /^[0-9a-f-]{36}$/i.test(s.moto) ? { moto: s.moto } : {}),
  }),
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const { nouveau, moto } = Route.useSearch();
  return <AppointmentsView key={`${nouveau ? 1 : 0}-${moto ?? ''}`} openForm={nouveau} vehicleId={moto} />;
}
