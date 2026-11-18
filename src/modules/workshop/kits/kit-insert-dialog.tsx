/**
 * Rattrapage G8 (18/11/2026, lot parc) — fenetre « Inserer un kit / forfait » commune a l'OR et
 * aux documents de vente. Kits d'entretien (ceux de la moto en tete) et forfaits d'article ;
 * apercu des lignes et du total HT avant insertion. Regles : insert-rules.ts.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Package, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { kitComponents, listKitChoices, pricedArticles, type KitChoice } from './insert-api';
import { insertLinesTotalHt, kitInsertLines, type InsertLine } from './insert-rules';
import { loadHourlyRateHt } from '../maintenance-api';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function KitInsertDialog({ companyId, modelYearId, effectiveHt, onInsert, onClose }: {
  companyId: string; modelYearId?: string | null; effectiveHt?: (ht: number, vat: number) => number;
  onInsert: (lines: InsertLine[]) => void; onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const [choice, setChoice] = useState<KitChoice | null>(null);
  const [mode, setMode] = useState<'detail' | 'forfait'>('detail');
  const [times, setTimes] = useState('1');

  // Taux horaire de l'atelier : la MO d'un forfait sans prix propre le prend (decision Q40, 18/11).
  const rateQ = useQuery({ queryKey: ['workshop-hourly-rate', companyId], queryFn: () => loadHourlyRateHt(companyId) });
  const list = useQuery({ queryKey: ['kit-choices', companyId, deb, modelYearId], queryFn: () => listKitChoices(companyId, deb, modelYearId) });
  const preview = useQuery({
    queryKey: ['kit-preview', choice?.source, choice?.id, mode, times, rateQ.data],
    enabled: !!choice && !rateQ.isLoading,
    queryFn: async () => {
      const comps = await kitComponents(choice!);
      const prices = await pricedArticles([...comps.map((c) => c.articleId ?? ''), choice!.source === 'forfait' ? choice!.id : '']);
      return kitInsertLines({
        title: `${t('parcG8.kitLineTitle')} ${choice!.label}`, components: comps, articles: prices, effectiveHt,
        times: Number(times.replace(',', '.')) || 1, mode: choice!.source === 'forfait' ? mode : 'detail',
        forfait: choice!.source === 'forfait' ? prices.get(choice!.id) ?? null : null,
        labourRateHt: rateQ.data ?? null,
      });
    },
  });
  const lines = preview.data ?? [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{t('parcG8.kitInsertTitle')}</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('parcG8.kitSearch')} className="pl-9" autoFocus />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ul className="max-h-[50vh] space-y-1 overflow-auto">
            {list.isLoading && <li><Loader2 className="size-4 animate-spin text-muted-foreground" /></li>}
            {(list.data ?? []).map((k) => (
              <li key={`${k.source}:${k.id}`}>
                <button type="button" onClick={() => { setChoice(k); setMode(k.forfaitPriceTtc ? 'forfait' : 'detail'); }}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent ${choice?.id === k.id ? 'border-primary bg-accent' : 'border-border'}`}>
                  <Package className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{k.label}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {k.source === 'entretien' ? t('parcG8.kitSourceService') : t('parcG8.kitSourceForfait')} · {k.detail}
                      {k.forfaitPriceTtc != null ? ` · ${eur(k.forfaitPriceTtc)}` : ''}
                    </span>
                  </span>
                  {k.forMoto && <StatusBadge tone="success" label={t('parcG8.kitForMoto')} />}
                </button>
              </li>
            ))}
            {!list.isLoading && (list.data ?? []).length === 0 && <li className="text-sm text-muted-foreground">{t('parcG8.kitNone')}</li>}
          </ul>
          <div className="space-y-2">
            {!choice ? <p className="text-sm text-muted-foreground">{t('parcG8.kitPick')}</p> : (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-[12px]">{t('parcG8.kitTimes')}</Label>
                    <Input value={times} onChange={(e) => setTimes(e.target.value)} inputMode="decimal" className="w-20 text-right tabular-nums" />
                  </div>
                  {choice.source === 'forfait' && (
                    <div className="flex gap-1">
                      <Button size="sm" variant={mode === 'detail' ? 'default' : 'outline'} onClick={() => setMode('detail')}>{t('parcG8.kitModeDetail')}</Button>
                      <Button size="sm" variant={mode === 'forfait' ? 'default' : 'outline'} onClick={() => setMode('forfait')} disabled={!choice.forfaitPriceTtc}>{t('parcG8.kitModeForfait')}</Button>
                    </div>
                  )}
                </div>
                {preview.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : preview.error ? (
                  <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(preview.error as Error).message}</p>
                ) : (
                  <div className="max-h-[40vh] overflow-auto rounded-md border border-border">
                    <table className="w-full border-collapse font-data text-[12px]">
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={i} className="border-b border-border last:border-0">
                            <td className={`px-2 py-1 ${l.type === 'texte' ? 'italic text-muted-foreground' : ''}`}>{l.designation}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{l.type === 'texte' ? '' : String(l.quantity).replace('.', ',')}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{l.type === 'texte' ? '' : eur(l.unit_price_ht)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-right font-data text-sm tabular-nums">{t('parcG8.kitTotalHt')} <b>{eur(insertLinesTotalHt(lines))}</b></p>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => onInsert(lines)} disabled={!choice || lines.length === 0 || preview.isLoading}><Package /> {t('parcG8.kitInsert')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
