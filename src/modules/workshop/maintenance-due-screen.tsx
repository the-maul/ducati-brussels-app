/**
 * M8 — Écran « Entretiens à venir » (Atelier, mission 07 cartes 4 et 7).
 *
 * Quatre listes et un onglet de relances :
 *  - En retard      : échéance dépassée ET dernier entretien connu → un vrai retard ;
 *  - Bientôt        : échéance dans l'horizon choisi ;
 *  - À confirmer    : échéance estimée faute d'historique → le client à appeler ;
 *  - Sans kilométrage : programme connu, compteur inconnu → rien n'est calculable ;
 *  - Relances       : la cloche par rôle et le message PRÉPARÉ. **Aucun envoi.**
 *
 * Le tri, le filtre et la pagination sont faits en base (`maintenance_due_list`),
 * jamais dans l'écran : la liste reste sous le délai de 8 s de PostgREST.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BellRing, CalendarClock, CalendarPlus, Copy, Euro, Gauge, HelpCircle,
  Loader2, Mail, Search, Send, Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { KpiCard } from '@/components/kpi-card';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { fill, fmtDateTime, fmtInt, fmtMoney } from '@/modules/catalog/format';
import { fmtKm } from './maintenance-due';
import {
  getDueStats, getReminderMessage, listDue, refreshReminders,
  type DueRow, type DueScope, type ReminderMessage,
} from './maintenance-due-api';
import { RdvDialog } from './maintenance-due-panel';
import {
  ConfidenceBadge, DueBadge, DueDetail, MileageLabel, OfficialTime, SourceLabel, dueLabel,
} from './maintenance-due-view';

const HORIZONS = [30, 60, 90, 180, 365] as const;
const HORIZON_KEY: Record<number, string> = {
  30: 'maintenanceDue.days30', 60: 'maintenanceDue.days60', 90: 'maintenanceDue.days90',
  180: 'maintenanceDue.days180', 365: 'maintenanceDue.days365',
};

export function MaintenanceDueScreen() {
  const { activeCompanyId } = useAuth();
  const [days, setDays] = useState<number>(60);
  const stats = useQuery({
    queryKey: ['due', 'stats', activeCompanyId, days],
    queryFn: () => getDueStats(activeCompanyId!, days),
    enabled: !!activeCompanyId,
  });

  const s = stats.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label={t('maintenanceDue.kpiComputable')} value={fmtInt(s?.computable)} icon={Wrench}
          delta={s ? fill(t('maintenanceDue.kpiComputableDetail'), { withKm: fmtInt(s.exact + s.estimated - s.missingKm) }) : undefined} />
        <KpiCard label={t('maintenanceDue.kpiLate')} value={fmtInt(s?.late)} icon={AlertTriangle}
          delta={t('maintenanceDue.kpiLateDetail')} deltaTone="danger" />
        <KpiCard label={fill(t('maintenanceDue.kpiSoon'), { days: String(days) })} value={fmtInt(s?.soon)} icon={CalendarClock}
          delta={s ? fill(t('maintenanceDue.kpiSoonDetail'), { estimated: fmtInt(s.estimated) }) : undefined} />
        <KpiCard label={t('maintenanceDue.kpiMissingKm')} value={fmtInt(s?.missingKm)} icon={Gauge}
          delta={t('maintenanceDue.kpiMissingKmDetail')} deltaTone="danger" />
        <KpiCard label={t('maintenanceDue.kpiRate')}
          value={s?.hourlyRateHt == null ? t('maintenanceDue.rateMissing') : fmtMoney(s.hourlyRateHt)} icon={Euro}
          delta={s?.hourlyRateHt == null ? t('maintenanceDue.rateHint') : undefined} deltaTone="danger" />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40 space-y-1">
          <Label>{t('maintenanceDue.daysLabel')}</Label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {HORIZONS.map((h) => <SelectItem key={h} value={String(h)}>{t(HORIZON_KEY[h])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="estime">
        <TabsList>
          <TabsTrigger value="retard">{t('maintenanceDue.tabLate')}</TabsTrigger>
          <TabsTrigger value="bientot">{t('maintenanceDue.tabSoon')}</TabsTrigger>
          <TabsTrigger value="estime">{t('maintenanceDue.tabEstimated')}</TabsTrigger>
          <TabsTrigger value="sans_km">{t('maintenanceDue.tabMissingKm')}</TabsTrigger>
          <TabsTrigger value="relances">{t('maintenanceDue.tabReminders')}</TabsTrigger>
        </TabsList>
        <TabsContent value="retard" className="mt-3"><DueTable scope="retard" days={days} /></TabsContent>
        <TabsContent value="bientot" className="mt-3"><DueTable scope="bientot" days={days} /></TabsContent>
        <TabsContent value="estime" className="mt-3"><DueTable scope="estime" days={days} /></TabsContent>
        <TabsContent value="sans_km" className="mt-3"><DueTable scope="sans_km" days={days} /></TabsContent>
        <TabsContent value="relances" className="mt-3"><RemindersPanel days={days} /></TabsContent>
      </Tabs>
    </div>
  );
}

const PAGE = 50;

function DueTable({ scope, days }: { scope: DueScope; days: number }) {
  const { activeCompanyId } = useAuth();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [rdv, setRdv] = useState<DueRow | null>(null);
  const [msg, setMsg] = useState<DueRow | null>(null);
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['due', 'list', activeCompanyId, scope, days, q, limit],
    queryFn: () => listDue(activeCompanyId!, scope, { days, q, limit, offset: 0 }),
    enabled: !!activeCompanyId,
  });

  if (list.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (list.error) return <p className="text-sm text-danger">{t('maintenanceDue.loadErr')}</p>;

  const d = list.data!;
  const rows = d.rows ?? [];
  const emptyKey = scope === 'retard' ? 'maintenanceDue.emptyLate'
    : scope === 'sans_km' ? 'maintenanceDue.emptyMissingKm' : 'maintenanceDue.empty';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder={t('maintenanceDue.searchPlaceholder')}
            value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        </div>
        <span className="text-[12px] text-muted-foreground">
          {fill(t('maintenanceDue.countLine'), { shown: fmtInt(rows.length), total: fmtInt(d.total) })}
        </span>
      </div>

      {!rows.length ? (
        <p className="text-sm text-muted-foreground">{t(emptyKey)}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('maintenanceDue.colVehicle')}</TableHead>
              <TableHead>{t('maintenanceDue.colOwner')}</TableHead>
              {scope !== 'sans_km' && <TableHead>{t('maintenanceDue.colService')}</TableHead>}
              {scope !== 'sans_km' && <TableHead>{t('maintenanceDue.colDue')}</TableHead>}
              {scope !== 'sans_km' && <TableHead>{t('maintenanceDue.colTime')}</TableHead>}
              <TableHead>{t('maintenanceDue.colState')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.vehicleId}-${r.serviceCode ?? 'km'}`}>
                <TableCell>
                  <Link to="/vehicles/$vehicleId" params={{ vehicleId: r.vehicleId }}
                    className="font-medium text-primary hover:underline">
                    {[r.brand, r.model, r.modelYear].filter(Boolean).join(' ') || r.vin || '—'}
                  </Link>
                  <div className="font-data text-[12px] text-muted-foreground">{r.vin ?? r.plate ?? r.reference ?? ''}</div>
                  <div className="text-[12px]"><MileageLabel km={r.mileage} /></div>
                </TableCell>
                <TableCell>
                  {r.owner ? (
                    <Link to="/clients/$contactId" params={{ contactId: r.owner.id }} className="text-primary hover:underline">
                      {r.owner.name ?? '—'}
                    </Link>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                {scope !== 'sans_km' && (
                  <TableCell>
                    <span className="font-medium">{r.serviceLabel}</span>
                    <div><SourceLabel source={r.source} /></div>
                  </TableCell>
                )}
                {scope !== 'sans_km' && (
                  <TableCell className="tabular-nums">
                    {dueLabel(r)}
                    <div><DueDetail due={r} /></div>
                    {r.appointmentAt && (
                      <div className="text-[12px] text-info">
                        {fill(t('maintenanceDue.rdvExisting'), { date: fmtDateTime(r.appointmentAt) })}
                      </div>
                    )}
                  </TableCell>
                )}
                {scope !== 'sans_km' && <TableCell><OfficialTime ut={r.ut} /></TableCell>}
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {scope === 'sans_km' ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-warning">
                        <Gauge className="size-3.5" aria-hidden /> {t('maintenanceDue.kpiMissingKm')}
                      </span>
                    ) : (
                      <>
                        <DueBadge due={r} />
                        <ConfidenceBadge confidence={r.confidence} />
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {scope !== 'sans_km' && (
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => setRdv(r)}>
                        <CalendarPlus /> {t('maintenanceDue.rdvBtn')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setMsg(r)} aria-label={t('maintenanceDue.remindersPrepare')}>
                        <Mail />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {rows.length < d.total && (
        <Button variant="outline" onClick={() => setLimit((n) => Math.min(n + PAGE, 200))}>
          {t('maintenanceDue.more')}
        </Button>
      )}

      {rdv && (
        <RdvDialog vehicleId={rdv.vehicleId}
          service={{ code: rdv.serviceCode, label: rdv.serviceLabel, ut: rdv.ut }}
          onClose={() => setRdv(null)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['due'] })} />
      )}
      {msg && <ReminderDialog row={msg} onClose={() => setMsg(null)} />}
    </div>
  );
}

/**
 * Carte 7 — relances. La cloche prévient le commercial et l'atelier ; le message
 * est préparé et **le bouton d'envoi est désactivé** : l'envoi réel d'e-mails ou
 * de SMS demande l'accord explicite du client.
 */
