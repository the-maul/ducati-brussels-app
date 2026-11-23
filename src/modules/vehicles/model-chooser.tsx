/**
 * Choisir une Ducati comme dans le catalogue : famille, cylindrée, puis l'année sur la ligne de la
 * version (retour de Domenico, 23/11/2026). Versions Europe, comme le reste du catalogue (M-15).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { ducatiCommercialName } from '@/lib/vin-identify';
import {
  getModelYearContext, listCatalogFamilies, listCatalogModels, listCatalogYearsForModels,
} from '@/modules/catalog/api';
import { superModelsOf } from './model-pick';

export type ChosenModel = { brand: string; model: string; year: number | null; modelYearId: string };

const chip = (active: boolean) =>
  `rounded-md border px-3 py-1.5 text-[13px] font-medium pointer-coarse:min-h-11 ${
    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'
  }`;

export function ModelChooserDialog({ currentModelYearId, onPick, onManual, onClose }: {
  currentModelYearId: string | null;
  onPick: (c: ChosenModel) => void;
  onManual: () => void;
  onClose: () => void;
}) {
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [superId, setSuperId] = useState<string | null>(null);

  const families = useQuery({ queryKey: ['ducati-catalog', 'families'], queryFn: listCatalogFamilies, staleTime: 3_600_000 });
  const models = useQuery({
    queryKey: ['ducati-catalog', 'models', familyId],
    queryFn: () => listCatalogModels(familyId as string),
    enabled: !!familyId, staleTime: 3_600_000,
  });
  const context = useQuery({
    queryKey: ['ducati-catalog', 'my-context', currentModelYearId],
    queryFn: () => getModelYearContext(currentModelYearId as string),
    enabled: !!currentModelYearId,
  });
  // Moto déjà reconnue : on ouvre sur sa famille et sa cylindrée.
  useEffect(() => { if (context.data) setFamilyId((f) => f ?? context.data?.family_id ?? null); }, [context.data]);
  useEffect(() => {
    const own = (models.data ?? []).find((m) => m.id === context.data?.model_id);
    if (own) setSuperId((s) => s ?? own.supermodel_id);
  }, [models.data, context.data]);

  const supers = useMemo(() => superModelsOf(models.data ?? []), [models.data]);
  useEffect(() => { if (supers.length === 1) setSuperId(supers[0].id); }, [supers]);

  const rows = useMemo(
    () => (models.data ?? []).filter((m) => m.supermodel_id === superId)
      .sort((a, b) => a.description.localeCompare(b.description, 'fr', { numeric: true })),
    [models.data, superId],
  );
  const modelIds = rows.map((m) => m.id);
  const years = useQuery({
    queryKey: ['ducati-catalog', 'years-of-models', modelIds],
    queryFn: () => listCatalogYearsForModels(modelIds),
    enabled: modelIds.length > 0, staleTime: 3_600_000,
  });
  const familyName = (families.data ?? []).find((f) => f.id === familyId)?.description ?? null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('dossier.modelPickTitle')}</DialogTitle>
          <DialogDescription>{t('dossier.modelPickHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('catalog.chooseFamily')}>
          {families.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {(families.data ?? []).map((f) => (
            <button key={f.id} type="button" aria-pressed={f.id === familyId} className={chip(f.id === familyId)}
              onClick={() => { setFamilyId(f.id); setSuperId(null); }}>
              {f.description}
            </button>
          ))}
        </div>

        {familyId && (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3" role="group">
            {models.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {supers.map((s) => (
              <button key={s.id} type="button" aria-pressed={s.id === superId} className={chip(s.id === superId)} onClick={() => setSuperId(s.id)}>
                {s.label}
              </button>
            ))}
            {!models.isLoading && supers.length === 0 && <p className="text-[13px] text-muted-foreground">{t('catalog.noModel')}</p>}
          </div>
        )}

        {superId && rows.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border">
            {years.isLoading && <div className="p-3"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
            {rows.map((m) => (
              <div key={m.id} className="grid grid-cols-1 items-center gap-2 border-b border-border px-3 py-1.5 last:border-0 odd:bg-muted/40 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
                <span className="text-[13px] font-medium">{m.description}</span>
                <span className="flex flex-wrap gap-1">
                  {(years.data ?? []).filter((y) => y.model_id === m.id).map((y) => (
                    <button key={y.id} type="button"
                      className={`${chip(y.id === currentModelYearId)} px-2.5 py-1 font-data tabular-nums`}
                      onClick={() => onPick({
                        brand: 'DUCATI',
                        model: ducatiCommercialName(familyName, m.supermodel?.description ?? null, m.description),
                        year: y.year,
                        modelYearId: y.id,
                      })}>
                      {y.year ?? y.code ?? y.id}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onManual}>{t('dossier.modelManual')}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
