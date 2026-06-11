import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, LogIn, LogOut, Play, Square } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listRepairOrders } from '@/modules/workshop/api';
import { getOpenEntry, listTodayEntries, togglePresence, startWork, stopWork } from '@/modules/workshop/chrono-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/chrono')({
  head: () => ({ meta: [{ title: 'Chronos atelier — Ducati Bruxelles' }] }),
  component: ChronoPage,
});

function ChronoPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [orId, setOrId] = useState('');

  const presence = useQuery({ queryKey: ['chrono-presence', activeCompanyId], queryFn: () => getOpenEntry(activeCompanyId!, 'presence'), enabled: !!activeCompanyId });
  const work = useQuery({ queryKey: ['chrono-work', activeCompanyId], queryFn: () => getOpenEntry(activeCompanyId!, 'travail'), enabled: !!activeCompanyId });
  const today = useQuery({ queryKey: ['chrono-today', activeCompanyId], queryFn: () => listTodayEntries(activeCompanyId!), enabled: !!activeCompanyId });
  const ors = useQuery({ queryKey: ['repair-orders-open', activeCompanyId], queryFn: async () => [...(await listRepairOrders(activeCompanyId!, 'a_faire')), ...(await listRepairOrders(activeCompanyId!, 'en_cours'))], enabled: !!activeCompanyId });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['chrono-presence', activeCompanyId] }); qc.invalidateQueries({ queryKey: ['chrono-work', activeCompanyId] }); qc.invalidateQueries({ queryKey: ['chrono-today', activeCompanyId] }); };
  const pres = useMutation({ mutationFn: () => togglePresence(activeCompanyId!, name), onSuccess: refresh });
  const start = useMutation({ mutationFn: () => startWork(activeCompanyId!, orId, name), onSuccess: refresh });
  const stop = useMutation({ mutationFn: () => stopWork(activeCompanyId!), onSuccess: refresh });

  const orNumber = (id: string | null) => ors.data?.find((o) => o.id === id)?.number ?? id?.slice(0, 8) ?? '—';

  return (
    <>
      <PageHeader title={t('workshop.chronoTitle')} description={t('workshop.chronoSubtitle')} actions={<Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('workshop.mechanicName')}</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      </div>

      {/* Présence */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-4">
        {presence.data ? <StatusBadge tone="success" label={`${t('workshop.presentSince')} ${new Date(presence.data.started_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`} /> : <span className="text-sm text-muted-foreground">—</span>}
        <Button className="ml-auto" variant={presence.data ? 'outline' : 'default'} onClick={() => pres.mutate()} disabled={pres.isPending}>{pres.isPending ? <Loader2 className="animate-spin" /> : presence.data ? <LogOut /> : <LogIn />} {presence.data ? t('workshop.presenceOut') : t('workshop.presenceIn')}</Button>
      </div>

      {/* Travail */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4">
        {work.data ? (
          <>
            <StatusBadge tone="info" label={`${t('workshop.working')} : OR ${orNumber(work.data.or_id)}`} />
            <Button className="ml-auto" variant="destructive" onClick={() => stop.mutate()} disabled={stop.isPending}>{stop.isPending ? <Loader2 className="animate-spin" /> : <Square />} {t('workshop.stopWork')}</Button>
          </>
        ) : (
          <>
            <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('workshop.pickOr')}</label>
              <Select value={orId} onValueChange={setOrId}>
                <SelectTrigger className="w-72"><SelectValue placeholder={t('workshop.pickOr')} /></SelectTrigger>
                <SelectContent>{(ors.data ?? []).map((o) => <SelectItem key={o.id} value={o.id}>OR {o.number ?? o.id.slice(0, 8)}</SelectItem>)}{(ors.data ?? []).length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">{t('workshop.noOpenOr')}</div>}</SelectContent>
              </Select>
            </div>
            <Button onClick={() => start.mutate()} disabled={start.isPending || !orId}>{start.isPending ? <Loader2 className="animate-spin" /> : <Play />} {t('workshop.startWork')}</Button>
          </>
        )}
      </div>

      {/* Aujourd'hui */}
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('workshop.today')}</p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('workshop.mechanicName')}</Th><Th>{t('workshop.colKind')}</Th><Th>OR</Th><Th>Début</Th><Th>Fin</Th><Th className="text-right">{t('workshop.minutes')}</Th></tr></thead>
          <tbody>
            {today.data && today.data.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">—</td></tr>}
            {today.data?.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">{e.mechanic_name ?? '—'}</td>
                <td className="px-3 py-1.5">{t(`workshop.entryKind_${e.kind}`)}</td>
                <td className="px-3 py-1.5 font-mono text-[12px]">{e.or_id ? orNumber(e.or_id) : '—'}</td>
                <td className="px-3 py-1.5 font-mono text-[12px]">{new Date(e.started_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-3 py-1.5 font-mono text-[12px]">{e.ended_at ? new Date(e.ended_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : t('workshop.ongoing')}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{e.minutes != null ? e.minutes : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
