import { createFileRoute, redirect } from '@tanstack/react-router';
import { isClientHost, PORTAL_HOME, STAFF_HOME } from '@/lib/portal-host';

// Racine : le personnel va au tableau de bord (qui renvoie lui-même un client vers
// son espace) ; sur l'hôte réservé aux clients, directement vers /mon-espace.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: isClientHost() ? PORTAL_HOME : STAFF_HOME });
  },
});
