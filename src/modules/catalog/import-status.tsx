/**
 * Catalogue Ducati — état de l'import : compteurs et lots (qui, quand, état, dernière activité).
 */
import { useQuery } from '@tanstack/react-query';
import { Bike, CalendarRange, Layers, ListOrdered, Hash, Link2, Loader2, PauseCircle, XCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { KpiCard } from '@/components/kpi-card';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t } from '@/lib/i18n';
import { getArticleLinkCount, getCatalogStats, listCatalogBatches, type CatalogBatch } from './api';
import { fill, fmtDateTime, fmtInt } from './format';

const STATUS: Record<string, { tone: StatusTone; icon: typeof Loader2; key: string }> = {
  running: { tone: 'info', icon: Loader2, key: 'catalog.stRunning' },
  paused: { tone: 'warning', icon: PauseCircle, key: 'catalog.stPaused' },
  stopped: { tone: 'neutral', icon: XCircle, key: 'catalog.stStopped' },
  error: { tone: 'danger', icon: AlertTriangle, key: 'catalog.stError' },
  done: { tone: 'success', icon: CheckCircle2, key: 'catalog.stDone' },
};

export function BatchStatusBadge({ status }: { status: string }) {
  const m = STATUS[status] ?? STATUS.stopped;
  return <StatusBadge tone={m.tone} icon={m.icon} label={t(m.key)} />;
}

export function CatalogImportStatus({ companyId = null }: { companyId?: string | null }) {
  const stats = useQuery({ queryKey: ['ducati-catalog', 'stats'], queryFn: getCatalogStats, refetchInterval: 30000 });
  const batches = useQuery({ queryKey: ['ducati-catalog', 'batches'], queryFn: () => listCatalogBatches(15), refetchInterval: 30000 });
  const s = stats.data;
  // Articles du DMS reliés au catalogue par la référence (absent tant que la migration n'est pas appliquée).
  const links = useQuery({
    queryKey: ['ducati-catalog', 'link-count', companyId],
    queryFn: () => getArticleLinkCount(companyId as string),
    enabled: !!companyId,
    retry: false,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t('catalog.kpiModels')} value={fmtInt(s?.models)} icon={Bike} />
        <KpiCard label={t('catalog.kpiModelYears')} value={fmtInt(s?.modelYears)} icon={CalendarRange}
          delta={s ? fill(t('catalog.modelYearsComplete'), { done: fmtInt(s.modelYearsComplete), loaded: fmtInt(s.modelYearsLoaded) }) : undefined} />
        <KpiCard label={t('catalog.kpiDrawings')} value={fmtInt(s?.drawings)} icon={Layers}
          delta={s ? fill(t('catalog.drawingsWithParts'), { n: fmtInt(s.drawingsWithParts) }) : undefined} />
        <KpiCard label={t('catalog.kpiLines')} value={fmtInt(s?.lines)} icon={ListOrdered} />
        <KpiCard label={t('catalog.kpiParts')} value={fmtInt(s?.parts)} icon={Hash} />
        <KpiCard label={t('catalog.kpiLinked')} value={fmtInt(links.data?.linked)} icon={Link2}
          delta={links.data ? fill(t('catalog.linkedOf'), { n: fmtInt(links.data.articles) }) : undefined} />
      </div>

      <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="font-ui text-[15px] font-bold">{t('catalog.batches')}</h2>
        {batches.isLoading ? (
          <Loader2 className="mt-3 size-5 animate-spin text-muted-foreground" />
        ) : !batches.data?.length ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('catalog.noBatch')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('catalog.colStarted')}</TableHead>
                  <TableHead>{t('catalog.colStatus')}</TableHead>
                  <TableHead>{t('catalog.colSource')}</TableHead>
                  <TableHead>{t('catalog.colCounters')}</TableHead>
                  <TableHead>{t('catalog.colActivity')}</TableHead>
                  <TableHead>{t('catalog.colError')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.data.map((b: CatalogBatch) => (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{fmtDateTime(b.started_at)}</TableCell>
                    <TableCell><BatchStatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-sm">{b.started_by ? t('catalog.srcExtension') : t('catalog.srcLoader')}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {fill(t('catalog.counters'), {
                        my: `${fmtInt(b.model_years_done)}${b.model_years_total ? ` / ${fmtInt(b.model_years_total)}` : ''}`,
                        drawings: fmtInt(b.drawings_imported), skipped: fmtInt(b.drawings_skipped), lines: fmtInt(b.lines_imported),
                      })}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{fmtDateTime(b.updated_at)}</TableCell>
                    <TableCell className="max-w-[320px] truncate text-sm text-muted-foreground" title={b.last_error ?? ''}>{b.last_error ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
