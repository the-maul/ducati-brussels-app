/**
 * Mission 06, carte 6 — écran « Mise à jour » du catalogue Ducati.
 *
 * Trois choses, dans cet ordre : la DATE du dernier import, CE QUI A CHANGÉ au dernier passage,
 * et le bouton « Mettre à jour ».
 *
 * Le DMS n'appelle jamais Ducati : le bouton *arme* un plan (quels modèles-années relire, à partir
 * de quelle date). C'est l'extension Chrome, avec la session e-catalog de l'utilisateur, qui lit
 * et dépose les données ; elle reçoit le plan quand elle se présente. La marche à suivre est
 * écrite sous le bouton, pour que personne n'ait à deviner.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, Plus, RefreshCw, Replace, Tag, X, Image, CalendarPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { LucideIcon } from 'lucide-react';
import { t } from '@/lib/i18n';
import {
  cancelCatalogUpdate, getCatalogUpdatePlan, getCatalogUpdateSummary, requestCatalogUpdate,
  type CatalogChangeKind,
} from './api';
import { fill, fmtDateTime, fmtInt, fmtMoney } from './format';

const STALE_CHOICES = [7, 15, 30, 90, 180] as const;

const CHANGE_META: Record<CatalogChangeKind, { icon: LucideIcon; labelKey: string }> = {
  model_year_new: { icon: CalendarPlus, labelKey: 'catalog.chgModelYearNew' },
  drawing_new: { icon: Image, labelKey: 'catalog.chgDrawingNew' },
  drawing_changed: { icon: Image, labelKey: 'catalog.chgDrawingChanged' },
  part_new: { icon: Plus, labelKey: 'catalog.chgPartNew' },
  part_replaced: { icon: Replace, labelKey: 'catalog.chgPartReplaced' },
  part_unreplaced: { icon: Replace, labelKey: 'catalog.chgPartUnreplaced' },
  part_price: { icon: Tag, labelKey: 'catalog.chgPartPrice' },
};

export function CatalogUpdatePanel({ companyId }: { companyId: string | null }) {
  const qc = useQueryClient();
  const [staleDays, setStaleDays] = useState<number>(30);
  const [error, setError] = useState<string | null>(null);

  const summary = useQuery({ queryKey: ['ducati-catalog', 'update-summary'], queryFn: () => getCatalogUpdateSummary(50) });
  const preview = useQuery({
    queryKey: ['ducati-catalog', 'update-plan', staleDays],
    queryFn: () => getCatalogUpdatePlan(staleDays, 400),
  });

  const arm = useMutation({
    mutationFn: () => requestCatalogUpdate(companyId as string, staleDays),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['ducati-catalog'] }); },
    onError: (e) => setError(e instanceof Error ? e.message : t('catalog.updErrArm')),
  });
  const cancel = useMutation({
    mutationFn: () => cancelCatalogUpdate(companyId as string),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['ducati-catalog'] }); },
    onError: (e) => setError(e instanceof Error ? e.message : t('catalog.updErrCancel')),
  });

  if (summary.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (summary.error) {
    return (
      <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        {t('catalog.updNotReady')}
      </p>
    );
  }

  const s = summary.data;
  const b = s?.lastBatch ?? null;
  const pending = s?.pending ?? null;
  const running = !!pending?.batchId && !!pending?.consumedAt;
  const counts = preview.data?.counts;

  return (
    <div className="space-y-4">
      {/* 1. Où on en est */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t('catalog.updLastImport')} value={fmtDateTime(s?.lastImportAt)} />
        <Kpi label={t('catalog.updModelYearsComplete')}
          value={`${fmtInt(s?.totals.modelYearsComplete)} / ${fmtInt(s?.totals.modelYears)}`} />
        <Kpi label={t('catalog.updParts')} value={fmtInt(s?.totals.parts)}
          hint={fill(t('catalog.updReplacedTotal'), { n: fmtInt(s?.replacedTotal) })} />
        <Kpi label={t('catalog.updReplacedToday')} value={fmtInt(s?.replacedToday)}
          hint={t('catalog.updReplacedTodayHint')} />
      </section>

      {/* 2. Ce qui a changé au dernier passage */}
      <section className="rounded-md border border-border bg-card p-3">
        <h3 className="font-ui text-[15px] font-bold">{t('catalog.updLastPass')}</h3>
        {!b ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('catalog.updNoPass')}</p>
        ) : (
          <>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {fill(t('catalog.updPassLine'), {
                start: fmtDateTime(b.startedAt), end: fmtDateTime(b.finishedAt),
                my: fmtInt(b.modelYearsDone), drawings: fmtInt(b.drawingsImported), skipped: fmtInt(b.drawingsSkipped),
              })}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Chip kind="model_year_new" n={b.modelYearsNew} />
              <Chip kind="drawing_new" n={b.drawingsNew} />
              <Chip kind="drawing_changed" n={b.drawingsChanged} />
              <Chip kind="part_new" n={b.partsNew} />
              <Chip kind="part_replaced" n={b.partsReplaced} />
              <Chip kind="part_unreplaced" n={s?.lastChangeCounts.part_unreplaced ?? 0} />
              <Chip kind="part_price" n={b.partsPriceChanged} />
            </div>
            {b.lastError && (
              <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
                <AlertTriangle className="size-4" />{b.lastError}
              </p>
            )}
            {!!s?.lastChanges.length && (
              <div className="mt-3 max-h-80 overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-48">{t('catalog.updColKind')}</TableHead>
                      <TableHead className="w-40">{t('catalog.colRef')}</TableHead>
                      <TableHead>{t('catalog.colDesignation')}</TableHead>
                      <TableHead>{t('catalog.updColDetail')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.lastChanges.map((c, i) => (
                      <TableRow key={`${c.kind}-${c.key}-${i}`}>
                        <TableCell className="text-[12px]"><Chip kind={c.kind} n={null} /></TableCell>
                        <TableCell className="whitespace-nowrap font-data tabular-nums">{c.key}</TableCell>
                        <TableCell className="text-sm">{c.label ?? ''}</TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">{detailText(c.kind, c.detail)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </section>

      {/* 3. Mettre à jour */}
      <section className="rounded-md border border-border bg-card p-3">
        <h3 className="font-ui text-[15px] font-bold">{t('catalog.updTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('catalog.updExplain')}</p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {t('catalog.updStaleDays')}
            <Select value={String(staleDays)} onValueChange={(v) => setStaleDays(Number(v))}>
              <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STALE_CHOICES.map((d) => (
                  <SelectItem key={d} value={String(d)}>{fill(t('catalog.updStaleDaysOption'), { d })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {!pending ? (
            <Button type="button" disabled={!companyId || arm.isPending} onClick={() => arm.mutate()}>
              {arm.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('catalog.updButton')}
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={!companyId || cancel.isPending} onClick={() => cancel.mutate()}>
              {cancel.isPending ? <Loader2 className="animate-spin" /> : <X />} {t('catalog.updCancelButton')}
            </Button>
          )}
        </div>

        {preview.isLoading && <Loader2 className="mt-3 size-4 animate-spin text-muted-foreground" />}
        {counts && (
          <p className="mt-3 text-sm">
            {counts.total === 0
              ? t('catalog.updNothingToDo')
              : fill(t('catalog.updPlanLine'), {
                  total: fmtInt(counts.total), never: fmtInt(counts.never),
                  incomplete: fmtInt(counts.incomplete), stale: fmtInt(counts.stale), owned: fmtInt(counts.owned),
                })}
          </p>
        )}

        {pending && (
          <div className="mt-3 rounded-md border border-info/40 bg-info/10 p-3">
            <StatusBadge tone={running ? 'info' : 'warning'} icon={running ? Loader2 : Clock}
              label={running ? t('catalog.updRunning') : t('catalog.updArmed')} />
            <p className="mt-2 text-[12px] text-muted-foreground">
              {fill(t('catalog.updArmedAt'), {
                when: fmtDateTime(pending.requestedAt),
                n: fmtInt(pending.plan?.counts?.total ?? 0),
                days: pending.plan?.staleDays ?? staleDays,
              })}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>{t('catalog.updStep1')}</li>
              <li>{t('catalog.updStep2')}</li>
              <li>{t('catalog.updStep3')}</li>
              <li>{t('catalog.updStep4')}</li>
            </ol>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {!pending && counts?.total === 0 && (
          <p className="mt-2 flex items-center gap-1 text-[12px] text-success">
            <CheckCircle2 className="size-3.5" />{t('catalog.updUpToDate')}
          </p>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-data text-lg tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Chip({ kind, n }: { kind: CatalogChangeKind; n: number | null }) {
  const meta = CHANGE_META[kind];
  if (!meta) return null;
  const label = n == null ? t(meta.labelKey) : `${fmtInt(n)} ${t(meta.labelKey)}`;
  const tone = n === 0 ? 'neutral' : kind === 'part_replaced' || kind === 'part_unreplaced' ? 'warning' : 'info';
  return <StatusBadge tone={tone} icon={meta.icon} label={label} />;
}

/** Détail lisible d'un changement (prix avant/après, remplaçant, planche). */
function detailText(kind: CatalogChangeKind, d: { price?: number | null; replacedBy?: string | null;
  wasReplacedBy?: string | null; before?: unknown; after?: unknown; drawings?: number | null } | null): string {
  if (!d) return '';
  if (kind === 'part_price') {
    const before = typeof d.before === 'number' ? d.before : null;
    const after = typeof d.after === 'number' ? d.after : null;
    return `${fmtMoney(before)} → ${fmtMoney(after)}`;
  }
  if (kind === 'part_replaced') return d.replacedBy ? fill(t('catalog.replacedBy'), { ref: d.replacedBy }) : '';
  if (kind === 'part_unreplaced') return d.wasReplacedBy ? fill(t('catalog.updWasReplacedBy'), { ref: d.wasReplacedBy }) : '';
  if (kind === 'part_new') return d.price != null ? fmtMoney(d.price) : '';
  if (kind === 'model_year_new') return d.drawings != null ? fill(t('catalog.updNDrawings'), { n: fmtInt(d.drawings) }) : '';
  return '';
}
