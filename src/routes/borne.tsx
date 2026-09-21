/**
 * Mission 01, lot 4 — Borne du comptoir (tablette en mode kiosque).
 * Page publique, sans navigation. Tout le comportement kiosque est dans
 * src/modules/signup/kiosk.tsx ; le verrouillage de la tablette dans
 * docs/bible/guides/borne-kiosque.md.
 * Les adresses des tuiles « Configurer ma Ducati » et « Nos occasions » sont lues
 * côté serveur (Paramètres → Borne d'inscription, défauts dans kiosk-links.ts).
 */
import { createFileRoute } from '@tanstack/react-router';
import { KioskSignup } from '@/modules/signup/kiosk';
import { getKioskLinks } from '@/modules/signup/kiosk-links.functions';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/borne')({
  head: () => ({
    meta: [
      { title: t('signup.kioskPageTitle') },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
      // Ajoutée à l'écran d'accueil, la borne s'ouvre sans barre d'adresse (guide borne-kiosque.md).
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: t('signup.brand') },
    ],
  }),
  loader: () => getKioskLinks(),
  component: BornePage,
});

function BornePage() {
  const links = Route.useLoaderData();
  return <KioskSignup links={links} />;
}
