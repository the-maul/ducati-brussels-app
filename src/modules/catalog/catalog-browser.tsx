/**
 * Catalogue Ducati — navigation famille → modèle → millésime → vues éclatées → pièces.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, CheckCircle2, CircleDashed, AlertTriangle, ImageOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import {
  listCatalogFamilies, listCatalogModels, listCatalogModelYears, listModelYearDrawings,
  type CatalogDrawingRef, type CatalogModelYear,
} from './api';
import { DrawingView } from './drawing-view';

export function CatalogBrowser({ companyId }: { companyId: string | null }) {
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelYearId, setModelYearId] = useState<string | null>(null);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const families = useQuery({ queryKey: ['ducati-catalog', 'families'], queryFn: listCatalogFamilies });
  const models = useQuery({ queryKey: ['ducati-catalog', 'models', familyId], queryFn: () => listCatalogModels(familyId as string), enabled: !!familyId });
  const years = useQuery({ queryKey: ['ducati-catalog', 'years', modelId], queryFn: () => listCatalogModelYears(modelId as string), enabled: !!modelId });
  const drawings = useQuery({ queryKey: ['ducati-catalog', 'my-drawings', modelYearId], queryFn: () => listModelYearDrawings(modelYearId as string), enabled: !!modelYearId });

  const filteredModels = useMemo(() => {
    const k = q.trim().toUpperCase();
    return (models.data ?? []).filter((m) => !k || m.description.toUpperCase().includes(k));
  }, [models.data, q]);

  const groups = useMemo(() => {
    const out: { id: string; label: string; items: CatalogDrawingRef[] }[] = [];
    for (const d of drawings.data ?? []) {
      let g = out.find((x) => x.id === d.group_id);
      if (!g) { g = { id: d.group_id, label: [d.group?.code, d.group?.description].filter(Boolean).join(' — '), items: [] }; out.push(g); }
      g.items.push(d);
    }
    return out;
  }, [drawings.data]);

  if (drawingId) return <DrawingView drawingId={drawingId} companyId={companyId} onBack={() => setDrawingId(null)} />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Familles et modèles */}
      <div className="space-y-2 rounded-md border border-border bg-card p-3">
        <Select value={familyId ?? ''} onValueChange={(v) => { setFamilyId(v); setModelId(null); setModelYearId(null); }}>
          <SelectTrigger><SelectValue placeholder={t('catalog.chooseFamily')} /></SelectTrigger>
          <SelectContent>
            {(families.data ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.description}</SelectItem>)}
          </SelectContent>
        </Select>
        {familyId && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('catalog.searchModel')} />}
        {models.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {familyId && !models.isLoading && !filteredModels.length && <p className="text-sm text-muted-foreground">{t('catalog.noModel')}</p>}
        <ul className="max-h-[60vh] space-y-0.5 overflow-auto">
          {filteredModels.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => { setModelId(m.id); setModelYearId(null); }}
                className={cn('w-full rounded-[4px] px-2 py-1.5 text-left text-sm hover:bg-muted', modelId === m.id && 'bg-muted font-semibold')}>
                {m.description}
                {m.supermodel?.description && <span className="ml-1 text-[12px] text-muted-foreground">{m.supermodel.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Millésimes et vues */}
      <div className="space-y-3">
        {!modelId ? (
          <p className="text-sm text-muted-foreground">{t('catalog.chooseModel')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {years.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {(years.data ?? []).map((y) => (
              <button key={y.id} type="button" onClick={() => setModelYearId(y.id)}
                className={cn('rounded-[6px] border px-3 py-1.5 text-sm', modelYearId === y.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted')}
                title={y.code ?? ''}>
                <span className="font-data tabular-nums">{y.year ?? y.code ?? y.id}</span>
                <YearState y={y} />
              </button>
            ))}
          </div>
        )}

        {modelId && !modelYearId && (years.data ?? []).length > 0 && <p className="text-sm text-muted-foreground">{t('catalog.chooseYear')}</p>}
        {modelYearId && drawings.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {modelYearId && !drawings.isLoading && !groups.length && <p className="text-sm text-muted-foreground">{t('catalog.noDrawing')}</p>}

        {groups.map((g) => (
          <section key={g.id}>
            <h3 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{g.label || g.id}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {g.items.map((d) => (
                <button key={d.drawing_id} type="button" onClick={() => setDrawingId(d.drawing_id)}
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
    </div>
  );
}

function YearState({ y }: { y: CatalogModelYear }) {
  if (y.complete_at) return <CheckCircle2 className="ml-1 inline size-3.5 text-success" aria-label="" />;
  if (y.groups_loaded_at) return <AlertTriangle className="ml-1 inline size-3.5 text-warning" aria-label={t('catalog.incomplete')} />;
  return <CircleDashed className="ml-1 inline size-3.5 text-muted-foreground" aria-label={t('catalog.notLoaded')} />;
}
