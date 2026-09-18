/**
 * /app-client — LE lien du site Shopify vers l'application client (décision W-5, 19/09).
 * Adresse stable : elle ne change pas quand l'application ouvre.
 *
 * Selon Paramètres → Application client (`signup_settings.client_app_open`, lu par
 * une server function avec la clé de service, sans connexion) :
 *   - « bientôt disponible » (par défaut) : page de présentation + « Prévenez-moi » ;
 *   - « ouverte » : redirection vers /inscription.
 * Guide Shopify : docs/bible/guides/lien-site-shopify.md.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppClientComingSoon } from '@/modules/signup/app-client-page';
import { getAppClientStatus } from '@/modules/signup/app-client.functions';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/app-client')({
  head: () => ({
    meta: [
      { title: t('appClient.pageTitle') },
      { name: 'description', content: t('appClient.metaDescription') },
    ],
  }),
  loader: async () => {
    const { open } = await getAppClientStatus();
    if (open) throw redirect({ to: '/inscription', replace: true });
    return null;
  },
  component: AppClientComingSoon,
});
