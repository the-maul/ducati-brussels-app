/**
 * M8 — Écran « Plans d'entretien » (Atelier, mission 07 carte 1, ATE014) :
 * liste des plans, échéances / opérations / temps, modèles du catalogue Ducati rattachés
 * (Rattacher / Détacher, proposition automatique relançable) et couverture du catalogue.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Wand2, Link2, Unlink, CheckCircle2, AlertTriangle, XCircle, BookOpen, ListChecks, Timer, Euro, Search,
} from 'lucide-react';
import { KpiCard } from '@/components/kpi-card';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { fill, fmtInt, fmtMoney } from '@/modules/catalog/format';
import {
  getCatalogCoverage, getMaintenanceStats, listLinkCounts, listMaintenancePlans, listPlanLinks, loadHourlyRateHt,
  proposeCatalogLinks, searchCatalogModelYears, setPlanLinks, type MaintenancePlan, type PlanLink,
} from './maintenance-api';
import { MAINTENANCE_USAGES } from './maintenance-plans';
import { PlanServices, UsageBadge, yearsLabel } from './maintenance-plan-view';

const LINK_STATUS: Record<string, { tone: StatusTone; icon: typeof CheckCircle2 }> = {
  lie: { tone: 'success', icon: CheckCircle2 },
  a_valider: { tone: 'warning', icon: AlertTriangle },
  rejete: { tone: 'neutral', icon: XCircle },
};

function LinkBadge({ status }: { status: string }) {
  const m = LINK_STATUS[status] ?? LINK_STATUS.rejete;
  return <StatusBadge tone={m.tone} icon={m.icon} label={t(`maintenance.st_${status}`)} />;
}

export function MaintenancePlansScreen() {
  const { activeCompanyId, hasRole } = useAuth();
  const canEdit = hasRole('admin') || hasRole('chef_atelier');
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ['maintenance', 'stats'], queryFn: getMaintenanceStats });
  const rate = useQuery({ queryKey: ['maintenance', 'rate', activeCompanyId], queryFn: () => loadHourlyRateHt(activeCompanyId!), enabled: !!activeCompanyId });

  const propose = useMutation({
    mutationFn: () => proposeCatalogLinks(activeCompanyId!),
    onSuccess: (r) => {
      toast.success(r.modelYears === 0 ? t('maintenance.proposeEmptyCatalog')
        : fill(t('maintenance.proposeDone'), { linked: fmtInt(r.linked), toValidate: fmtInt(r.toValidate), modelYears: fmtInt(r.modelYears) }));
      qc.invalidateQueries({ queryKey: ['maintenance'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenance.saveErr')),
  });

  const s = stats.data;
  const rateHt = rate.data ?? null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={t('maintenance.kpiPlans')} value={fmtInt(s?.plans)} icon={BookOpen}
          delta={s ? fill(t('maintenance.plansDetail'), { route: fmtInt(s.plansByUsage.route ?? 0), amateur: fmtInt(s.plansByUsage.piste_amateur ?? 0), racing: fmtInt(s.plansByUsage.racing ?? 0) }) : undefined} />
        <KpiCard label={t('maintenance.kpiServices')} value={fmtInt(s?.services)} icon={ListChecks}
          delta={s ? fill(t('maintenance.servicesDetail'), { ops: fmtInt(s.operations) }) : undefined} />
        <KpiCard label={t('maintenance.kpiTimes')} value={fmtInt(s?.timesCurrent)} icon={Timer}
          delta={s ? fill(t('maintenance.timesDetail'), { n: fmtInt(s.times) }) : undefined} />
        <KpiCard label={t('maintenance.kpiRate')} value={rateHt == null ? t('maintenance.rateMissing') : fmtMoney(rateHt)} icon={Euro}
          delta={rateHt == null ? t('maintenance.rateHint') : undefined} deltaTone="danger" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">{t('maintenance.canEdit')}</p>
        <Button onClick={() => propose.mutate()} disabled={!canEdit || !activeCompanyId || propose.isPending}>
          {propose.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('maintenance.propose')}
        </Button>
      </div>

      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">{t('maintenance.tabPlans')}</TabsTrigger>
          <TabsTrigger value="coverage">{t('maintenance.tabCoverage')}</TabsTrigger>
        </TabsList>
        <TabsContent value="plans" className="mt-3"><PlansBrowser rate={rateHt} canEdit={canEdit} companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="coverage" className="mt-3"><CoveragePanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function PlansBrowser({ rate, canEdit, companyId }: { rate: number | null; canEdit: boolean; companyId: string | null }) {
  const plans = useQuery({ queryKey: ['maintenance', 'plans'], queryFn: listMaintenancePlans });
  const counts = useQuery({ queryKey: ['maintenance', 'link-counts'], queryFn: listLinkCounts });
  const [family, setFamily] = useState('all');
  const [usage, setUsage] = useState('all');
  const [q, setQ] = useState('');
  const [planId, setPlanId] = useState<string | null>(null);

  const families = useMemo(() => [...new Set((plans.data ?? []).map((p) => p.family))].sort(), [plans.data]);
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (plans.data ?? []).filter((p) => (family === 'all' || p.family === family) && (usage === 'all' || p.usage === usage)
      && (!k || `${p.model_text} ${p.family} ${p.id}`.toLowerCase().includes(k)));
  }, [plans.data, family, usage, q]);
  const plan = (plans.data ?? []).find((p) => p.id === planId) ?? null;

  if (plans.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (plans.error) return <p className="text-sm text-danger">{t('maintenance.loadErr')}</p>;
  if (!plans.data?.length) return <p className="text-sm text-muted-foreground">{t('maintenance.noPlan')}</p>;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-2 rounded-md border border-border bg-card p-3">
        <Select value={family} onValueChange={setFamily}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('maintenance.allFamilies')}</SelectItem>
            {families.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={usage} onValueChange={setUsage}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('maintenance.allUsages')}</SelectItem>
            {MAINTENANCE_USAGES.map((u) => <SelectItem key={u} value={u}>{t(`maintenance.usage_${u}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('maintenance.search')} />
        {!filtered.length && <p className="text-sm text-muted-foreground">{t('maintenance.noPlanFilter')}</p>}
        <ul className="max-h-[65vh] space-y-0.5 overflow-auto">
          {filtered.map((p) => {
            const c = counts.data?.[p.id];
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setPlanId(p.id)}
                  className={cn('w-full rounded-[4px] px-2 py-1.5 text-left text-sm hover:bg-muted', planId === p.id && 'bg-muted font-semibold')}>
                  <div>{p.model_text}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className="tabular-nums">{yearsLabel(p.year_from, p.year_to)}</span>
                    {p.usage !== 'route' && <UsageBadge usage={p.usage} />}
                    {c?.lie ? <span className="tabular-nums">· {fill(t('maintenance.linkedCount'), { n: c.lie })}</span> : null}
                    {c?.a_valider ? <span className="tabular-nums text-warning">· {fill(t('maintenance.pendingCount'), { n: c.a_valider })}</span> : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-w-0 space-y-4">
        {!plan ? <p className="text-sm text-muted-foreground">{t('maintenance.choosePlan')}</p> : (
          <>
            <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-ui text-[18px] font-bold">{plan.model_text}</h2>
                <UsageBadge usage={plan.usage} />
              </div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                {plan.family} · <span className="tabular-nums">{yearsLabel(plan.year_from, plan.year_to)}</span>
              </div>
              <div className="mt-2 text-[13px]">
                {plan.checklist_id
                  ? <>{t('maintenance.checklist')} : <span className="font-mono text-[12px]">{plan.checklist_id}</span></>
                  : <span className="text-muted-foreground">{t('maintenance.noChecklist')}</span>}
              </div>
              {plan.source_files.length > 0 && (
                <div className="mt-1 text-[12px] text-muted-foreground">{t('maintenance.sources')} : {plan.source_files.join(' · ')}</div>
              )}
            </div>

            <PlanLinksPanel plan={plan} canEdit={canEdit} companyId={companyId} />

            <section>
              <h3 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('maintenance.secServices')}</h3>
              <PlanServices planId={plan.id} rate={rate} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function PlanLinksPanel({ plan, canEdit, companyId }: { plan: MaintenancePlan; canEdit: boolean; companyId: string | null }) {
  const qc = useQueryClient();
  const links = useQuery({ queryKey: ['maintenance', 'links', plan.id], queryFn: () => listPlanLinks(plan.id) });
  const [q, setQ] = useState('');
  const hits = useQuery({ queryKey: ['maintenance', 'catalog-search', q], queryFn: () => searchCatalogModelYears(q), enabled: q.trim().length >= 2 });

  const set = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: 'lie' | 'rejete' }) => setPlanLinks(companyId!, plan.id, ids, status),
    onSuccess: (_n, v) => {
      toast.success(v.status === 'lie' ? t('maintenance.attached') : t('maintenance.detached'));
      qc.invalidateQueries({ queryKey: ['maintenance'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenance.saveErr')),
  });

  const linkedIds = new Set((links.data ?? []).filter((l) => l.status === 'lie').map((l) => l.model_year_id));
  const visible = (links.data ?? []);
  const newHits = (hits.data ?? []).filter((h) => !linkedIds.has(h.id));
  const disabled = !canEdit || !companyId || set.isPending;

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h3 className="mb-2 font-ui text-[15px] font-bold">{t('maintenance.secLinks')}</h3>
      {links.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : !visible.length ? (
        <p className="text-sm text-muted-foreground">{t('maintenance.noLinks')}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('maintenance.colModel')}</TableHead>
                <TableHead>{t('maintenance.colYear')}</TableHead>
                <TableHead>{t('maintenance.colStatus')}</TableHead>
                <TableHead>{t('maintenance.colReason')}</TableHead>
                <TableHead className="text-right">{t('maintenance.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((l: PlanLink) => (
                <TableRow key={l.id}>
                  <TableCell>
                    {l.model_year?.model?.description ?? l.model_year_id}
                    {l.model_year?.name && <span className="ml-1 text-[12px] text-muted-foreground">{l.model_year.name}</span>}
                  </TableCell>
                  <TableCell className="tabular-nums">{l.model_year?.year ?? '—'}</TableCell>
                  <TableCell><LinkBadge status={l.status} /></TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {[l.reason, t(`maintenance.origin_${l.origin}`)].filter(Boolean).join(' · ')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {l.status !== 'lie' && (
                        <Button size="sm" variant="outline" disabled={disabled} onClick={() => set.mutate({ ids: [l.model_year_id], status: 'lie' })}>
                          <Link2 /> {t('maintenance.attach')}
                        </Button>
                      )}
                      {l.status !== 'rejete' && (
                        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => set.mutate({ ids: [l.model_year_id], status: 'rejete' })}>
                          <Unlink /> {t('maintenance.detach')}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canEdit && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('maintenance.attachSearch')} className="pl-8" />
          </div>
          {q.trim().length > 0 && q.trim().length < 2 && <p className="text-[12px] text-muted-foreground">{t('maintenance.attachHint')}</p>}
          {hits.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {q.trim().length >= 2 && !hits.isFetching && !newHits.length && <p className="text-[12px] text-muted-foreground">{t('maintenance.noHit')}</p>}
          {newHits.length > 0 && (
            <>
              {newHits.length > 1 && (
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => set.mutate({ ids: newHits.map((h) => h.id), status: 'lie' })}>
                  <Link2 /> {fill(t('maintenance.attachAll'), { n: newHits.length })}
                </Button>
              )}
              <ul className="max-h-64 space-y-0.5 overflow-auto text-sm">
                {newHits.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 rounded-[4px] px-2 py-1 hover:bg-muted">
                    <span>
                      {h.model} <span className="tabular-nums">{h.year ?? ''}</span>
                      <span className="ml-1 text-[12px] text-muted-foreground">{[h.family, h.name].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => set.mutate({ ids: [h.id], status: 'lie' })}>
                      <Link2 /> {t('maintenance.attach')}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CoveragePanel() {
  const cov = useQuery({ queryKey: ['maintenance', 'coverage'], queryFn: () => getCatalogCoverage(300) });
  if (cov.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (cov.error || !cov.data) return <p className="text-sm text-danger">{t('maintenance.loadErr')}</p>;
  const c = cov.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={t('maintenance.covModelYears')} value={fmtInt(c.modelYears)} delta={t('maintenance.covModelYearsHint')} />
        <KpiCard label={t('maintenance.covCovered')} value={fmtInt(c.covered)} />
        <KpiCard label={t('maintenance.covPending')} value={fmtInt(c.pending)} />
        <KpiCard label={t('maintenance.covUncovered')} value={fmtInt(c.uncovered)} />
      </div>
      <section className="rounded-md border border-border bg-card p-4">
        <h3 className="mb-2 font-ui text-[15px] font-bold">{t('maintenance.covTitle')}</h3>
        {c.modelYears === 0 ? <p className="text-sm text-muted-foreground">{t('maintenance.covCatalogEmpty')}</p>
          : !c.list.length ? <p className="text-sm text-muted-foreground">{t('maintenance.covEmpty')}</p> : (
            <>
              {c.uncovered > c.list.length && <p className="mb-2 text-[12px] text-muted-foreground">{fill(t('maintenance.covMore'), { n: fmtInt(c.list.length) })}</p>}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('maintenance.colFamily')}</TableHead>
                      <TableHead>{t('maintenance.colModel')}</TableHead>
                      <TableHead>{t('maintenance.colYear')}</TableHead>
                      <TableHead>{t('maintenance.colStatus')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.list.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.family}</TableCell>
                        <TableCell>{r.model}{r.name && <span className="ml-1 text-[12px] text-muted-foreground">{r.name}</span>}</TableCell>
                        <TableCell className="tabular-nums">{r.year ?? '—'}</TableCell>
                        <TableCell>{r.pending ? <LinkBadge status="a_valider" /> : <StatusBadge tone="neutral" icon={XCircle} label={t('maintenance.covUncovered')} />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
      </section>
    </div>
  );
}
