/**
 * M8 — Q60 (20/11/2026) : haut de « Mon atelier » sur une tablette partagee. A la place du
 * « mecanicien connecte » (c'est le compte tablette) : qui est identifie, son pointage du moment
 * et les gros boutons Pause / Reprendre / Terminer, sous son identite. Personne d'identifie :
 * un gros bouton « Qui etes-vous ? ».
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Pause, Play, RotateCcw, Square, Timer, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { fillVars, getLocale, t } from '@/lib/i18n';
import { pauseWork, stopWorkPointage } from '../pointage/api';
import { PauseDialog } from '../pointage/work-controls';
import { stopLabel, type PauseReason } from '../pointage/rules';
import { sharedCurrent } from './api';
import { identityValid } from './rules';
import { IdentityCancelled, requestIdentity } from './store';
import { SharedIdentityBar, useSharedTablet } from './shared-tablet-provider';

const BIG = 'px-2.5 py-1 text-[14px]';
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(`${getLocale()}-BE`, { hour: '2-digit', minute: '2-digit' });
const PAUSED = new Set(['pause', 'switch', 'auto_stop', 'departure']);

export function SharedNowPanel({ reasons, orNumbers, canWrite, onResume, onChanged }: {
  reasons: PauseReason[];
  orNumbers: ReadonlyMap<string, string | null>;
  canWrite: boolean;
  onResume: (orId: string) => Promise<void>;
  onChanged: () => void;
}) {
  const s = useSharedTablet();
  const id = identityValid(s.identity) ? s.identity : null;
  const cur = useQuery({
    queryKey: ['shared-current', id?.session ?? null], queryFn: () => sharedCurrent(id!.session),
    enabled: !!id, refetchInterval: 30_000, retry: false,
  });
  const [pauseOpen, setPauseOpen] = useState(false);
  const open = cur.data?.open ?? null;
  const last = !open && cur.data?.last && PAUSED.has(cur.data.last.stop_kind ?? '') ? cur.data.last : null;
  const onErr = (e: unknown) => { if (!(e instanceof IdentityCancelled)) toast.error(e instanceof Error ? e.message : t('workshop.errSave')); };
  const done = () => { void cur.refetch(); onChanged(); };

  const pause = useMutation({
    mutationFn: (v: { reason: string; orStatus: string | null }) => pauseWork({ reason: v.reason, entryId: open?.id ?? null, orId: open?.or_id ?? null, orStatus: v.orStatus, origin: 'tablet' }),
    meta: { success: false },
    onSuccess: (r) => { setPauseOpen(false); toast.success(r.or_status_changed ? t('pointage.pausedStatus') : t('pointage.paused')); done(); },
    onError: onErr,
  });
  const finish = useMutation({
    mutationFn: () => stopWorkPointage({ entryId: open?.id ?? null, orId: open?.or_id ?? null, origin: 'tablet' }),
    meta: { success: false },
    onSuccess: () => { toast.success(t('pointage.finished')); done(); },
    onError: onErr,
  });
  const resume = useMutation({
    mutationFn: async () => { if (last?.or_id) await onResume(last.or_id); },
    meta: { success: false },
    onSuccess: done,
    onError: onErr,
  });
  const busy = pause.isPending || finish.isPending || resume.isPending;
  const num = (orId: string | null) => (orId ? orNumbers.get(orId) ?? '' : '');

  return (
    <div>
      <SharedIdentityBar large />
      {!id ? (
        <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-background p-4">
          <p className="min-w-0 flex-1 text-[17px] text-muted-foreground">{t('sharedTablet.panelHint')}</p>
          <Button className="h-16 min-w-[220px] text-[18px]" onClick={() => { void requestIdentity().catch(() => undefined); }}>
            <Users className="size-6" /> {t('sharedTablet.whoTitle')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3">
          <div className="min-w-0 flex-1">
            {cur.isLoading && <Loader2 className="size-6 animate-spin text-muted-foreground" />}
            {open && (
              <>
                <StatusBadge tone="info" icon={Play} className={BIG}
                  label={open.kind === 'improductif' ? t('myWorkshop.runningTask') : fillVars(t('myWorkshop.runningOr'), { number: num(open.or_id) })} />
                <p className="mt-2 text-[17px]">{fillVars(t('myWorkshop.since'), { at: hhmm(open.started_at) })}</p>
              </>
            )}
            {last && (
              <>
                <StatusBadge tone="warning" icon={Pause} className={BIG}
                  label={fillVars(t('pointage.pausedReason'), { reason: stopLabel(last.stop_kind, last.stop_reason, reasons, t) })} />
                <p className="mt-2 text-[17px]">{fillVars(t('myWorkshop.pausedOn'), { number: num(last.or_id), at: last.ended_at ? hhmm(last.ended_at) : '' })}</p>
              </>
            )}
            {!cur.isLoading && !open && !last && (
              <>
                <StatusBadge tone="neutral" icon={Timer} className={BIG} label={t('myWorkshop.idle')} />
                <p className="mt-2 text-[17px] text-muted-foreground">{t('myWorkshop.idleHint')}</p>
              </>
            )}
          </div>
          {canWrite && (
            <div className="flex w-full flex-wrap gap-3 sm:w-auto">
              {open?.kind === 'travail' && (
                <Button variant="outline" className="h-16 min-w-[160px] flex-1 text-[18px] sm:flex-none" disabled={busy} onClick={() => setPauseOpen(true)}>
                  <Pause className="size-6" /> {t('pointage.pause')}
                </Button>
              )}
              {last && (
                <Button className="h-16 min-w-[160px] flex-1 text-[18px] sm:flex-none" disabled={busy} onClick={() => resume.mutate()}>
                  {resume.isPending ? <Loader2 className="size-6 animate-spin" /> : <RotateCcw className="size-6" />} {t('pointage.resume')}
                </Button>
              )}
              {open && (
                <Button variant="outline" className="h-16 min-w-[160px] flex-1 text-[18px] sm:flex-none" disabled={busy} onClick={() => finish.mutate()}>
                  {finish.isPending ? <Loader2 className="size-6 animate-spin" /> : <Square className="size-6" />} {t('pointage.finish')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <PauseDialog open={pauseOpen} reasons={reasons} orStatus={null} busy={pause.isPending}
        onCancel={() => setPauseOpen(false)} onConfirm={(v) => pause.mutate(v)} />
    </div>
  );
}
