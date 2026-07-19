import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Bike, ChevronRight, Store, FileDown, BellRing, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listOro, repriseClientLabel } from '@/modules/tradein/api';
import {
  offerStatsByOro, markOffersSeen, needsFollowUp, getDispatchMode, setDispatchMode, type DispatchMode,
} from '@/modules/tradein/partners-api';
import { PartnersDialog } from '@/modules/tradein/partners-dialog';
import { downloadSheetForOro } from '@/modules/tradein/sheet-builder';
import { tradeinStatusOf } from '@/modules/tradein/validate-api';
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
  const statsQ = useQuery({ queryKey: ['oro-offer-stats', activeCompanyId], queryFn: () => offerStatsByOro(activeCompanyId!), enabled: !!activeCompanyId });
  const stats = statsQ.data ?? new Map<string, { count: number; best: number }>();

  // Mode d'envoi aux marchands — réglage GÉNÉRAL, directement sur la page
  const dispatchQ = useQuery({ queryKey: ['tradein-dispatch', activeCompanyId], queryFn: () => getDispatchMode(activeCompanyId!), enabled: !!activeCompanyId });
  const setMode = useMutation({
    mutationFn: (m: DispatchMode) => setDispatchMode(activeCompanyId!, m),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tradein-dispatch', activeCompanyId] }),
    onError: () => toast.error(t('tradein.errSave')),
  });

  // Ouvrir la page « éteint » la pastille de notification (offres marquées vues).
  useEffect(() => {
    if (!activeCompanyId) return;
    markOffersSeen(activeCompanyId).then(() => {
      qc.invalidateQueries({ queryKey: ['tradein-unseen-offers', activeCompanyId] });
    });
  }, [activeCompanyId, qc]);

  const printSheet = (oroId: string) => {
    downloadSheetForOro(oroId).catch(() => toast.error(t('tradein.errSave')));
  };

  return (
    <>
      <PageHeader
        title={t('tradein.title')}
        description={t('tradein.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dispatchQ.data ?? 'semi_auto'} onValueChange={(v) => setMode.mutate(v as DispatchMode)}>
              <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="semi_auto">{t('tradein.dispatch_semi_auto')}</SelectItem>
                <SelectItem value="auto">{t('tradein.dispatch_auto')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setPartnersOpen(true)}><Store /> {t('tradein.partners')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/tradein/partners' })}><Users /> {t('tradein.partnersManage')}</Button>
          </div>
        }
      />

      {/* Action principale — grande cible tactile (tablette / smartphone) */}
      <Button
        onClick={() => navigate({ to: '/tradein/new' })}
        className="mb-6 h-auto w-full gap-3 py-4 shadow-[var(--shadow-card)] active:scale-[0.99] sm:py-5"
      >
        <Bike className="size-6" />
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] opacity-80 sm:text-[11px]">{t('tradein.formLabel')}</span>
          <span className="text-[17px] font-bold uppercase tracking-[0.03em] sm:text-[19px]">{t('tradein.newMoto')}</span>
        </span>
      </Button>

      {/* Reprises en cours */}
      <h2 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.ongoing')}</h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('tradein.colNumber')}</Th>
              <Th>{t('tradein.colClient')}</Th>
              <Th>{t('tradein.colMoto')}</Th>
              <Th>{t('tradein.colStatus')}</Th>
              <Th className="text-center">{t('tradein.colOffers')}</Th>
              <Th className="text-right">{t('tradein.colBest')}</Th>
              <Th className="w-20 text-center">{t('tradein.pdfSheet')}</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{t('tradein.empty')}</td></tr>}
            {data?.map((o) => {
              const st = stats.get(o.id) ?? { count: 0, best: 0 };
              const moto = o.vehicle_info
                ? [o.vehicle_info.brand, o.vehicle_info.model, o.vehicle_info.model_year ? `(${o.vehicle_info.model_year})` : null].filter(Boolean).join(' ')
                : '—';
              const tStatus = tradeinStatusOf(o as unknown as Record<string, unknown>, o.id, o.vehicle_info);
              const followUp = tStatus === 'ouvert' && needsFollowUp(o.created_at, st.count, o.status);
              return (
                <tr key={o.id} onClick={() => navigate({ to: '/tradein/$oroId', params: { oroId: o.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-3 font-mono text-[12px]">
                    <span className="underline decoration-dotted underline-offset-2">{o.number ?? '—'}</span>
                  </td>
                  <td className="px-3 py-3 font-medium">{repriseClientLabel(o.client)}</td>
                  <td className="px-3 py-3">{moto}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <StatusBadge
                        tone={tStatus === 'valide' ? 'success' : tStatus === 'annule' ? 'neutral' : 'warning'}
                        label={t(`tradein.tstatus_${tStatus}`)}
                      />
                      {followUp && <StatusBadge tone="danger" icon={BellRing} label={t('tradein.followUp')} />}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {st.count > 0
                      ? <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-[var(--ducati-red-tint)] px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-[var(--ducati-red)]">{st.count}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums">{st.best > 0 ? eur(st.best) : '—'}</td>
                  <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" title={t('tradein.wizDoneSheet')} onClick={() => printSheet(o.id)}>
                      <FileDown className="size-4" />
                    </Button>
                  </td>
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
