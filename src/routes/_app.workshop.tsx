import { createFileRoute, Outlet } from '@tanstack/react-router';
import { SharedTabletProvider } from '@/modules/workshop/shared-tablet/shared-tablet-provider';
import { EndOfDayPrompt } from '@/modules/workshop/end-of-day/end-of-day-prompt';

// Q60 (tablette partagee : « Qui etes-vous ? ») et Q57 (« Vous etes toujours la ? ») : montes une
// fois pour tous les ecrans de l'atelier (20/11/2026).
export const Route = createFileRoute('/_app/workshop')({
  component: () => (
    <SharedTabletProvider>
      <Outlet />
      <EndOfDayPrompt />
    </SharedTabletProvider>
  ),
});
