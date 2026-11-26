import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listSearchFromRaw } from '@/lib/list-search';
import { useListSearch, useSearchText } from '@/lib/use-list-search';
import { Search, Loader2, Plus, Bike, AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, ListChecks, Gift, FileImage, Flag } from 'lucide-react';
import { OptionsCatalogDialog } from '@/modules/vehicles/options-catalog-dialog';
import { BonusesPeriodDialog } from '@/modules/vehicles/fiche-g8-panels';
import { PosterDialog } from '@/modules/vehicles/poster-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listVehiclesPage, vehicleLabel, VEHICLES_PAGE_SIZE, VEHICLE_STATUSES, type VehicleStatus } from '@/modules/vehicles/api';
import { listPendingDeclarations } from '@/modules/vehicles/declarations-api';
import { t, pageTitle } from '@/lib/i18n';
import { useCanWrite } from '@/lib/auth/use-access';

/** Etat de la liste garde dans l'adresse (UX011). */
const VEHICLES_LIST = { q: '', status: 'all', toComplete: false, trackBike: false, page: 0 };
const VEHICLES_CHOICES = { status: ['all', ...VEHICLE_STATUSES.map((s) => s.value as string)] };

export const Route = createFileRoute('/_app/vehicles/')({
  head: () => ({ meta: [{ title: pageTitle('vehicles') }] }),
  validateSearch: (s: Record<string, unknown>) => listSearchFromRaw(s, VEHICLES_LIST, VEHICLES_CHOICES),
  component: VehiclesList,
});

function fmtEur(n: number | null): string {
  if (n == null) return '—';
  const s = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ');
  return `${s} €`;
}

const toneOf = (s: VehicleStatus) => VEHICLE_STATUSES.find((x) => x.value === s)?.tone ?? 'neutral';

