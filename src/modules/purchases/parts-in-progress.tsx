/**
 * M4 — C2 : vue d'ensemble « Pièces en cours » (onglet de /parts/upcoming) : toutes les pièces demandées et
 * pas encore remises, filtrables par type de commande, statut, retard, client, OR ou référence.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { fillVars, t } from '@/lib/i18n';
import { PART_STATUSES, countByStatus, filterPartPaths, type PartStatus } from './part-path';
import { PartPathTable, usePartPaths } from './part-path-ui';

const TYPES = ['standard', 'urgente', 'accident', 'excel'] as const;

export function PartsInProgress({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [status, setStatus] = useState<PartStatus | ''>('');
  const [late, setLate] = useState(false);
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState(false);
  const { items, isLoading, error } = usePartPaths(companyId, 'all', null, !closed);

  const byType = useMemo(() => filterPartPaths(items, { type, late, search }), [items, type, late, search]);
  const counts = useMemo(() => countByStatus(byType), [byType]);
  const shown = useMemo(() => filterPartPaths(byType, { status }), [byType, status]);
  const lateCount = useMemo(() => items.filter((i) => i.path.isLate).length, [items]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('partPath.searchPlaceholder')} className="h-11 pl-9" />
        </div>
        <label className="flex h-11 items-center gap-2 text-[13px]">
          <Checkbox checked={late} onCheckedChange={(v) => setLate(v === true)} />
          <AlertTriangle className="size-4 text-danger" /> {fillVars(t('partPath.filterLate'), { n: lateCount })}
        </label>
        <label className="flex h-11 items-center gap-2 text-[13px]">
          <Checkbox checked={closed} onCheckedChange={(v) => setClosed(v === true)} /> {t('partPath.filterClosed')}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('partPath.filterType')}</span>
        {['', ...TYPES].map((k) => (
          <Button key={k || 'all'} size="sm" variant="outline" aria-pressed={type === k} className={cn('min-h-11', type === k && 'border-foreground bg-accent font-bold')} onClick={() => setType(k)}>
            {k ? t(`partPath.type_${k}`) : t('partPath.all')}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('partPath.filterStatus')}</span>
        <Button size="sm" variant="outline" aria-pressed={status === ''} className={cn('min-h-11', status === '' && 'border-foreground bg-accent font-bold')} onClick={() => setStatus('')}>
          {t('partPath.all')} <span className="tabular-nums">({byType.length})</span>
        </Button>
        {PART_STATUSES.filter((s) => s !== 'remise' || closed).map((s) => (
          <Button key={s} size="sm" variant="outline" aria-pressed={status === s} className={cn('min-h-11', status === s && 'border-foreground bg-accent font-bold')} onClick={() => setStatus(s)}>
            {t(`partPath.status_${s}`)} <span className="tabular-nums">({counts[s]})</span>
          </Button>
        ))}
      </div>

      {isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('partPath.loadError')}</p>}
      {!isLoading && !error && shown.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{t('partPath.empty')}</p>
      )}
      {shown.length > 0 && <PartPathTable companyId={companyId} items={shown} onChanged={() => qc.invalidateQueries({ queryKey: ['part-paths'] })} />}
    </div>
  );
}
