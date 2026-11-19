/**
 * M8 — Lot B (19/11/2026) : reglages « Pieces des RDV » dans les reglages du planning atelier.
 *   - moment de creation de la picking list : la veille du RDV (defaut) / a la reception de la moto
 *     (creation de l'OR) / a la main ;
 *   - heure de la tache de la veille (16 h par defaut) ;
 *   - « urgente si le RDV est a moins de N jours » (5 par defaut) : c'est LE reglage des commandes
 *     (Parametres → Tables → Seuils de commande, ligne urgente), lu et ecrit ici, pas copie.
 * Migration 20261119250000 absente : un message, rien d'autre.
 */
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { Field } from '../planning/ui-bits';
import { DEFAULT_PARTS_SETTINGS, PICKING_MODES, isPickingMode } from './parts-flow';
import { getPartsSettings, savePartsSettings, type PartsSettings } from './upcoming-api';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function PartsFlowSettingsSection({ companyId, readOnly = false }: { companyId: string; readOnly?: boolean }) {
  const q = useQuery({ queryKey: ['parts-settings', companyId], queryFn: () => getPartsSettings(companyId), enabled: !!companyId });
  const [s, setS] = useState<PartsSettings>(DEFAULT_PARTS_SETTINGS);
  const [days, setDays] = useState(String(DEFAULT_PARTS_SETTINGS.urgentDays));
  useEffect(() => {
    if (q.data) { setS(q.data); setDays(String(q.data.urgentDays)); }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const n = Number(days.replace(',', '.'));
      if (!Number.isInteger(n) || n < 0 || n > 60) throw new Error(t('upcomingParts.errDays'));
      return savePartsSettings(companyId, { ...s, urgentDays: n });
    },
    onSuccess: () => { toast.success(t('feedback.saved')); q.refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold">{t('upcomingParts.settingsTitle')}</h2>
        {q.data && !readOnly && <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{t('action.save')}</Button>}
      </div>
      {q.data === null && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('upcomingParts.migrationMissing')}</p>}
      {q.data && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label={t('upcomingParts.setMode')}>
              <Select value={s.mode} onValueChange={(v) => isPickingMode(v) && setS({ ...s, mode: v })} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PICKING_MODES.map((m) => <SelectItem key={m} value={m}>{t(`upcomingParts.mode_${m}`)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('upcomingParts.setEveHour')}>
              <Select value={String(s.eveHour)} onValueChange={(v) => setS({ ...s, eveHour: Number(v) })} disabled={readOnly || s.mode !== 'veille'}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={String(h)}>{`${String(h).padStart(2, '0')}:00`}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('upcomingParts.setUrgentDays')}>
              <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="text-right tabular-nums" disabled={readOnly} />
            </Field>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">{t(`upcomingParts.modeHint_${s.mode}`)}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t('upcomingParts.urgentHint')}{' '}
            <Link to="/parts/upcoming" className="font-medium underline">{t('upcomingParts.openScreen')}</Link>
          </p>
        </>
      )}
    </section>
  );
}
