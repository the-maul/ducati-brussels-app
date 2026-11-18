/**
 * Rattrapage G8 (18/11/2026, lot parc) — vente de moto neuve : cocher les options du catalogue du
 * modele ; elles deviennent des lignes du document et le vendeur voit « PV vehicule + options ».
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { listOptionModels, listOptions } from './options-api';
import { groupOptions, optionsToLines, suggestOptionModel, vehiclePlusOptions, type OptionLine } from './options-rules';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ')} €`;

export function OptionsPickDialog({ companyId, hint, vehicleTtc, onInsert, onClose }: {
  companyId: string;
  /** Article de la moto et texte (modele) des lignes du document : propose le bon modele. */
  hint: { articleId?: string | null; text?: string | null };
  /** PV TTC de la moto deja sur le document (pour « PV vehicule + options »). */
  vehicleTtc: number;
  onInsert: (lines: OptionLine[]) => void; onClose: () => void;
}) {
  const mq = useQuery({ queryKey: ['option-models', companyId], queryFn: () => listOptionModels(companyId) });
  const [modelId, setModelId] = useState<string>('');
  useEffect(() => {
    if (modelId || !mq.data?.length) return;
    const s = suggestOptionModel(mq.data, hint);
    if (s) setModelId(s.id);
  }, [mq.data, hint, modelId]);
  const oq = useQuery({ queryKey: ['vehicle-options', modelId], queryFn: () => listOptions(modelId), enabled: !!modelId });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const options = oq.data ?? [];
  const chosen = options.filter((o) => checked.has(o.id));
  const sums = vehiclePlusOptions(vehicleTtc, chosen);
  const toggle = (id: string, on: boolean) => setChecked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('parcG8.optionsPickTitle')}</DialogTitle></DialogHeader>
        {mq.error ? <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(mq.error as Error).message}</p> : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[12px]">{t('parcG8.optionModel')}</Label>
              <Select value={modelId} onValueChange={(v) => { setModelId(v); setChecked(new Set()); }}>
                <SelectTrigger><SelectValue placeholder={t('parcG8.pickModel')} /></SelectTrigger>
                <SelectContent>
                  {(mq.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.code} — {m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {oq.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {modelId && !oq.isLoading && options.length === 0 && <p className="text-sm text-muted-foreground">{t('parcG8.noOption')}</p>}
            <div className="max-h-[45vh] space-y-3 overflow-auto">
              {groupOptions(options).map((g) => (
                <div key={g.group || '_'}>
                  {g.group && <p className="mb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{g.group}</p>}
                  <ul className="space-y-1">
                    {g.items.map((o) => (
                      <li key={o.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                        <Checkbox checked={checked.has(o.id)} onCheckedChange={(v) => toggle(o.id, v === true)} />
                        <span className="font-mono text-[12px] text-muted-foreground">{o.code}</span>
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        <span className="font-data tabular-nums">{eur(o.sale_price_ttc)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-1 rounded-md border border-border bg-card p-3 font-data text-sm tabular-nums">
              <dt className="text-muted-foreground">{t('parcG8.vehiclePrice')}</dt><dd className="text-right">{eur(vehicleTtc)}</dd>
              <dt className="text-muted-foreground">{t('parcG8.optionsTtc')}</dt><dd className="text-right">{eur(sums.optionsTtc)}</dd>
              <dt className="font-bold">{t('parcG8.vehiclePlusOptions')}</dt><dd className="text-right font-bold">{eur(sums.totalTtc)}</dd>
              <dt className="text-muted-foreground">{t('parcG8.optionsMargin')}</dt><dd className="text-right">{eur(sums.optionsMarginHt)}</dd>
            </dl>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => onInsert(optionsToLines(chosen, `${t('parcG8.optionPrefix')} `))} disabled={chosen.length === 0}><ListPlus /> {t('parcG8.addOptions')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
