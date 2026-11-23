/**
 * M8 — Fiche de la moto sous le véhicule choisi, dans la fenêtre du rendez-vous (comme G8).
 * Chaque champ se complète sur place et s'enregistre dès qu'on le quitte. Le VIN et le dernier
 * kilométrage restent en lecture : ils ont leurs propres contrôles.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { fillVars, t } from '@/lib/i18n';
import { updateVehicle } from '@/modules/vehicles/api';
import {
  ANTIPOLLUTION_OPTIONS, COLOR_OPTIONS, CYLINDER_OPTIONS, ENERGY_OPTIONS, VEHICLE_FAMILIES, loadSpecOptions, loadVehicleFill,
} from '@/modules/vehicles/catalog-specs';
import { SpecSelect } from '@/modules/vehicles/spec-select';
import {
  sheetInputValue, sheetMissingCount, sheetParseValue, vehicleSheetGroups, VEHICLE_SHEET_COLUMNS,
  type SheetField, type VehicleSheetRow,
} from './vehicle-sheet';

const loose = supabase as unknown as {
  from: (table: string) => { select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> } } };
};

const FIELD_CLASS = 'h-8 px-2 text-[13px] pointer-coarse:h-11';

export function VehicleRdvSheet({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['rdv-vehicle-sheet', vehicleId],
    queryFn: async () => {
      const { data, error } = await loose.from('vehicles').select(VEHICLE_SHEET_COLUMNS).eq('id', vehicleId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const raw = data as VehicleSheetRow;
      // Comme la fiche moto : les champs vides viennent de nos factures et du catalogue.
      return { raw, shown: (await loadVehicleFill(raw)).vehicle };
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const optionsQ = useQuery({ queryKey: ['vehicle-spec-options'], queryFn: loadSpecOptions, staleTime: 3_600_000 });
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  useEffect(() => { setDraft({}); }, [vehicleId]);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateVehicle(vehicleId, patch as never),
    meta: { success: false },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rdv-vehicle-sheet', vehicleId] });
      void qc.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      void qc.invalidateQueries({ queryKey: ['vehicle-fill', vehicleId] });
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  if (q.isLoading) {
    return <div className="flex justify-center rounded-md border border-border bg-card p-3 sm:col-span-3"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  }
  if (q.error) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger sm:col-span-3">{(q.error as Error).message}</p>;
  if (!q.data) return null;
  const { raw, shown } = q.data;

  const row: VehicleSheetRow = { ...shown, ...draft };
  const words = { yes: t('dossier.sheetYes'), no: t('dossier.sheetNo') };
  const groups = vehicleSheetGroups(row, words);
  const missing = sheetMissingCount(groups);

  const commit = (field: SheetField, value: string | boolean) => {
    const next = sheetParseValue(field, value);
    const saved = field.input === 'bool' ? raw[field.key] === true : sheetParseValue(field, sheetInputValue(field, raw));
    if (next === saved) return;
    save.mutate({ [field.key]: next });
  };
  const optionsFor = (field: SheetField): readonly string[] => {
    switch (field.optionsKey) {
      case 'displacement': return optionsQ.data?.displacement ?? [];
      case 'power_cv': return optionsQ.data?.power_cv ?? [];
      case 'energy': return ENERGY_OPTIONS;
      case 'antipollution': return ANTIPOLLUTION_OPTIONS;
      case 'color': return COLOR_OPTIONS;
      case 'category': return VEHICLE_FAMILIES;
      case 'cylinders': return CYLINDER_OPTIONS;
      default: return [];
    }
  };

  const editor = (field: SheetField) => {
    if (field.input === 'read') {
      return <span className="block truncate py-1 font-medium tabular-nums" title={field.value ?? undefined}>{field.value ?? '—'}</span>;
    }
    if (field.input === 'bool') {
      return (
        <input type="checkbox" checked={row[field.key] === true} aria-label={t(field.labelKey)}
          onChange={(e) => { setDraft((d) => ({ ...d, [field.key]: e.target.checked })); commit(field, e.target.checked); }}
          className="size-4 accent-[var(--ducati-red)] pointer-coarse:size-5" />
      );
    }
    const value = sheetInputValue(field, row);
    const empty = !field.optional && !value.trim();
    const warn = empty ? 'border-warning' : '';
    if (field.input === 'spec' || field.input === 'specNumber') {
      return (
        <SpecSelect value={value} options={optionsFor(field)} numeric={field.input === 'specNumber'} className={`${FIELD_CLASS} ${warn}`}
          onChange={(v) => { setDraft((d) => ({ ...d, [field.key]: v })); commit(field, v); }} />
      );
    }
    return (
      <Input type={field.input === 'date' ? 'date' : field.input === 'number' ? 'number' : 'text'} value={value} aria-label={t(field.labelKey)}
        placeholder={empty ? t('dossier.sheetEmpty') : undefined}
        onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, [field.key]: v })); }}
        onBlur={(e) => { if (draft[field.key] !== undefined) commit(field, e.target.value); }}
        className={`${FIELD_CLASS} ${warn} ${field.input === 'number' ? 'tabular-nums' : ''}`} />
    );
  };

  return (
    <section className="rounded-md border border-border bg-card p-3 sm:col-span-3" aria-label={t('dossier.sheetTitle')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-bold">{t('dossier.sheetTitle')}</h3>
        {missing > 0 ? (
          <span className="inline-flex items-center gap-1 rounded bg-warning-bg px-2 py-0.5 text-[12px] font-bold text-warning">
            <AlertTriangle className="size-3.5" aria-hidden /> {fillVars(t('dossier.sheetMissing'), { n: missing })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-success-bg px-2 py-0.5 text-[12px] font-bold text-success">
            <CheckCircle2 className="size-3.5" aria-hidden /> {t('dossier.sheetComplete')}
          </span>
        )}
        <span className="text-[12px] text-muted-foreground" role="status">
          {save.isPending ? t('dossier.sheetSaving') : save.isSuccess ? t('dossier.sheetSaved') : ''}
        </span>
        <Link to="/vehicles/$vehicleId" params={{ vehicleId }} target="_blank" rel="noopener"
          className="ml-auto inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-info underline-offset-2 hover:underline">
          <ExternalLink className="size-3.5" aria-hidden /> {t('dossier.sheetOpen')}
        </Link>
      </div>
      <div className="grid gap-x-5 gap-y-3 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.titleKey} className="min-w-0">
            <h4 className="mb-1 border-b border-border pb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(g.titleKey)}</h4>
            <div className="space-y-1">
              {g.fields.map((x) => (
                <div key={x.key} className="grid grid-cols-[minmax(0,42%)_minmax(0,1fr)] items-center gap-2 text-[13px]">
                  <span className="truncate text-muted-foreground" title={t(x.labelKey)}>{t(x.labelKey)}</span>
                  <div className="min-w-0">{editor(x)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
