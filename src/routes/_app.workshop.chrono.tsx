import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, LogIn, LogOut, Pause, Pencil, Play, Square, ScanLine, Brush, Timer, BarChart3, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { listRepairOrders } from '@/modules/workshop/api';
// OR ouverts G8 (a faire, attente devis, pieces en commande, en cours) : on peut y pointer (18/11).
import { OR_WORKABLE_STATUSES } from '@/modules/workshop/or-base/rules';
import { getOpenEntry, listTodayEntries, togglePresence, startWork, startTask, stopWork, type MechanicRef } from '@/modules/workshop/chrono-api';
import { canStartWork } from '@/modules/workshop/checkup/rules';
import { labourTimeSchemaReady, listImproductiveTasks, listMechanics } from '@/modules/workshop/labour-time/api';
import { findMechanicByCode, findOrByScan, mechanicBoard } from '@/modules/workshop/labour-time/rules';
import { ProductivityPanel } from '@/modules/workshop/labour-time/productivity-panel';
import { useConfirm } from '@/components/confirm-provider';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { correctEntryEnd, listPauseReasons, pauseWork, pointageSchemaReady, runAutoStop, startWorkOnOr, stopWorkPointage } from '@/modules/workshop/pointage/api';
import { reasonLabel, stopKindKey } from '@/modules/workshop/pointage/rules';
import { PauseDialog } from '@/modules/workshop/pointage/work-controls';
import { fill } from '@/modules/catalog/format';
import { t, pageTitle } from '@/lib/i18n';

/**
 * M8 — Pointeuse atelier (B11) + productivité. Rattrapage G8 du 18/11/2026 : le mécanicien scanne
 * ou tape son **code mécano** (poste partagé), pointe arrivée / départ, démarre un OR (liste ou
 * scan du n° d'OR) ou une **tâche improductive** ; tableau « atelier maintenant » ; onglet
 * « Productivité atelier ». Sans code mécano (ou migration 20261118110000 absente) : pointage au
 * nom du compte connecté, comme avant.
 *
 * Lot A du parcours mecanicien (19/11/2026, migration 20261119241000) : le travail se pointe par
 * `workshop_work_start` (un seul pointage actif : un autre travail en cours est mis en pause apres
 * confirmation), « Arreter » devient Pause (motif) / Terminer, « Depart » met le travail en pause ;
 * les pointages arretes automatiquement en fin de journee sont signales et corrigeables.
 */
export const Route = createFileRoute('/_app/workshop/chrono')({
  head: () => ({ meta: [{ title: pageTitle('workshopChrono') }] }),
  component: ChronoPage,
});

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