function RemindersPanel({ days }: { days: number }) {
  const { activeCompanyId, hasRole } = useAuth();
  const canRefresh = hasRole('admin') || hasRole('chef_atelier') || hasRole('vendeur');
  const qc = useQueryClient();

  const run = useMutation({
    mutationFn: () => refreshReminders(activeCompanyId!, days, 200),
    onSuccess: (r) => {
      toast.success(fill(t('maintenanceDue.remindersRefreshed'), {
        created: fmtInt(r.created), candidates: fmtInt(r.candidates),
      }));
      qc.invalidateQueries({ queryKey: ['due'] });
      qc.invalidateQueries({ queryKey: ['team-notifications'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenanceDue.saveErr')),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('maintenanceDue.remindersIntro')}</p>
        <Button disabled={!canRefresh || !activeCompanyId || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Loader2 className="animate-spin" /> : <BellRing />} {t('maintenanceDue.remindersRefresh')}
        </Button>
      </div>
      <p className="flex items-start gap-2 rounded-md border border-border bg-warning-bg p-3 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('maintenanceDue.remindersSendDisabled')}
      </p>
      <DueTable scope="tous" days={days} />
    </div>
  );
}

/** Le message de relance, préparé. Le bouton « Envoyer » est volontairement désactivé. */
function ReminderDialog({ row, onClose }: { row: DueRow; onClose: () => void }) {
  const msg = useQuery({
    queryKey: ['due', 'reminder', row.vehicleId, row.serviceCode],
    queryFn: () => getReminderMessage(row.vehicleId, row.serviceCode),
  });
  const m: ReminderMessage | undefined = msg.data;

  const copy = async () => {
    if (!m?.body) return;
    try {
      await navigator.clipboard.writeText(`${m.subject ?? ''}\n\n${m.body}`);
      toast.success(t('maintenanceDue.remindersCopied'));
    } catch { toast.error(t('maintenanceDue.saveErr')); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('maintenanceDue.remindersMessageTitle')}</DialogTitle>
          <DialogDescription>
            {[r0(row), row.serviceLabel].filter(Boolean).join(' — ')}
          </DialogDescription>
        </DialogHeader>
        {msg.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" />
          : !m?.found ? <p className="text-sm text-muted-foreground">{m?.reason ?? t('maintenanceDue.loadErr')}</p>
          : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rem-subj">{t('maintenanceDue.remindersSubject')}</Label>
                <Input id="rem-subj" readOnly value={m.subject ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rem-body">{t('maintenanceDue.remindersBody')}</Label>
                <Textarea id="rem-body" readOnly rows={12} value={m.body ?? ''} className="font-mono text-[13px]" />
              </div>
              {m.confidence === 'estime' && (
                <p className="flex items-start gap-2 text-[12px] text-muted-foreground">
                  <HelpCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('maintenanceDue.confEstimeHint')}
                </p>
              )}
              <p className="flex items-start gap-2 rounded-md border border-border bg-warning-bg p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {m.sendingBlockedReason ?? t('maintenanceDue.remindersSendDisabled')}
              </p>
            </div>
          )}
        <DialogFooter>
          <Button variant="outline" onClick={copy} disabled={!m?.body}>
            <Copy /> {t('maintenanceDue.remindersCopy')}
          </Button>
          {/* Carte 7 : l'envoi réel est interdit sans accord explicite du client. */}
          <Button disabled title={t('maintenanceDue.remindersSendDisabled')}>
            <Send /> {t('maintenanceDue.remindersSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function r0(row: DueRow): string {
  return [row.brand, row.model, row.modelYear].filter(Boolean).join(' ')
    || row.vin || row.plate || (row.mileage != null ? fmtKm(row.mileage) : '');
}
