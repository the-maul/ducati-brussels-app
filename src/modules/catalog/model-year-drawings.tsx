/**
 * Catalogue Ducati — vues éclatées d'un modèle-année, rangées par groupe du catalogue (vignette,
 * code, description). Partagé par le catalogue (/parts/catalog) et la fenêtre « Vues éclatées de
 * la moto » de l'OR (lot E du parcours mécanicien, 19/11/2026).
 *
 * `groupNav` : barre des groupes (navigation par groupe, pensée tablette) au-dessus des planches.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleDashed, ImageOff, Loader2 } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { listModelYearDrawings, type CatalogDrawingRef } from './api';

export type DrawingGroup = { id: string; label: string; items: CatalogDrawingRef[] };

/** Planches regroupées par groupe, dans l'ordre du catalogue Ducati. */
export function groupDrawings(rows: readonly CatalogDrawingRef[]): DrawingGroup[] {
  const out: DrawingGroup[] = [];
  for (const d of rows) {
    let g = out.find((x) => x.id === d.group_id);
    if (!g) { g = { id: d.group_id, label: [d.group?.code, d.group?.description].filter(Boolean).join(' — '), items: [] }; out.push(g); }
    g.items.push(d);
  }
  return out;
}

export function ModelYearDrawings({ modelYearId, onPick, groupNav = false, large = false }: {
  modelYearId: string; onPick: (drawingId: string) => void; groupNav?: boolean; large?: boolean;
}) {
  const drawings = useQuery({ queryKey: ['ducati-catalog', 'my-drawings', modelYearId], queryFn: () => listModelYearDrawings(modelYearId) });
  const groups = useMemo(() => groupDrawings(drawings.data ?? []), [drawings.data]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const shown = groupNav && groupId ? groups.filter((g) => g.id === groupId) : groups;

  if (drawings.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (drawings.error) return <p className="text-sm text-danger">{t('catalog.loadErr')}</p>;
  if (!groups.length) return <p className="text-sm text-muted-foreground">{t('catalog.noDrawing')}</p>;

  return (
    <div className="space-y-3">
      {groupNav && groups.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('catalog.groupsLabel')}>
          <GroupChip on={!groupId} label={t('catalog.allGroups')} count={drawings.data?.length ?? 0} large={large} onClick={() => setGroupId(null)} />
          {groups.map((g) => (
            <GroupChip key={g.id} on={groupId === g.id} label={g.label || g.id} count={g.items.length} large={large} onClick={() => setGroupId(g.id)} />
          ))}
        </div>
      )}
      {shown.map((g) => (
        <section key={g.id}>
          <h3 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{g.label || g.id}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {g.items.map((d) => (
              <button key={d.drawing_id} type="button" onClick={() => onPick(d.drawing_id)}
                className="rounded-md border border-border bg-card p-2 text-left hover:border-primary">
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[4px] bg-muted">
                  {d.drawing?.thumbnail_url
                    ? <img src={d.drawing.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" />
                    : <ImageOff className="size-5 text-muted-foreground" />}
                </div>
                <div className="mt-1 text-[12px] font-semibold">{d.drawing?.code}</div>
                <div className="line-clamp-2 text-[12px] text-muted-foreground">{d.drawing?.description}</div>
                {!d.drawing?.parts_loaded_at && <div className="mt-1"><StatusBadge tone="warning" icon={CircleDashed} label={t('catalog.partsPending')} /></div>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GroupChip({ on, label, count, large, onClick }: { on: boolean; label: string; count: number; large: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick}
      className={cn('rounded-[6px] border px-3 text-left text-sm', large ? 'min-h-11 py-2' : 'py-1.5',
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted')}>
      {label} <span className="font-data tabular-nums opacity-80">({count})</span>
    </button>
  );
}
