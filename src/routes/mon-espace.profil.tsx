import { createFileRoute } from '@tanstack/react-router';
import { ProfileView } from '@/modules/portal/profile';

export const Route = createFileRoute('/mon-espace/profil')({
  head: () => ({ meta: [{ title: 'Mon profil — Ducati Bruxelles' }] }),
  component: ProfileView,
});
