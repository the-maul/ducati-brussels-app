/**
 * M8 — Q57 (20/11/2026) : fenetre « Vous etes toujours la ? » de fin de journee.
 *
 * Montee une fois pour l'atelier (route `_app.workshop`), visible sur Mon atelier, la fiche OR, le
 * parcours guide et la pointeuse. Relit les questions dues toutes les minutes ; compte a rebours
 * jusqu'a la pause automatique (heure de fin + 5 min). A zero : l'ecran demande l'arret automatique
 * (le serveur le fait de toute facon, meme tablette eteinte), puis se met a jour.
 * Tablette partagee (Q60) : toutes les questions de l'atelier s'affichent, chacun repond apres
 * « Qui etes-vous ? ».
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { fillVars, getLocale, t } from '@/lib/i18n';
import { runAutoStop } from '../pointage/api';
import { useSharedTablet } from '../shared-tablet/shared-tablet-provider';
import { IdentityCancelled, withIdentity } from '../shared-tablet/store';
import { answerEndOfDay, listEndOfDayDue } from './api';
import { countdownLabel, dueForViewer, EOD_POLL_MS, isEndOfDayScreen, secondsUntil, type EndOfDayDue } from './rules';

const REFRESH_KEYS = [['my-workshop'], ['or-work-status'], ['plan-progress'], ['chrono-work'], ['chrono-today'], ['or-work-entries'], ['pointage']];
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(`${getLocale()}-BE`, { hour: '2-digit', minute: '2-digit' });

export function EndOfDayPrompt() {
  const { user, activeCompanyId } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onScreen = isEndOfDayScreen(pathname);
  const tablet = useSharedTablet();
  const qc = useQueryClient();
  const due = useQuery({
    queryKey: ['end-of-day-due', activeCompanyId],
    queryFn: () => listEndOfDayDue(activeCompanyId!),
    enabled: !!activeCompanyId && !!user && onScreen,
    refetchInterval: EOD_POLL_MS,
    refetchOnWindowFocus: true,
  });
  const rows = useMemo(
    () => dueForViewer(due.data ?? [], { shared: tablet.shared, userId: user?.id ?? null }),
    [due.data, tablet.shared, user?.id],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rows.length) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [rows.length]);
  const [busy, setBusy] = useState<string | null>(null);
  const [autoRan, setAutoRan] = useState<string | null>(null);

  const refresh = () => {
    void due.refetch();
    for (const k of REFRESH_KEYS) void qc.invalidateQueries({ queryKey: k });
  };

  // Delai ecoule : la pause automatique (meme regle que le serveur), une fois par echeance.
  const expired = rows.find((r) => secondsUntil(r.pause_at, now) === 0);
  useEffect(() => {
    if (!expired || !activeCompanyId || autoRan === expired.entry_id + expired.pause_at) return;
    setAutoRan(expired.entry_id + expired.pause_at);
    void runAutoStop(activeCompanyId).then((n) => {
      if (n > 0) toast.info(fillVars(t('endOfDay.autoPaused'), { name: expired.mechanic_name ?? '' }));
      refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired?.entry_id, expired?.pause_at, activeCompanyId]);

  const answer = async (r: EndOfDayDue, a: 'continue' | 'pause') => {
    setBusy(r.entry_id + a);
    try {
      const res = tablet.shared
        ? await withIdentity((id) => answerEndOfDay(r.entry_id, a, id.session))
        : await answerEndOfDay(r.entry_id, a);
      if (res.status === 'continue') toast.success(fillVars(t('endOfDay.continued'), { at: res.next_ask_at ? hhmm(res.next_ask_at) : '' }));
      else if (res.status === 'paused') toast.success(t('endOfDay.paused'));
      refresh();
    } catch (e) {
      if (!(e instanceof IdentityCancelled)) toast.error(e instanceof Error ? e.message : t('endOfDay.error'));
    } finally {
      setBusy(null);
    }
  };

  const open = onScreen && rows.some((r) => secondsUntil(r.pause_at, now) > 0) && !tablet.prompting;
  if (!open) return null;
  const visible = rows.filter((r) => secondsUntil(r.pause_at, now) > 0);

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent className="max-w-xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[26px]"><Clock className="size-7 text-warning" aria-hidden /> {t('endOfDay.title')}</DialogTitle>
          <DialogDescription className="text-[16px]">{t('endOfDay.hint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {visible.map((r) => {
            const left = secondsUntil(r.pause_at, now);
            const what = r.or_number ? fillVars(t('endOfDay.onOr'), { number: r.or_number }) : t('endOfDay.onTask');
            return (
              <div key={r.entry_id} className="rounded-md border border-warning bg-warning-bg p-4">
                <p className="text-[18px] font-bold">{tablet.shared && r.mechanic_name ? fillVars(t('endOfDay.whoIs'), { name: r.mechanic_name }) : what}</p>
                {tablet.shared && <p className="text-[16px]">{what}</p>}
                <p className="mt-1 text-[16px]">
                  {fillVars(t('endOfDay.since'), { at: hhmm(r.started_at) })} ·{' '}
                  <span className="font-data font-bold tabular-nums">{fillVars(t('endOfDay.countdown'), { time: countdownLabel(left), at: hhmm(r.pause_at) })}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button className="h-16 min-w-[200px] flex-1 text-[18px]" disabled={!!busy} onClick={() => void answer(r, 'continue')}>
                    {busy === r.entry_id + 'continue' ? <Loader2 className="size-6 animate-spin" /> : <Play className="size-6" />} {t('endOfDay.yesContinue')}
                  </Button>
                  <Button variant="outline" className="h-16 min-w-[200px] flex-1 text-[18px]" disabled={!!busy} onClick={() => void answer(r, 'pause')}>
                    {busy === r.entry_id + 'pause' ? <Loader2 className="size-6 animate-spin" /> : <Pause className="size-6" />} {t('endOfDay.pauseNow')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
