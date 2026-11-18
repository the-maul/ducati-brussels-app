/**
 * Rattrapage G8 (18/11/2026, lot parc) — « Catalogues d'options » de G8 : les MODELES (code,
 * libelle ; Ajouter, Dupliquer, Modifier, Supprimer) et les OPTIONS du modele (groupe, code,
 * libelle, prix d'achat HT, prix de vente TTC, infos). Reprises dans la vente de moto neuve.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import {
  deleteOption, deleteOptionModel, duplicateOptionModel, listOptionModels, listOptions, saveOption, saveOptionModel,
  type OptionModel,
} from './options-api';
import { vehiclePlusOptions, type VehicleOption } from './options-rules';

const eur = (n: number | null | undefined) =>
  n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

type OptForm = { id: string | null; group_code: string; code: string; label: string; pa: string; pv: string; vat: string; info: string };
const blankOpt = (): OptForm => ({ id: null, group_code: '', code: '', label: '', pa: '', pv: '', vat: '21', info: '' });

export function OptionsCatalogDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const mq = useQuery({ queryKey: ['option-models', companyId], queryFn: () => listOptionModels(companyId) });
  const models = mq.data ?? [];
  const [sel, setSel] = useState<OptionModel | null>(null);
  const [mForm, setMForm] = useState({ id: null as string | null, code: '', label: '' });
  const oq = useQuery({ queryKey: ['vehicle-options', sel?.id], queryFn: () => listOptions(sel!.id), enabled: !!sel });
  const options = oq.data ?? [];
  const [o, setO] = useState<OptForm>(blankOpt());
  const invModels = () => qc.invalidateQueries({ queryKey: ['option-models', companyId] });
  const invOpts = () => qc.invalidateQueries({ queryKey: ['vehicle-options', sel?.id] });
  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  const meta = { success: false, error: false };

  const saveModel = useMutation({
    meta, onError: onErr,
    mutationFn: () => saveOptionModel(companyId, { id: mForm.id, code: mForm.code, label: mForm.label, articleId: mForm.id ? sel?.article_id : null }),
    onSuccess: (id) => { invModels(); setSel({ id, code: mForm.code, label: mForm.label, article_id: sel?.article_id ?? null }); setMForm({ id: null, code: '', label: '' }); },
  });
  const dupModel = useMutation({
    meta, onError: onErr,
    mutationFn: (m: OptionModel) => duplicateOptionModel(m.id, `${m.code}-2`, `${m.label} (2)`),
    onSuccess: () => { invModels(); toast.success(t('parcG8.duplicated')); },
  });
  const delModel = useMutation({
    meta, onError: onErr,
    mutationFn: (id: string) => deleteOptionModel(id),
    onSuccess: () => { setSel(null); invModels(); },
  });
  const saveOpt = useMutation({
    meta, onError: onErr,
    mutationFn: () => saveOption(companyId, {
      id: o.id, model_id: sel!.id, group_code: o.group_code, code: o.code, label: o.label,
      purchase_price_ht: num(o.pa), sale_price_ttc: num(o.pv), vat_rate: num(o.vat || '21'), info: o.info,
      sort_order: o.id ? (options.find((x) => x.id === o.id)?.sort_order ?? 0) : options.length + 1,
    }),
    onSuccess: () => { setO(blankOpt()); invOpts(); },
  });
  const delOpt = useMutation({ meta, onError: onErr, mutationFn: (id: string) => deleteOption(id), onSuccess: invOpts });
  const sums = vehiclePlusOptions(0, options);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>{t('parcG8.optionsTitle')}</DialogTitle></DialogHeader>
        {mq.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(mq.error as Error).message}</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
          {/* Modeles */}
          <div className="space-y-2">
            <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('parcG8.optionModels')}</p>
            <ul className="max-h-[50vh] space-y-1 overflow-auto">
              {models.map((m) => (
                <li key={m.id} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${sel?.id === m.id ? 'border-primary bg-accent' : 'border-border'}`}>
                  <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => { setSel(m); setO(blankOpt()); }}>
                    <span className="font-mono text-[12px]">{m.code}</span> {m.label}
                  </button>
                  <button type="button" title={t('parcG8.edit')} onClick={() => { setSel(m); setMForm({ id: m.id, code: m.code, label: m.label }); }}><Pencil className="size-3.5 text-muted-foreground" /></button>
                  <button type="button" title={t('parcG8.duplicate')} onClick={() => dupModel.mutate(m)}><Copy className="size-3.5 text-muted-foreground" /></button>
                  <button type="button" title={t('parcG8.delete')} onClick={() => { if (window.confirm(t('parcG8.confirmDeleteModel'))) delModel.mutate(m.id); }}><Trash2 className="size-3.5 text-danger" /></button>
                </li>
              ))}
              {models.length === 0 && !mq.isLoading && <li className="text-sm text-muted-foreground">{t('parcG8.noOptionModel')}</li>}
            </ul>
            <div className="space-y-1.5 rounded-md border border-dashed border-border p-2">
              <Input placeholder={t('parcG8.code')} value={mForm.code} onChange={(e) => setMForm((f) => ({ ...f, code: e.target.value }))} />
              <Input placeholder={t('parcG8.label')} value={mForm.label} onChange={(e) => setMForm((f) => ({ ...f, label: e.target.value }))} />
              <Button size="sm" className="w-full" onClick={() => saveModel.mutate()} disabled={!mForm.code.trim() || !mForm.label.trim() || saveModel.isPending}>
                {saveModel.isPending ? <Loader2 className="animate-spin" /> : mForm.id ? <Save /> : <Plus />} {mForm.id ? t('action.save') : t('parcG8.addModel')}
              </Button>
            </div>
          </div>
          {/* Options du modele */}
          <div className="space-y-2">
            {!sel ? <p className="text-sm text-muted-foreground">{t('parcG8.pickModel')}</p> : (
              <>
                <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('parcG8.optionsOf')} {sel.code} — {sel.label}</p>
                <div className="max-h-[40vh] overflow-auto rounded-md border border-border">
                  <table className="w-full border-collapse font-data text-[13px]">
                    <thead className="sticky top-0 bg-muted"><tr>
                      {[t('parcG8.group'), t('parcG8.code'), t('parcG8.label'), t('parcG8.optPa'), t('parcG8.optPv'), t('parcG8.info'), ''].map((h, i) => (
                        <th key={i} className={`px-2 py-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${i === 3 || i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {options.map((x: VehicleOption) => (
                        <tr key={x.id} className="border-b border-border last:border-0">
                          <td className="px-2 py-1.5">{x.group_code ?? ''}</td>
                          <td className="px-2 py-1.5 font-mono text-[12px]">{x.code}</td>
                          <td className="px-2 py-1.5">{x.label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{eur(x.purchase_price_ht)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{eur(x.sale_price_ttc)}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{x.info ?? ''}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right">
                            <Button size="sm" variant="ghost" onClick={() => setO({ id: x.id, group_code: x.group_code ?? '', code: x.code, label: x.label, pa: String(x.purchase_price_ht), pv: String(x.sale_price_ttc), vat: String(x.vat_rate), info: x.info ?? '' })}><Pencil className="size-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => delOpt.mutate(x.id)}><Trash2 className="size-4 text-danger" /></Button>
                          </td>
                        </tr>
                      ))}
                      {options.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">{t('parcG8.noOption')}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="text-right font-data text-[12px] tabular-nums text-muted-foreground">
                  {t('parcG8.optionsTotals')} {eur(sums.optionsCostHt)} / {eur(sums.optionsTtc)}
                </p>
                <div className="grid grid-cols-2 gap-2 rounded-md border border-dashed border-border p-2 sm:grid-cols-4">
                  <F label={t('parcG8.group')}><Input value={o.group_code} onChange={(e) => setO({ ...o, group_code: e.target.value })} /></F>
                  <F label={t('parcG8.code')}><Input value={o.code} onChange={(e) => setO({ ...o, code: e.target.value })} /></F>
                  <F label={t('parcG8.label')} wide><Input value={o.label} onChange={(e) => setO({ ...o, label: e.target.value })} /></F>
                  <F label={t('parcG8.optPa')}><Input value={o.pa} inputMode="decimal" onChange={(e) => setO({ ...o, pa: e.target.value })} className="text-right tabular-nums" /></F>
                  <F label={t('parcG8.optPv')}><Input value={o.pv} inputMode="decimal" onChange={(e) => setO({ ...o, pv: e.target.value })} className="text-right tabular-nums" /></F>
                  <F label={t('parcG8.vat')}><Input value={o.vat} inputMode="decimal" onChange={(e) => setO({ ...o, vat: e.target.value })} className="text-right tabular-nums" /></F>
                  <F label={t('parcG8.info')}><Input value={o.info} onChange={(e) => setO({ ...o, info: e.target.value })} /></F>
                  <div className="col-span-full flex justify-end gap-2">
                    {o.id && <Button size="sm" variant="outline" onClick={() => setO(blankOpt())}>{t('action.cancel')}</Button>}
                    <Button size="sm" onClick={() => saveOpt.mutate()} disabled={!o.code.trim() || !o.label.trim() || saveOpt.isPending}>
                      {saveOpt.isPending ? <Loader2 className="animate-spin" /> : o.id ? <Save /> : <Plus />} {o.id ? t('action.save') : t('parcG8.addOption')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1 ${wide ? 'col-span-2' : ''}`}>
      <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
