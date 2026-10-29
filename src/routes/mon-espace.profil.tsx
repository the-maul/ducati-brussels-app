import { createFileRoute } from '@tanstack/react-router';
import { ProfileView } from '@/modules/portal/profile';
import { pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/mon-espace/profil')({
  head: () => ({ meta: [{ title: pageTitle('portalProfile') }] }),
  component: ProfileView,
});
