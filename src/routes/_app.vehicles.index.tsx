import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listVehicles, vehicleLabel, VEHICLE_STATUSES, type VehicleStatus } from '@/modules/vehicles/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/vehicles/')({
  head: () => ({ meta: [{ title: 'Véhicules — Ducati Bruxelles' }] }),
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
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<VehicleStatus | 'all'>('all');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['vehicles', activeCompanyId, debounced, status],
    queryFn: () => listVehicles(activeCompanyId!, debounced, status),
    enabled: !!activeCompanyId,
  });

  return (
    <>
      <PageHeader
        title={t('vehicles.title')}
        description={t('vehicles.subtitle')}
        actions={
          <Button onClick={() => navigate({ to: '/vehicles/new' })}>
            <Plus /> {t('vehicles.new')}
          </Button>
        }
      />

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
                <td className="px-3 py-2"><StatusBadge tone={toneOf(v.status)} label={t(`vehicles.status_${v.status}`)} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtEur(v.display_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
