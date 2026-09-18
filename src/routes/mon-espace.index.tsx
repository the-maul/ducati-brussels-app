import { createFileRoute } from '@tanstack/react-router';
import { PortalHomeView } from '@/modules/portal/portal-home';

export const Route = createFileRoute('/mon-espace/')({
  component: PortalHomeView,
});
