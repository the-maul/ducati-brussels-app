/**
 * M8 — Parcours mecanicien, lot C (19/11/2026) : reglage « Photos de réception » dans les reglages
 * du planning atelier. La serie par defaut (avant, arriere, gauche, droite, compteur, plaque / VIN)
 * se modifie : ordre, obligatoire ou conseillee, cases ajoutees par l'atelier (libelle), retour a la
 * serie d'usine. Les photos de degats restent toujours possibles en plus.
 * Migration 20261119270000 absente : un message, rien d'autre.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { getReceptionSlots, receptionSchemaReady, saveReceptionSlots } from './api';
import { DEFAULT_SLOT_CODES, codeFromLabel, slotLabel, validateSlots, type ReceptionSlot } from './rules';

export function ReceptionSettingsSection({ companyId }: { companyId: string }) {
  const schema = useQuery({ queryKey: ['reception-schema'], queryFn: receptionSchemaReady, staleTime: Infinity });
  const q = useQuery({ queryKey: ['reception-slots', companyId], queryFn: () => getReceptionSlots(companyId), enabled: schema.data === true });
  const [slots, setSlots] = useState<ReceptionSlot[]>([]);
  const [newLabel, setNewLabel] = useState('');
  useEffect(() => { if (q.data) setSlots(q.data); }, [q.data]);

  const save = useMutation({
    mutationFn: (v: ReceptionSlot[] | null) => {
      if (v) { const err = validateSlots(v); if (err) throw new Error(t(err)); }
      return saveReceptionSlots(companyId, v);
    },
    onSuccess: (s) => { setSlots(s); toast.success(t('feedback.saved')); void q.refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });

  const move = (i: number, d: -1 | 1) => setSlots((s) => {
    const j = i + d;
    if (j < 0 || j >= s.length) return s;
    const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-bold">{t('reception.settingsTitle')}</h2>
          <p className="text-[12px] text-muted-foreground">{t('reception.settingsHint')}</p>
        </div>
        {schema.data === true && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => save.mutate(null)} disabled={save.isPending}><RotateCcw /> {t('reception.settingsReset')}</Button>
            <Button size="sm" onClick={() => save.mutate(slots)} disabled={save.isPending}>{t('action.save')}</Button>
          </div>
        )}
      </div>
      {schema.data === false && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('reception.migrationMissing')}</p>}
      {schema.data === true && (
        <>
          <ul className="divide-y divide-border rounded-md border border-border">
            {slots.map((s, i) => (
              <li key={s.code} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[14px]">
                <span className="w-6 text-right font-data tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{slotLabel(s, t)}</span>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={s.required} onChange={(e) => setSlots((x) => x.map((y) => (y.code === s.code ? { ...y, required: e.target.checked } : y)))} className="size-4 accent-[var(--ducati-red)]" />
                  {t('reception.required')}
                </label>
                <Button size="icon" variant="ghost" aria-label={t('reception.moveUp')} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp /></Button>
                <Button size="icon" variant="ghost" aria-label={t('reception.moveDown')} onClick={() => move(i, 1)} disabled={i === slots.length - 1}><ArrowDown /></Button>
                <Button size="icon" variant="ghost" aria-label={t('reception.remove')} onClick={() => setSlots((x) => x.filter((y) => y.code !== s.code))}><Trash2 /></Button>
              </li>
            ))}
            {!slots.length && <li className="px-3 py-2 text-[13px] text-muted-foreground">{t('reception.settingsEmpty')}</li>}
          </ul>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t('reception.settingsNewPlaceholder')} className="w-64" maxLength={60} />
            <Button
              variant="outline" disabled={!newLabel.trim()}
              onClick={() => {
                const label = newLabel.trim();
                const code = codeFromLabel(label, slots.map((s) => s.code));
                setSlots((x) => [...x, { code, required: false, ...(DEFAULT_SLOT_CODES.includes(code) ? {} : { label }) }]);
                setNewLabel('');
              }}
            ><Plus /> {t('reception.settingsAdd')}</Button>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('reception.settingsDamageNote')}</p>
        </>
      )}
    </section>
  );
}
