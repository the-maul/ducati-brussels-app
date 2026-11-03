/**
 * Ecran client du comptoir (mission 02 carte 9 ; mission 12 carte P2, PDV020).
 * Page PUBLIQUE plein ecran, sans navigation : une tablette posee face au client s y appaire sans
 * compte (code a 6 caracteres, jeton d appareil) ; la fenetre « Ouvrir l ecran client » du vendeur
 * (session equipe) marche comme avant. `?appairer=1` force l appairage sur un appareil connecte.
 * Tout le comportement est dans src/modules/sales/customer-screen-device.tsx.
 */
import { createFileRoute } from '@tanstack/react-router';
import { CustomerScreenPage } from '@/modules/sales/customer-screen-device';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/ecran-client')({
  head: () => ({
    meta: [
      { title: `${t('qrPay.displayTitle')} — ${t('app.name')}` },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { appairer?: boolean } => ({
    appairer: s.appairer === '1' || s.appairer === 1 || s.appairer === true ? true : undefined,
  }),
  component: CounterDisplayPage,
});

function CounterDisplayPage() {
  const { appairer } = Route.useSearch();
  return <CustomerScreenPage forcePairing={!!appairer} />;
}
