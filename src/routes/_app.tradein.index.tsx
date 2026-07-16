import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Bike, ChevronRight, Store } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { listOro } from '@/modules/tradein/api';
import { offerCountsByOro, markOffersSeen } from '@/modules/tradein/partners-api';
import { PartnersDialog } from '@/modules/tradein/partners-dialog';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/tradein/')({
  head: () => ({ meta: [{ title: 'Reprises motos clients — Ducati Bruxelles' }] }),
  component: TradeinList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;

function TradeinList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [partnersOpen, setPartnersOpen] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['oro', activeCompanyId], queryFn: () => listOro(activeCompanyId!), enabled: !!activeCompanyId });
  const offersQ = useQuery({ queryKey: ['oro-offer-counts', activeCompanyId], queryFn: () => offerCountsByOro(activeCompanyId!), enabled: !!activeCompanyId });
  const counts = offersQ.data ?? new Map<string, number>();

  // Ouvrir la page « éteint » la pastille de notification (offres marquées vues).
  useEffect(() => {
    if (!activeCompanyId) return;
    markOffersSeen(activeCompanyId).then(() => {
      qc.invalidateQueries({ queryKey: ['tradein-unseen-offers', activeCompanyId] });
    });
  }, [activeCompanyId, qc]);

  return (
    <>
      <PageHeader
        title={t('tradein.title')}
        description={t('tradein.subtitle')}
        actions={<Button variant="outline" onClick={() => setPartnersOpen(true)}><Store /> {t('tradein.partners')}</Button>}
      />

      {/* Action principale — grande cible tactile (tablette / smartphone) */}
      <Button
        onClick={() => navigate({ to: '/tradein/new' })}
        className="mb-6 h-auto w-full gap-3 py-5 text-[17px] font-bold uppercase tracking-[0.03em] shadow-[var(--shadow-card)] active:scale-[0.99] sm:py-6 sm:text-[19px]"
      >
        <Bike className="size-6" />
        {t('tradein.newMoto')}
      </Button>

      {/* Reprises en cours */}
      <h2 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.ongoing')}</h2>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('tradein.colNumber')}</Th><Th>{t('tradein.colStatus')}</Th><Th className="text-center">{t('tradein.colOffers')}</Th><Th className="text-right">{t('tradein.colCost')}</Th><Th className="w-8" /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('tradein.empty')}</td></tr>}
            {data?.map((o) => {
              const nOffers = counts.get(o.id) ?? 0;
              return (
                <tr key={o.id} onClick={() => navigate({ to: '/tradein/$oroId', params: { oroId: o.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-3 font-mono text-[12px]">{o.number ?? '—'}</td>
                  <td className="px-3 py-3"><StatusBadge tone={o.status === 'cloture' ? 'success' : 'warning'} label={t(`tradein.status_${o.status}`)} /></td>
                  <td className="px-3 py-3 text-center">
                    {nOffers > 0
                      ? <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-[var(--ducati-red-tint)] px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-[var(--ducati-red)]">{nOffers}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{eur(Number(o.total_cost))}</td>
                  <td className="px-3 py-3 text-muted-foreground"><ChevronRight className="size-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activeCompanyId && <PartnersDialog open={partnersOpen} onOpenChange={setPartnersOpen} companyId={activeCompanyId} />}
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
