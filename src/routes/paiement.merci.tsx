/**
 * Page PUBLIQUE de retour apres un paiement Stripe (mission 12, carte P3, PDV040).
 * Stripe y renvoie le client (success_url / cancel_url de la session) : « Merci » ou « Paiement non
 * effectue », avec la reference du document. Aucune donnee lue en base, aucune connexion : la
 * confirmation reelle arrive au DMS par le webhook signe, jamais par cette page.
 */
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, CircleSlash } from 'lucide-react';
import { pageTitle, t, fillVars } from '@/lib/i18n';

export const Route = createFileRoute('/paiement/merci')({
  head: () => ({
    meta: [
      { title: pageTitle('payment') },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { ref?: string; etat?: 'annule' } => ({
    ref: typeof s.ref === 'string' ? s.ref.slice(0, 60) : undefined,
    etat: s.etat === 'annule' ? 'annule' : undefined,
  }),
  component: PaymentThanksPage,
});

function PaymentThanksPage() {
  const { ref, etat } = Route.useSearch();
  const cancelled = etat === 'annule';
  const Icon = cancelled ? CircleSlash : CheckCircle2;
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="flex max-w-md flex-col items-center gap-4 text-center" role="status">
        <Icon className={`size-20 ${cancelled ? 'text-muted-foreground' : 'text-success'}`} aria-hidden />
        <h1 className="font-display text-[32px] uppercase leading-tight">{cancelled ? t('stripePay.cancelTitle') : t('stripePay.thanksTitle')}</h1>
        <p className="text-[16px] text-muted-foreground">{cancelled ? t('stripePay.cancelBody') : t('stripePay.thanksBody')}</p>
        {ref && <p className="font-data text-[14px] tabular-nums">{fillVars(t('stripePay.thanksRef'), { ref })}</p>}
      </div>
    </div>
  );
}
