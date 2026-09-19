/**
 * Mission 02, carte 9 — Écran client du comptoir (2e écran tourné vers le client).
 * Plein écran, sans navigation, réservé à l'équipe : sans session → /login ; sans rôle → message.
 * Tout le comportement est dans src/modules/sales/customer-display.tsx.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { CustomerDisplay } from '@/modules/sales/customer-display';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/ecran-client')({
  head: () => ({
    meta: [
      { title: `${t('qrPay.displayTitle')} — ${t('app.name')}` },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: CounterDisplayPage,
});

function CounterDisplayPage() {
  const { loading, session, roles } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: '/login' });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (roles.length === 0) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-8">
        <p className="text-[20px] text-muted-foreground">{t('qrPay.staffOnly')}</p>
      </div>
    );
  }
  return <CustomerDisplay />;
}
