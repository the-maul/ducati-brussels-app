/** Settings > DCS extension: control block of the nightly fleet certification (VEH001). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, MoonStar, Pause, Play, ShieldCheck, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { fillVars, t } from '@/lib/i18n';
import {
  dcsNightApprovePilot, dcsNightPause, dcsNightResume, dcsNightStart, dcsNightStatus, sendDcsNightCommand,
} from './dcs-night-api';
import { dcsNightDisplay, estimateNights, type DcsNightDisplay } from './dcs-night-rules';

const DISPLAY: Record<DcsNightDisplay, { tone: StatusTone; icon: LucideIcon; label: () => string }> = {
  not_started: { tone: 'neutral', icon: MoonStar, label: () => t('dossier.dcsNightStateNotStarted') },
  waiting: { tone: 'info', icon: Clock, label: () => t('dossier.dcsNightStateWaiting') },
  running: { tone: 'info', icon: Loader2, label: () => t('dossier.dcsNightStateRunning') },
  paused: { tone: 'warning', icon: Pause, label: () => t('dossier.dcsNightStatePaused') },
  pilot_wait: { tone: 'warning', icon: ShieldCheck, label: () => t('dossier.dcsNightStatePilot') },
  finished: { tone: 'success', icon: CheckCircle2, label: () => t('dossier.dcsNightStateFinished') },
};

function pauseReason(code: string | null | undefined): string | null {
  if (code === 'manual') return t('dossier.dcsNightReasonManual');
  if (code === 'failures') return t('dossier.dcsNightReasonFailures');
  if (code === 'session_expired') return t('dossier.dcsNightReasonSession');
  if (code === 'company_mismatch') return t('dossier.dcsNightReasonCompany');
  return null;
}

function Counter({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="font-data text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function DcsNightPanel() {
  const { activeCompanyId, isAdmin } = useAuth();
  const qc = useQueryClient();
  const company = activeCompanyId;
  const admin = isAdmin();

  const status = useQuery({
    queryKey: ['dcs-night', 'status', company],
    queryFn: () => dcsNightStatus(company as string),
    enabled: !!company && admin,
    refetchInterval: 15000,
    retry: false,
  });
  const extension = useQuery({
    queryKey: ['dcs-night', 'extension', company],
    queryFn: () => sendDcsNightCommand('ping', company as string),
    enabled: !!company && admin,
    refetchInterval: 15000,
    retry: false,
  });

  const action = useMutation({
    mutationFn: async (kind: 'start' | 'pause' | 'resume' | 'pilot') => {
      const id = company as string;
      if (kind === 'pause') {
        await dcsNightPause(id);
        await sendDcsNightCommand('abort', id);
        return;
      }
      if (kind === 'start') await dcsNightStart(id);
      if (kind === 'resume') await dcsNightResume(id);
      if (kind === 'pilot') await dcsNightApprovePilot(id);
      await sendDcsNightCommand('arm', id);
    },
    onError: () => toast.error(t('dossier.dcsNightActionError')),
    onSettled: () => qc.invalidateQueries({ queryKey: ['dcs-night'] }),
  });

  if (!company || !admin) return null;

  const shell = 'rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] lg:col-span-3';
  const heading = (
    <div className="flex items-center gap-2">
      <MoonStar className="size-5 text-primary" aria-hidden />
      <h2 className="font-ui text-[15px] font-bold">{t('dossier.dcsNightTitle')}</h2>
    </div>
  );

  if (status.isError) {
    return <div className={shell}>{heading}<p className="mt-2 text-sm text-muted-foreground">{t('dossier.dcsNightUnavailable')}</p></div>;
  }
  if (!status.data) return null;
  if (!status.data.eligible) {
    return <div className={shell}>{heading}<p className="mt-2 text-sm text-muted-foreground">{t('dossier.dcsNightNotEligible')}</p></div>;
  }

  const s = status.data;
  const display = dcsNightDisplay(s);
  const badge = DISPLAY[display];
  const counts = s.counts ?? { total: 0, done: 0, failed: 0, remaining: 0, touched: 0 };
  const nights = estimateNights(counts.remaining);
  const reason = display === 'paused' ? pauseReason(s.run?.pause_reason) : null;
  const hasExtension = !!extension.data?.installed;
  const busy = action.isPending;
  const canStart = display === 'not_started' || (display === 'finished' && counts.remaining === 0);

  return (
    <div className={shell}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading}
        <StatusBadge tone={badge.tone} icon={badge.icon} label={badge.label()} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('dossier.dcsNightDesc')}</p>

      {reason && <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{reason}</p>}
      {display === 'pilot_wait' && (
        <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('dossier.dcsNightPilotHint')}</p>
      )}
      {!hasExtension && !extension.isLoading && (
        <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('dossier.dcsNightNoExtension')}</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Counter label={t('dossier.dcsNightDone')} value={counts.done} />
        <Counter label={t('dossier.dcsNightRemaining')} value={counts.remaining} />
        <Counter label={t('dossier.dcsNightErrors')} value={counts.failed} />
        <Counter label={t('dossier.dcsNightNightsLabel')} value={nights} />
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {t('dossier.dcsNightLastBike')} <span className="font-data tabular-nums">{s.last?.vin ?? t('dossier.dcsNightLastNone')}</span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {canStart && (
          <Button disabled={busy || !hasExtension} onClick={() => action.mutate('start')}><Play className="size-4" /> {t('dossier.dcsNightStart')}</Button>
        )}
        {(display === 'running' || display === 'waiting') && (
          <Button variant="outline" disabled={busy} onClick={() => action.mutate('pause')}><Pause className="size-4" /> {t('dossier.dcsNightPause')}</Button>
        )}
        {display === 'paused' && (
          <Button disabled={busy || !hasExtension} onClick={() => action.mutate('resume')}><Play className="size-4" /> {t('dossier.dcsNightResume')}</Button>
        )}
        {display === 'pilot_wait' && (
          <Button disabled={busy || !hasExtension} onClick={() => action.mutate('pilot')}><ShieldCheck className="size-4" /> {t('dossier.dcsNightContinuePilot')}</Button>
        )}
      </div>

      <p className="mt-4 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{fillVars(t('dossier.dcsNightReminder'), { n: s.run?.pilot_limit ?? 10 })}</p>
    </div>
  );
}