function ChronoPage() {
  const { activeCompanyId, profile, hasRole } = useAuth();
  const confirm = useConfirm();
  // Lot A (19/11) : pointage unique Demarrer / Pause / Reprendre / Terminer.
  const ptSchema = useQuery({ queryKey: ['pointage-schema'], queryFn: pointageSchemaReady, staleTime: Infinity });
  const ptOn = ptSchema.data === true;
  const reasonsQ = useQuery({ queryKey: ['pause-reasons', activeCompanyId], queryFn: () => listPauseReasons(activeCompanyId!), enabled: ptOn && !!activeCompanyId, staleTime: 300_000 });
  const reasons = reasonsQ.data ?? [];
  const [pauseOpen, setPauseOpen] = useState(false);
  const [correcting, setCorrecting] = useState<{ id: string; started: string; ended: string } | null>(null);
  const canCorrect = hasRole('admin') || hasRole('chef_atelier');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pointeuse' | 'productivite'>('pointeuse');
  const [name, setName] = useState('');
  const [scan, setScan] = useState('');
  const [mechanicCode, setMechanicCode] = useState<string | null>(null);
  const [orId, setOrId] = useState('');
  const [orScan, setOrScan] = useState('');
  const [taskCode, setTaskCode] = useState('');

  const schema = useQuery({ queryKey: ['labour-time-schema'], queryFn: labourTimeSchemaReady, staleTime: Infinity });
  const codesOn = schema.data === true;
  const mechanicsQ = useQuery({ queryKey: ['workshop-mechanics', activeCompanyId], queryFn: () => listMechanics(activeCompanyId!), enabled: !!activeCompanyId && codesOn, staleTime: 300_000 });
  const tasksQ = useQuery({ queryKey: ['workshop-tasks', activeCompanyId], queryFn: () => listImproductiveTasks(activeCompanyId!), enabled: !!activeCompanyId && codesOn, staleTime: 300_000 });
  const mechanics = useMemo(() => mechanicsQ.data ?? [], [mechanicsQ.data]);
  const tasks = tasksQ.data ?? [];
  const mechanic = mechanicCode ? mechanics.find((m) => m.code === mechanicCode) ?? null : null;
  // Qui pointe : le mécanicien du code scanné, sinon le compte connecté (nom saisi ou profil).
  const who: MechanicRef = mechanic ? { code: mechanic.code, name: mechanic.name } : { code: null, name: name || profile?.full_name || '' };
  const whoKey = mechanic?.code ?? 'me';

  const presence = useQuery({ queryKey: ['chrono-presence', activeCompanyId, whoKey], queryFn: () => getOpenEntry(activeCompanyId!, 'presence', who), enabled: !!activeCompanyId });
  const work = useQuery({ queryKey: ['chrono-work', activeCompanyId, whoKey], queryFn: () => getOpenEntry(activeCompanyId!, ['travail', 'improductif'], who), enabled: !!activeCompanyId });
  const today = useQuery({ queryKey: ['chrono-today', activeCompanyId], queryFn: () => listTodayEntries(activeCompanyId!), enabled: !!activeCompanyId });
  const ors = useQuery({ queryKey: ['repair-orders-open', activeCompanyId], queryFn: async () => (await Promise.all(OR_WORKABLE_STATUSES.map((s) => listRepairOrders(activeCompanyId!, s)))).flat(), enabled: !!activeCompanyId });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['chrono-presence', activeCompanyId] });
    qc.invalidateQueries({ queryKey: ['chrono-work', activeCompanyId] });
    qc.invalidateQueries({ queryKey: ['chrono-today', activeCompanyId] });
    qc.invalidateQueries({ queryKey: ['or-work'] });
    qc.invalidateQueries({ queryKey: ['or-work-status'] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : t('workshop.errSave'));
  // Arret automatique : rattrapage a l'ouverture (le planificateur passe toutes les 15 min).
  useEffect(() => {
    if (!ptOn || !activeCompanyId) return;
    void runAutoStop(activeCompanyId).then((n) => { if (n > 0) refresh(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptOn, activeCompanyId]);
  const ptWho = { code: mechanic?.code ?? null, name: who.name || null };
  const pres = useMutation({
    mutationFn: async () => {
      // « Depart » (fin de session) : le travail en cours est mis en PAUSE (fin de journee), puis la presence se clot.
      if (ptOn && presence.data) await stopWorkPointage({ who: ptWho, kind: 'departure', origin: 'chrono', companyId: activeCompanyId });
      await togglePresence(activeCompanyId!, who);
    },
    onSuccess: refresh, onError: onErr,
  });
  const start = useMutation({
    mutationFn: async (id: string) => {
      if (!ptOn) { await startWork(activeCompanyId!, id, who); return; }
      let res = await startWorkOnOr(id, { who: ptWho, origin: 'chrono' });
      if (res.status === 'needs_confirm') {
        const c = res.current;
        const what = c.kind === 'improductif' ? t('pointage.currentTask') : fill(t('pointage.currentOr'), { number: c.or_number ?? '' });
        const ok = await confirm({ title: t('pointage.switchTitle'), message: fill(t('pointage.switchConfirm'), { current: what, since: hhmm(c.started_at) }), confirmLabel: t('pointage.switchOk') });
        if (!ok) return;
        res = await startWorkOnOr(id, { who: ptWho, origin: 'chrono', confirmSwitch: true });
      }
      if (res.status === 'resumed') toast.success(t('pointage.resumed'));
    },
    onSuccess: () => { setOrScan(''); refresh(); }, onError: onErr,
  });
  const task = useMutation({ mutationFn: () => startTask(activeCompanyId!, taskCode, who), onSuccess: refresh, onError: onErr });
  const stop = useMutation({
    mutationFn: () => (ptOn ? stopWorkPointage({ who: ptWho, origin: 'chrono', companyId: activeCompanyId }).then(() => undefined) : stopWork(activeCompanyId!, who)),
    onSuccess: refresh, onError: onErr,
  });
  const pause = useMutation({
    mutationFn: (v: { reason: string; orStatus: string | null }) => pauseWork({ reason: v.reason, orStatus: v.orStatus, who: ptWho, origin: 'chrono', companyId: activeCompanyId }),
    onSuccess: () => { setPauseOpen(false); refresh(); }, onError: onErr,
  });
  const correct = useMutation({
    mutationFn: (c: { id: string; ended: string }) => correctEntryEnd(c.id, new Date(c.ended).toISOString()),
    onSuccess: () => { setCorrecting(null); refresh(); }, onError: onErr,
  });

  const orNumber = (id: string | null) => ors.data?.find((o) => o.id === id)?.number ?? id?.slice(0, 8) ?? '—';
  const taskLabel = (code: string | null | undefined) => tasks.find((x) => x.code === code)?.label ?? code ?? '—';
  const board = useMemo(() => mechanicBoard(today.data ?? [], mechanics), [today.data, mechanics]);

  const onScanMechanic = () => {
    const m = findMechanicByCode(mechanics, scan);
    if (!m) { toast.error(t('labourTime.unknownCode').replace('{code}', scan.trim())); return; }
    setMechanicCode(m.code); setScan('');
  };
  const onScanOr = () => {
    const open = (ors.data ?? []).filter((o) => canStartWork(o as { customer_approval?: string | null }));
    const found = findOrByScan(open, orScan);
    if (!found) { toast.error(t('labourTime.unknownOr').replace('{number}', orScan.trim())); return; }
    start.mutate(found.id);
  };

  const current = work.data;
  const currentLabel = current
    ? current.kind === 'improductif' ? `${t('labourTime.improductive')} : ${taskLabel(current.task_code)}` : `${t('workshop.working')} : OR ${orNumber(current.or_id)}`
    : null;

  return (
    <>
      <PageHeader title={t('workshop.chronoTitle')} description={t('workshop.chronoSubtitle')} actions={<Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pointeuse' | 'productivite')}>
        <TabsList className="mb-4 h-11">
          <TabsTrigger value="pointeuse" className="h-9 px-4 text-[14px]"><Timer className="mr-1.5 size-4" /> {t('labourTime.tabClock')}</TabsTrigger>
          <TabsTrigger value="productivite" className="h-9 px-4 text-[14px]"><BarChart3 className="mr-1.5 size-4" /> {t('labourTime.tabProductivity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="pointeuse">
          {/* Qui pointe : code mécano (scan / saisie) ou compte connecté */}
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4">
            {codesOn && mechanics.length > 0 ? (
              mechanic ? (
                <>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('labourTime.mechanic')}</p>
                    <p className="text-lg font-bold">{mechanic.name} <span className="font-data text-[13px] text-muted-foreground">({mechanic.code})</span></p>
                  </div>
                  <Button variant="outline" className="ml-auto" onClick={() => setMechanicCode(null)}><X /> {t('labourTime.changeMechanic')}</Button>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('labourTime.scanMechanic')}</label>
                    <div className="flex gap-2">
                      <Input autoFocus value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onScanMechanic(); }} className="w-44 font-data" placeholder={t('labourTime.scanPlaceholder')} />
                      <Button variant="outline" onClick={onScanMechanic} disabled={!scan.trim()}><ScanLine /> {t('labourTime.identify')}</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('labourTime.orPickMechanic')}</label>
                    <Select value="" onValueChange={(v) => setMechanicCode(v)}>
                      <SelectTrigger className="w-56"><SelectValue placeholder={t('labourTime.pickMechanic')} /></SelectTrigger>
                      <SelectContent>{mechanics.map((m) => <SelectItem key={m.code} value={m.code}>{m.code} · {m.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </>
              )
            ) : (
              <>
                <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('workshop.mechanicName')}</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <p className="text-[12px] text-muted-foreground">{codesOn ? t('labourTime.noMechanicCodes') : t('labourTime.migrationMissing')}</p>
              </>
            )}
          </div>

          {/* Présence */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-4">
            {presence.data ? <StatusBadge tone="success" label={`${t('workshop.presentSince')} ${hhmm(presence.data.started_at)}`} /> : <StatusBadge tone="neutral" label={t('labourTime.absent')} />}
            <Button className="ml-auto" variant={presence.data ? 'outline' : 'default'} onClick={() => pres.mutate()} disabled={pres.isPending}>{pres.isPending ? <Loader2 className="animate-spin" /> : presence.data ? <LogOut /> : <LogIn />} {presence.data ? t('workshop.presenceOut') : t('workshop.presenceIn')}</Button>
          </div>

          {/* Travail en cours / démarrer un OR / une tâche improductive */}
          <div className="mb-4 space-y-3 rounded-md border border-border bg-card p-4">
            {current ? (
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge tone={current.kind === 'improductif' ? 'warning' : 'info'} icon={current.kind === 'improductif' ? Brush : Play} label={`${currentLabel} · ${hhmm(current.started_at)}`} />
                {ptOn ? (
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button variant="outline" className="h-12 min-w-[132px] text-[15px]" onClick={() => setPauseOpen(true)} disabled={pause.isPending}><Pause /> {t('pointage.pause')}</Button>
                    <Button variant="outline" className="h-12 min-w-[132px] text-[15px]" onClick={() => stop.mutate()} disabled={stop.isPending}>{stop.isPending ? <Loader2 className="animate-spin" /> : <Square />} {t('pointage.finish')}</Button>
                  </div>
                ) : (
                  <Button className="ml-auto" variant="destructive" onClick={() => stop.mutate()} disabled={stop.isPending}>{stop.isPending ? <Loader2 className="animate-spin" /> : <Square />} {t('workshop.stopWork')}</Button>
                )}
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('workshop.pickOr')}</label>
                <Select value={orId} onValueChange={setOrId}>
                  <SelectTrigger className="w-72"><SelectValue placeholder={t('workshop.pickOr')} /></SelectTrigger>
                  <SelectContent>{(ors.data ?? []).map((o) => {
                    // Garde-fou (ATE009) : accord client en attente → l'OR n'est pas « à faire » pour l'atelier.
                    const blocked = !canStartWork(o as { customer_approval?: string | null });
                    return <SelectItem key={o.id} value={o.id} disabled={blocked}>OR {o.number ?? o.id.slice(0, 8)}{blocked ? ` · ${t('checkup.approval_en_attente')}` : ''}</SelectItem>;
                  })}{(ors.data ?? []).length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">{t('workshop.noOpenOr')}</div>}</SelectContent>
                </Select>
              </div>
              <Button className={ptOn ? 'h-12 text-[15px]' : undefined} onClick={() => start.mutate(orId)} disabled={start.isPending || !orId}>{start.isPending ? <Loader2 className="animate-spin" /> : <Play />} {t('workshop.startWork')}</Button>
              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('labourTime.scanOr')}</label>
                <Input value={orScan} onChange={(e) => setOrScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && orScan.trim()) onScanOr(); }} className="w-44 font-data" placeholder={t('labourTime.scanOrPlaceholder')} />
              </div>
            </div>
            {codesOn && tasks.length > 0 && (
              <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
                <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('labourTime.improductiveTask')}</label>
                  <Select value={taskCode} onValueChange={setTaskCode}>
                    <SelectTrigger className="w-72"><SelectValue placeholder={t('labourTime.pickTask')} /></SelectTrigger>
                    <SelectContent>{tasks.map((x) => <SelectItem key={x.code} value={x.code}>{x.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button variant="outline" onClick={() => task.mutate()} disabled={task.isPending || !taskCode}>{task.isPending ? <Loader2 className="animate-spin" /> : <Brush />} {t('labourTime.startTask')}</Button>
              </div>
            )}
          </div>

          {/* Atelier maintenant (G8 : statut, heure d'arrivée, travail en cours) */}
          {codesOn && board.length > 0 && (
            <>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('labourTime.boardTitle')}</p>
              <div className="mb-4 overflow-hidden rounded-md border border-border">
                <table className="w-full border-collapse font-data text-[13px]">
                  <thead className="bg-muted"><tr><Th>{t('labourTime.code')}</Th><Th>{t('labourTime.mechanic')}</Th><Th>{t('labourTime.status')}</Th><Th>{t('labourTime.arrival')}</Th><Th>{t('labourTime.currentWork')}</Th><Th>{t('labourTime.since')}</Th></tr></thead>
                  <tbody>
                    {board.map((m) => (
                      <tr key={m.key} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5">{m.code ?? '—'}</td>
                        <td className="px-3 py-1.5">{m.name}</td>
                        <td className="px-3 py-1.5">{m.presentSince ? <StatusBadge tone="success" label={t('labourTime.present')} /> : <StatusBadge tone="neutral" label={t('labourTime.absent')} />}</td>
                        <td className="px-3 py-1.5 tabular-nums">{m.presentSince ? hhmm(m.presentSince) : '—'}</td>
                        <td className="px-3 py-1.5">{m.current ? (m.current.kind === 'improductif' ? `${t('labourTime.improductive')} : ${taskLabel(m.current.taskCode)}` : `OR ${orNumber(m.current.orId)}`) : '—'}</td>
                        <td className="px-3 py-1.5 tabular-nums">{m.current ? hhmm(m.current.since) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Aujourd'hui */}
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('workshop.today')}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('workshop.mechanicName')}</Th><Th>{t('workshop.colKind')}</Th><Th>{t('labourTime.colWork')}</Th><Th>{t('labourTime.start')}</Th><Th>{t('labourTime.end')}</Th><Th className="text-right">{t('workshop.minutes')}</Th>{ptOn && <Th>{t('pointage.colStop')}</Th>}</tr></thead>
              <tbody>
                {today.data && today.data.length === 0 && <tr><td colSpan={ptOn ? 7 : 6} className="px-3 py-4 text-center text-muted-foreground">—</td></tr>}
                {today.data?.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{e.mechanic_name ?? e.mechanic_code ?? '—'}</td>
                    <td className="px-3 py-1.5">{t(`labourTime.entryKind_${e.kind}`)}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{e.or_id ? `OR ${orNumber(e.or_id)}` : e.task_code ? taskLabel(e.task_code) : '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{hhmm(e.started_at)}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{e.ended_at ? hhmm(e.ended_at) : t('workshop.ongoing')}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{e.minutes != null ? e.minutes : ''}</td>
                    {ptOn && <td className="px-3 py-1.5"><StopCell e={e as StopLike} reasons={reasons} canCorrect={canCorrect} onCorrect={() => setCorrecting({ id: e.id, started: e.started_at, ended: e.ended_at ?? '' })} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {ptOn && (
          <PauseDialog open={pauseOpen} reasons={reasons} orStatus={null} busy={pause.isPending}
            onCancel={() => setPauseOpen(false)} onConfirm={(v) => pause.mutate(v)} />
        )}
        {correcting && (
          <CorrectDialog entry={correcting} busy={correct.isPending} onCancel={() => setCorrecting(null)}
            onConfirm={(ended) => correct.mutate({ id: correcting.id, ended })} />
        )}

        <TabsContent value="productivite">
          {activeCompanyId && <ProductivityPanel companyId={activeCompanyId} />}
        </TabsContent>
      </Tabs>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}

type StopLike = { ended_at: string | null; stop_kind?: string | null; stop_reason?: string | null; corrected_at?: string | null };

/** Fin du pointage (lot A) : pause et motif, termine, arret automatique a corriger. */
function StopCell({ e, reasons, canCorrect, onCorrect }: { e: StopLike; reasons: { code: string; label: string; orStatus: string | null }[]; canCorrect: boolean; onCorrect: () => void }) {
  if (!e.ended_at) return <StatusBadge tone="info" icon={Play} label={t('pointage.stateRunning')} />;
  const key = stopKindKey(e.stop_kind);
  if (!key) return <span className="text-muted-foreground">—</span>;
  const auto = e.stop_kind === 'auto_stop';
  const why = e.stop_kind === 'pause' || e.stop_kind === 'switch' ? reasonLabel(e.stop_reason, reasons, t) : '';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge
        tone={auto ? 'warning' : e.stop_kind === 'stop' ? 'success' : 'neutral'}
        icon={auto ? Timer : e.stop_kind === 'stop' ? Square : Pause}
        label={why ? `${t(key)} : ${why}` : t(key)}
      />
      {e.corrected_at && <span className="text-[11px] text-muted-foreground">{t('pointage.corrected')}</span>}
      {canCorrect && (
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCorrect}><Pencil className="size-3.5" /> {t('pointage.correct')}</Button>
      )}
    </span>
  );
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Correction de l'heure de fin par l'atelier (admin, chef d'atelier) : tracee dans events. */
function CorrectDialog({ entry, busy, onCancel, onConfirm }: { entry: { started: string; ended: string }; busy: boolean; onCancel: () => void; onConfirm: (endedLocal: string) => void }) {
  const [value, setValue] = useState(entry.ended ? toLocalInput(entry.ended) : '');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pointage.correctTitle')}</DialogTitle>
          <DialogDescription>{fill(t('pointage.correctHint'), { start: new Date(entry.started).toLocaleString('fr-BE') })}</DialogDescription>
        </DialogHeader>
        <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} className="h-12 font-data text-[15px]" />
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onCancel}>{t('action.cancel')}</Button>
          <Button className="h-11" disabled={!value || busy} onClick={() => onConfirm(value)}>{busy ? <Loader2 className="animate-spin" /> : <Pencil />} {t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