function VehiclesList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  // Lecture seule : on ne propose pas une action qui serait refusée ensuite.
  const canWrite = useCanWrite();
  // Rattrapage G8 : catalogue d'options, liste des primes par periode, affichettes de plusieurs motos.
  const [g8Dialog, setG8Dialog] = useState<'options' | 'bonuses' | 'poster' | null>(null);
  // Recherche, statut et « a completer » dans l'adresse (UX011) : Retour depuis une fiche moto
  // retrouve la meme liste.
  const [ls, setLs] = useListSearch(VEHICLES_LIST, VEHICLES_CHOICES);
  const debounced = ls.q;
  const [search, setSearch] = useSearchText(ls.q, (q) => setLs({ q, page: 0 }));
  const status = ls.status as VehicleStatus | 'all';
  const setStatus = (v: VehicleStatus | 'all') => setLs({ status: v, page: 0 });
  // Mission 03, M-40 : motos « à compléter » (VIN ou prix d'achat manquant) — non facturables.
  const toComplete = ls.toComplete;
  const setToComplete = (v: boolean | ((p: boolean) => boolean)) => setLs((cur) => ({ toComplete: typeof v === 'function' ? v(cur.toComplete) : v, page: 0 }));
  // Motos piste : sans plaque, retrouvées par ce filtre.
  const trackBike = ls.trackBike;
  const toggleTrackBike = () => setLs((cur) => ({ trackBike: !cur.trackBike, page: 0 }));

  const page = Math.max(0, Math.floor(ls.page));
  const { data: result, isLoading, isFetching, error } = useQuery({
    queryKey: ['vehicles', activeCompanyId, debounced, status, toComplete, trackBike, page],
    queryFn: () => listVehiclesPage(activeCompanyId!, debounced, status, toComplete, page, trackBike),
    enabled: !!activeCompanyId,
    placeholderData: (previous) => previous,
  });
  const data = result?.rows;
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / VEHICLES_PAGE_SIZE));
  const goToPage = (p: number) => { setLs({ page: Math.min(pages - 1, Math.max(0, p)) }); window.scrollTo({ top: 0 }); };
  // Adresse gardée alors que la liste a raccourci : on revient sur la dernière page.
  useEffect(() => {
    if (result && !isFetching && page >= pages) setLs({ page: pages - 1 });
  }, [result, isFetching, page, pages, setLs]);

  // Mission 04, carte 8 : motos déclarées par les clients, en attente de validation.
  const declQ = useQuery({
    queryKey: ['declared-vehicles', activeCompanyId],
    queryFn: () => listPendingDeclarations(activeCompanyId!),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });
  const pendingDecl = declQ.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title={t('vehicles.title')}
        description={t('vehicles.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/vehicles/declarations' })}>
              <Bike /> {t('motoClient.declOpen')}
              {pendingDecl > 0 && (
                <span className="rounded-[var(--radius-badge)] bg-warning-bg px-1.5 font-data text-[12px] font-bold tabular-nums text-warning">{pendingDecl}</span>
              )}
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/vehicles/register' })}>
              <ClipboardList /> {t('vehicleRegister.title')}
            </Button>
            <Button variant="outline" onClick={() => setG8Dialog('options')}><ListChecks /> {t('parcG8.optionsTitle')}</Button>
            <Button variant="outline" onClick={() => setG8Dialog('bonuses')}><Gift /> {t('parcG8.bonusList')}</Button>
            <Button variant="outline" onClick={() => setG8Dialog('poster')}><FileImage /> {t('parcG8.posterVehicle')}</Button>
            {canWrite && (
              <Button onClick={() => navigate({ to: '/vehicles/new', search: { contact: undefined, declaration: undefined } })}>
                <Plus /> {t('vehicles.new')}
              </Button>
            )}
          </div>
        }
      />

      {g8Dialog === 'options' && activeCompanyId && <OptionsCatalogDialog companyId={activeCompanyId} onClose={() => setG8Dialog(null)} />}
      {g8Dialog === 'bonuses' && activeCompanyId && <BonusesPeriodDialog companyId={activeCompanyId} onClose={() => setG8Dialog(null)} />}
      {g8Dialog === 'poster' && activeCompanyId && <PosterDialog companyId={activeCompanyId} kind="vehicle" initialIds={[]} onClose={() => setG8Dialog(null)} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('vehicles.search')} className="pl-9" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as VehicleStatus | 'all')}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('vehicles.allStatuses')}</SelectItem>
            {VEHICLE_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{t(`vehicles.status_${s.value}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={toComplete ? 'default' : 'outline'} onClick={() => setToComplete((v) => !v)}>
          <AlertTriangle /> {t('motoParc.filterToComplete')}
        </Button>
        <Button variant={trackBike ? 'default' : 'outline'} onClick={toggleTrackBike} aria-pressed={trackBike}>
          <Flag /> {t('motoParc.filterTrackBike')}
        </Button>
        {data && <span className="text-sm text-muted-foreground">{data.length}</span>}
      </div>

      {error && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <p>{t('vehicles.errLoad')}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{(error as Error).message}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('vehicles.colVehicle')}</Th>
              <Th>{t('vehicles.colVin')}</Th>
              <Th>{t('vehicles.colPlate')}</Th>
              <Th>{t('vehicles.colStatus')}</Th>
              <Th className="text-right">{t('vehicles.colPrice')}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
            )}
            {data && data.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('vehicles.empty')}</td></tr>
            )}
            {data?.map((v) => (
              <tr
                key={v.id}
                onClick={() => navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: v.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent"
              >
                <td className="px-3 py-2 font-medium">{vehicleLabel(v)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{v.vin ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{v.plate ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={toneOf(v.status)} label={t(`vehicles.status_${v.status}`)} />
                    {v.to_complete ? <StatusBadge tone="warning" label={t('motoParc.badgeToComplete')} /> : null}
                    {(v.oro ?? []).filter((o) => o.number).slice(0, 1).map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate({ to: '/tradein/$oroId', params: { oroId: o.id } }); }}
                        className="font-mono text-[11px] text-info underline decoration-dotted underline-offset-2 hover:text-foreground"
                        title={t('vehicles.openReprise')}
                      >
                        {o.number}
                      </button>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtEur(v.display_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
          <span className="tabular-nums">
            {t('docList.range').replace('{from}', String(page * VEHICLES_PAGE_SIZE + 1)).replace('{to}', String(Math.min(total, (page + 1) * VEHICLES_PAGE_SIZE))).replace('{n}', String(total))}
            {isFetching && <Loader2 className="ml-2 inline size-3 animate-spin" />}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => goToPage(page - 1)} disabled={page === 0}><ChevronLeft /> {t('docList.prev')}</Button>
            <span className="px-2 tabular-nums">{page + 1} / {pages}</span>
            <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => goToPage(page + 1)} disabled={page + 1 >= pages}>{t('docList.next')} <ChevronRight /></Button>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
