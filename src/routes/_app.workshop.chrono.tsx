import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, LogIn, LogOut, Play, Square, ScanLine, Brush, Timer, BarChart3, X } from 'lucide-react';
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
import { t, pageTitle } from '@/lib/i18n';

/**
 * M8 — Pointeuse atelier (B11) + productivité. Rattrapage G8 du 18/11/2026 : le mécanicien scanne
 * ou tape son **code mécano** (poste partagé), pointe arrivée / départ, démarre un OR (liste ou
 * scan du n° d'OR) ou une **tâche improductive** ; tableau « atelier maintenant » ; onglet
 * « Productivité atelier ». Sans code mécano (ou migration 20261118110000 absente) : pointage au
 * nom du compte connecté, comme avant.
 */
export const Route = createFileRoute('/_app/workshop/chrono')({
  head: () => ({ meta: [{ title: pageTitle('workshopChrono') }] }),
  component: ChronoPage,
});

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

function ChronoPage() {
  const { activeCompanyId, profile } = useAuth();
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
  };
  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : t('workshop.errSave'));
  const pres = useMutation({ mutationFn: () => togglePresence(activeCompanyId!, who), onSuccess: refresh, onError: onErr });
  const start = useMutation({ mutationFn: (id: string) => startWork(activeCompanyId!, id, who), onSuccess: () => { setOrScan(''); refresh(); }, onError: onErr });
  const task = useMutation({ mutationFn: () => startTask(activeCompanyId!, taskCode, who), onSuccess: refresh, onError: onErr });
  const stop = useMutation({ mutationFn: () => stopWork(activeCompanyId!, who), onSuccess: refresh, onError: onErr });

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
                <StatusBadge tone={current.kind === 'improductif' ? 'warning' : 'info'} label={`${currentLabel} · ${hhmm(current.started_at)}`} />
                <Button className="ml-auto" variant="destructive" onClick={() => stop.mutate()} disabled={stop.isPending}>{stop.isPending ? <Loader2 className="animate-spin" /> : <Square />} {t('workshop.stopWork')}</Button>
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
              <Button onClick={() => start.mutate(orId)} disabled={start.isPending || !orId}>{start.isPending ? <Loader2 className="animate-spin" /> : <Play />} {t('workshop.startWork')}</Button>
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
              <thead className="bg-muted"><tr><Th>{t('workshop.mechanicName')}</Th><Th>{t('workshop.colKind')}</Th><Th>{t('labourTime.colWork')}</Th><Th>{t('labourTime.start')}</Th><Th>{t('labourTime.end')}</Th><Th className="text-right">{t('workshop.minutes')}</Th></tr></thead>
              <tbody>
                {today.data && today.data.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">—</td></tr>}
                {today.data?.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{e.mechanic_name ?? e.mechanic_code ?? '—'}</td>
                    <td className="px-3 py-1.5">{t(`labourTime.entryKind_${e.kind}`)}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{e.or_id ? `OR ${orNumber(e.or_id)}` : e.task_code ? taskLabel(e.task_code) : '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{hhmm(e.started_at)}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{e.ended_at ? hhmm(e.ended_at) : t('workshop.ongoing')}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{e.minutes != null ? e.minutes : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

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
