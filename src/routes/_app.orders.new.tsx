import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Zap, CalendarDays, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { createPartOrder, type OrderKind } from '@/modules/orders/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/orders/new')({
  head: () => ({ meta: [{ title: 'Nouvelle commande de pièces — Ducati Bruxelles' }] }),
  component: NewOrder,
});

const KINDS: { key: OrderKind; icon: typeof Zap; descKey: string }[] = [
  { key: 'urgente', icon: Zap, descKey: 'orders.kindDesc_urgente' },
  { key: 'standard', icon: CalendarDays, descKey: 'orders.kindDesc_standard' },
  { key: 'excel', icon: FileSpreadsheet, descKey: 'orders.kindDesc_excel' },
  { key: 'accident', icon: AlertTriangle, descKey: 'orders.kindDesc_accident' },
];

function NewOrder() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [kind, setKind] = useState<OrderKind>('standard');
  const [channel, setChannel] = useState<'comptoir' | 'mail'>('comptoir');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createPartOrder({ companyId: activeCompanyId!, orderKind: kind, channel }),
    onSuccess: (id) => navigate({ to: '/orders/$orderId', params: { orderId: id } }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Erreur'),
  });

  return (
    <>
      <PageHeader
        title={t('orders.new')}
        description={t('orders.newSubtitle')}
        breadcrumbs={[{ label: t('orders.title'), to: '/orders' }, { label: t('orders.new') }]}
      />

      <div className="max-w-2xl space-y-6">
        <div>
          <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.colKind')}</label>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map(({ key, icon: Icon, descKey }) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors ${
                  kind === key ? 'border-ring bg-accent' : 'border-border hover:bg-accent'
                }`}
              >
                <span className="flex items-center gap-2 font-ui text-sm font-bold"><Icon className="size-4" /> {t(`orders.kind_${key}`)}</span>
                <span className="text-[12px] text-muted-foreground">{t(descKey)}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.colChannel')}</label>
          <div className="flex gap-2">
            {(['comptoir', 'mail'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
                className={`rounded-md border px-4 py-2 text-sm font-ui transition-colors ${
                  channel === c ? 'border-ring bg-accent font-bold' : 'border-border hover:bg-accent'
                }`}
              >
                {t(`orders.channel_${c}`)}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate({ to: '/orders' })}>{t('action.cancel')}</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : null} {t('orders.create')}
          </Button>
        </div>
      </div>
    </>
  );
}
