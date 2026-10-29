/**
 * Signature d'une proposition d'intervention (ATE008 / ATE009) : page PUBLIQUE, sans connexion,
 * ouverte par le lien signe recu par mail ou depuis l'espace client (/signer/<jeton>), et aussi
 * par le comptoir (« Faire signer sur la tablette », ?mode=comptoir&retour=<orId>).
 * Tout le comportement est dans src/modules/documents/proposal-sign-screen.tsx.
 */
import { createFileRoute } from '@tanstack/react-router';
import { ProposalSignScreen } from '@/modules/documents/proposal-sign-screen';
import { pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/signer/$token')({
  head: () => ({
    meta: [
      { title: pageTitle('sign') },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { mode?: 'comptoir'; retour?: string } => ({
    mode: s.mode === 'comptoir' ? 'comptoir' : undefined,
    retour: typeof s.retour === 'string' ? s.retour : undefined,
  }),
  component: SignPage,
});

function SignPage() {
  const { token } = Route.useParams();
  const { mode, retour } = Route.useSearch();
  return <ProposalSignScreen token={token} mode={mode === 'comptoir' ? 'comptoir' : 'distance'} backToOrId={retour ?? null} />;
}
