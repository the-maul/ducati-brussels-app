/**
 * M6 — Liste de préparation sur tablette (mission 05, carte 6).
 * « L'avoir en digital sur une tablette : disponible, commandé, préparé, monté… où c'est dans le
 * stock et où c'est quand c'est préparé pour le client » (Domenico, vidéo G8 5:53).
 * Grands boutons tactiles, lisible debout. Changer d'étape ne bouge pas le stock.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, FileText, Loader2, MapPin, Truck, PackageCheck, Wrench, Undo2, Save, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  getPickingHeader, getPickingDetail, setPickingStep, setPickingLocation, prepDisplayState, prepProgress,
  pickingActions, PREP_STEPS, type PrepStep, type PickingLine, type PrepDisplayState,
} from '@/modules/sales/picking-api';
import { PickingActions, PickingStatusBadge } from '@/modules/sales/picking-actions';
import { SALE_STOCK_META } from '@/modules/sales/availability';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/preparation/$pickingId')({
  head: () => ({ meta: [{ title: 'Préparation — Ducati Bruxelles' }] }),
  component: PreparationTablet,
});

const LOCATION_PRESETS = ['Buanderie', 'G.ET.C', 'P.ET.C', 'ET@'] as const;

const STEP_META: Record<PrepStep, { tone: StatusTone; icon: LucideIcon }> = {
  commande: { tone: 'info', icon: Truck },
  prepare: { tone: 'success', icon: PackageCheck },
  monte: { tone: 'success', icon: Wrench },
};

const qty = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const when = (iso: string) => new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function StateBadge({ state }: { state: PrepDisplayState }) {
  if (state === 'na') return null;
  if ((PREP_STEPS as readonly string[]).includes(state)) {
    const m = STEP_META[state as PrepStep];
    return <StatusBadge tone={m.tone} icon={m.icon} label={t(`picking.step_${state}`)} />;
  }
  const m = SALE_STOCK_META[state as keyof typeof SALE_STOCK_META];
  return <StatusBadge tone={m.tone} icon={m.icon} label={t(m.labelKey)} />;
}

function PreparationTablet() {
  const { pickingId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const headerQ = useQuery({ queryKey: ['picking-header', pickingId], queryFn: () => getPickingHeader(pickingId) });
  const linesQ = useQuery({ queryKey: ['picking-tablet', pickingId], queryFn: () => getPickingDetail(pickingId) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['picking-header', pickingId] });
    qc.invalidateQueries({ queryKey: ['picking-tablet', pickingId] });
    qc.invalidateQueries({ queryKey: ['picking-lists'] });
    qc.invalidateQueries({ queryKey: ['picking-items', pickingId] });
  };

  const stepMut = useMutation({
    meta: { success: false, error: false },
    mutationFn: ({ itemId, step }: { itemId: string; step: PrepStep | null }) => setPickingStep(itemId, step),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('picking.errStep')),
  });

  const header = headerQ.data;
  const lines = linesQ.data ?? [];
  const locked = header ? !pickingActions(header).editSteps : false;
  const progress = prepProgress(lines.filter((l) => !l.removed));

  if (headerQ.isLoading || linesQ.isLoading) {
    return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!header) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('picking.errOpen')}</p>;

  const docLabel = header.doc_type
    ? `${t(`sales.type_${header.doc_type}`)} ${header.doc_number ?? t('sales.draftSuffix')}`
    : t('picking.noDocument');
  const backToList = () => navigate({ to: '/picking' });

  return (
    <>
      <PageHeader
        title={`${t('picking.tabletTitle')} — ${docLabel}`}
        description={[
          `${t('picking.tabletClient')} : ${header.client_name ?? t('picking.tabletNoClient')}`,
          header.vehicle_label ? `${t('picking.printVehicle')} : ${header.vehicle_label}` : '',
          header.seller_name ? `${t('picking.printSeller')} : ${header.seller_name}` : '',
        ].filter(Boolean).join(' · ')}
        breadcrumbs={[{ label: t('picking.tabletBack'), to: '/picking' }, { label: docLabel }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-12 px-4 text-base" onClick={backToList}><ArrowLeft /> {t('picking.tabletBack')}</Button>
            {header.document_id && (
              <Button variant="outline" className="h-12 px-4 text-base" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: header.document_id! } })}>
                <FileText /> {docLabel}
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PickingStatusBadge row={header} className="px-3 py-1.5 text-[14px]" />
        <span className="font-data text-lg font-bold tabular-nums">
          {t('picking.progress').replace('{done}', String(progress.done)).replace('{total}', String(progress.total))}
        </span>
        <div className="ml-auto"><PickingActions row={header} variant="tablet" onDeleted={backToList} /></div>
      </div>

      {header.status === 'annulee' && (
        <p className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-[14px] text-danger">
          {t('picking.cancelledInfo')
            .replace('{who}', header.cancelled_by_name ?? '—')
            .replace('{when}', header.cancelled_at ? when(header.cancelled_at) : '—')
            .replace('{reason}', header.cancel_reason ?? '—')}
        </p>
      )}
      {header.status === 'livre' && (
        <p className="mb-3 rounded-md bg-info-bg px-3 py-2 text-[14px] text-info">
          {t('picking.finishedInfo')
            .replace('{who}', header.completed_by_name ?? '—')
            .replace('{when}', header.completed_at ? when(header.completed_at) : '—')}
        </p>
      )}
      {header.doc_changed && !locked && (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[14px] text-warning">
          <AlertTriangle className="size-4 shrink-0" /> {t('picking.docChangedHint')}
        </p>
      )}

      <LocationCard pickingId={pickingId} current={header.location} locked={locked} onSaved={refresh} />

      <p className="mb-3 text-[12px] text-muted-foreground">{t('picking.noStockMove')}</p>

      {lines.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{t('picking.tabletEmpty')}</div>
      )}

      <div className="grid gap-3">
        {lines.map((l) => (
          <LineCard
            key={l.id} line={l} locked={locked} pending={stepMut.isPending}
            onStep={(step) => stepMut.mutate({ itemId: l.id, step })}
          />
        ))}
      </div>
    </>
  );
}

function LocationCard({ pickingId, current, locked, onSaved }: { pickingId: string; current: string | null; locked: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? current ?? '';
  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: (loc: string) => setPickingLocation(pickingId, loc),
    onSuccess: () => { toast.success(t('picking.prepLocationSaved')); setDraft(null); onSaved(); },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('picking.errUpdate')),
  });
  return (
    <Card className="mb-4">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="size-5 text-muted-foreground" />
          <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('picking.prepLocation')}</span>
          <span className="ml-2 font-data text-xl font-bold">{current || <span className="text-base font-normal text-muted-foreground">{t('picking.prepLocationNone')}</span>}</span>
        </div>
        <p className="text-[12px] text-muted-foreground">{t('picking.prepLocationHint')}</p>
        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            {LOCATION_PRESETS.map((p) => (
              <Button key={p} variant={value === p ? 'default' : 'outline'} className="h-12 px-5 text-base" onClick={() => save.mutate(p)} disabled={save.isPending}>
                {p}
              </Button>
            ))}
            <Input
              value={value} maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('picking.prepLocationPlaceholder')}
              className="h-12 w-56 font-mono text-base"
            />
            <Button className="h-12 px-5 text-base" onClick={() => save.mutate(value)} disabled={save.isPending || draft === null}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('picking.prepLocationSave')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LineCard({ line, locked, pending, onStep }: {
  line: PickingLine; locked: boolean; pending: boolean; onStep: (step: PrepStep | null) => void;
}) {
  const state = prepDisplayState(line);
  const free = (line.real_qty ?? 0) - (line.reserved_qty ?? 0);
  const stepIcon: Record<PrepStep, LucideIcon> = { commande: Truck, prepare: PackageCheck, monte: Wrench };
  return (
    <Card className={line.removed ? 'border-dashed opacity-70' : undefined}>
      <CardContent className="space-y-3 p-4">
        {line.removed && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="warning" icon={AlertTriangle} label={t('picking.removedBadge')} />
            <span className="text-[12px] text-muted-foreground">{t('picking.removedHint')}</span>
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {line.reference && <div className="font-mono text-[13px] text-muted-foreground">{line.reference}</div>}
            <div className="text-lg font-bold leading-tight">{line.designation || '—'}</div>
            <div className="mt-1 font-data text-base tabular-nums">× {qty(line.qty_ordered)}</div>
          </div>
          <StateBadge state={state} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('picking.bins')}</span>
          {line.bins.length === 0
            ? <span className="text-sm text-muted-foreground">{t('picking.noBin')}</span>
            : line.bins.map((b) => (
              <span key={b} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-base font-bold">
                <MapPin className="size-4 text-muted-foreground" />{b}
              </span>
            ))}
          {line.article_id && (
            <span className="ml-auto font-data text-[13px] tabular-nums text-muted-foreground">
              {t('picking.stockLine').replace('{free}', qty(free)).replace('{order}', qty(line.on_order_qty ?? 0))}
            </span>
          )}
        </div>

        {line.prep_step && line.prep_step_at && (
          <p className="text-[12px] text-muted-foreground">
            {t('picking.stepBy')
              .replace('{step}', t(`picking.step_${line.prep_step}`))
              .replace('{who}', line.prep_step_by_name ?? '—')
              .replace('{when}', when(line.prep_step_at))}
          </p>
        )}

        {!locked && (
          <div className="flex flex-wrap gap-2">
            {PREP_STEPS.map((s) => {
              const Icon = stepIcon[s];
              const active = line.prep_step === s;
              return (
                <Button
                  key={s} variant={active ? 'default' : 'outline'}
                  className="h-14 min-w-36 flex-1 text-base"
                  disabled={pending || active}
                  onClick={() => onStep(s)}
                >
                  <Icon className="size-5" /> {t(`picking.step_${s}`)}
                </Button>
              );
            })}
            {line.prep_step && (
              <Button variant="ghost" className="h-14 text-base" disabled={pending} onClick={() => onStep(null)}>
                <Undo2 className="size-5" /> {t('picking.stepUndo')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
