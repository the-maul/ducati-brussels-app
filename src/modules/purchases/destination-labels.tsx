/**
 * M4 / M5 — C2 : étiquettes de destination « pour qui » (client, n° d'OR ou de commande, date du RDV,
 * référence, désignation, casier), à la réception et à la préparation. Réutilise le système d'étiquettes
 * (B12) : formats, imprimante du poste, édition immédiate OU différée cumulée par poste.
 * Réutilisable : `<DestinationLabelsButton kind="repair_order" id={orId} companyId={...} />`, ou le lien
 * /stock/labels?destKind=repair_order&destId=… (destinationLabelsSearch).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, Printer, Tag, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { useDeviceSetup } from '@/lib/devices/use-devices';
import { fillVars, t } from '@/lib/i18n';
import { printTemplateLabels } from '@/modules/articles/labels/device-print';
import { renderLabelSvg } from '@/modules/articles/labels/render';
import { listTemplates } from '@/modules/articles/labels/templates-api';
import type { LabelTemplateConfig } from '@/modules/articles/labels/template-types';
import { finishPendingLabels } from '@/modules/stock/g8-api';
import { destinationDefaultQty, destinationDocLine, destinationLabelData, type DestinationKind, type DestinationRow } from './part-path';
import { enqueueDestinationLabels, listDestinationLabels, listPendingDestinationLabels, type PendingDestination } from './part-path-api';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Pas de prix sur une étiquette « pour qui » ; le reste suit le format choisi. */
const noPrice = (c: LabelTemplateConfig): LabelTemplateConfig => ({
  ...c,
  elements: c.elements.map((e) => (e.key === 'price_ttc' || e.key === 'price_ht' || e.key === 'price_promo' || e.key === 'discount' ? { ...e, visible: false } : e)),
});

function useLabelPrinter(companyId: string) {
  const devices = useDeviceSetup(companyId);
  const { activeCompany } = useAuth();
  const templatesQ = useQuery({ queryKey: ['label-templates', companyId], queryFn: () => listTemplates(companyId) });
  const template = (templatesQ.data ?? []).find((x) => x.is_default) ?? templatesQ.data?.[0] ?? null;
  const store = activeCompany?.name ?? '';
  const rdv = t('partPath.labelRdv');
  const print = async (items: { row: DestinationRow; qty: number }[]): Promise<boolean> => {
    if (!template) { toast.error(t('stockG8.labels.noTemplate')); return false; }
    const r = await printTemplateLabels(devices.ctx, noPrice(template.config),
      items.map(({ row, qty }) => ({ data: destinationLabelData(row, store, rdv), qty })));
    if (!r.ok) { toast.error(`${t(`devices.result.${r.code}`)}${r.detail ? ` (${r.detail})` : ''}`); return false; }
    toast.success(r.code === 'sent' ? t('devices.result.sent') : t('stockG8.labels.printed'));
    return true;
  };
  return { print, template, store, rdv, workstationId: devices.workstation?.id ?? null };
}

export function DestinationLabelsDialog({ companyId, kind, id, open, onOpenChange }: {
  companyId: string; kind: DestinationKind; id: string; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['destination-labels', kind, id], queryFn: () => listDestinationLabels(kind, id), enabled: open });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const { print, template, store, rdv, workstationId } = useLabelPrinter(companyId);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [qty, setQty] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);

  // Coché par défaut : les pièces commandées pour ce client (les autres sont seulement proposées).
  useEffect(() => {
    setPicked(new Set(rows.flatMap((r, i) => (r.isDirect ? [i] : []))));
    setQty({});
  }, [rows]);

  const qtyOf = (i: number) => qty[i] ?? destinationDefaultQty(rows[i]);
  const selection = rows.flatMap((row, i) => (picked.has(i) && qtyOf(i) > 0 ? [{ row, qty: qtyOf(i) }] : []));
  const total = selection.reduce((s, x) => s + x.qty, 0);
  const preview = selection[0] && template
    ? renderLabelSvg(noPrice(template.config), destinationLabelData(selection[0].row, store, rdv), new Date(), true)
    : null;

  const now = async () => {
    setBusy(true);
    try { if (await print(selection)) onOpenChange(false); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const later = async () => {
    setBusy(true);
    try {
      const n = await enqueueDestinationLabels(companyId, selection, { workstationId, source: kind, sourceRef: id });
      toast.success(fillVars(t('stockG8.labels.queued'), { n }));
      qc.invalidateQueries({ queryKey: ['destination-pending', companyId] });
      onOpenChange(false);
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag className="size-5" /> {t('partPath.labelsTitle')}</DialogTitle>
          <DialogDescription>{t('partPath.labelsHint')}</DialogDescription>
        </DialogHeader>
        {q.isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {q.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errMsg(q.error)}</p>}
        {!q.isLoading && !q.error && rows.length === 0 && <p className="py-4 text-center text-[13px] text-muted-foreground">{t('partPath.labelsEmpty')}</p>}
        {rows.length > 0 && (
          <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="w-10 px-2 py-2" />
                  {['colPart', 'colFor', 'labelBin', 'labelQty'].map((h) => (
                    <th key={h} className="px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`partPath.${h}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.articleId}-${r.sourceKind}-${r.sourceId}-${i}`} className="border-t border-border">
                    <td className="px-2 py-1 text-center">
                      <Checkbox aria-label={r.reference ?? ''} checked={picked.has(i)} onCheckedChange={(v) => setPicked((s) => { const n = new Set(s); if (v === true) n.add(i); else n.delete(i); return n; })} />
                    </td>
                    <td className="px-2 py-1"><span className="font-mono text-[12px]">{r.reference ?? '—'}</span><span className="block text-[12px] text-muted-foreground">{r.designation}</span></td>
                    <td className="px-2 py-1">{r.customerName ?? t('partPath.forStock')}<span className="block font-mono text-[11px] text-muted-foreground">{destinationDocLine(r.docNumber, r.appointmentAt, rdv) ?? ''}</span></td>
                    <td className="px-2 py-1 font-mono text-[12px]">{r.bin ?? '—'}</td>
                    <td className="px-2 py-1">
                      <Input type="number" min="0" step="1" value={String(qtyOf(i))} aria-label={t('partPath.labelQty')} className="h-11 w-20 text-right tabular-nums"
                        onChange={(e) => setQty((m) => ({ ...m, [i]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {preview && <div className="overflow-auto rounded border border-border bg-muted/40 p-3" dangerouslySetInnerHTML={{ __html: preview.replace('<svg ', '<svg style="width:100%;max-width:300px" ') }} />}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={later} disabled={busy || selection.length === 0}><Clock /> {t('partPath.labelsLater')}</Button>
          <Button className="min-h-11" onClick={now} disabled={busy || selection.length === 0 || !template}>
            {busy ? <Loader2 className="animate-spin" /> : <Printer />} {fillVars(t('partPath.labelsNow'), { n: total })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bouton réutilisable (réception, préparation, commande, dossier atelier). */
export function DestinationLabelsButton({ companyId, kind, id, className }: { companyId: string; kind: DestinationKind; id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" className={className} onClick={() => setOpen(true)}><Tags /> {t('partPath.labelsButton')}</Button>
      {open && <DestinationLabelsDialog companyId={companyId} kind={kind} id={id} open={open} onOpenChange={setOpen} />}
    </>
  );
}

/** Étiquettes « pour qui » en attente, par poste (écran Étiquetage). */
export function DestinationPendingPanel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['destination-pending', companyId], queryFn: () => listPendingDestinationLabels(companyId) });
  const { print } = useLabelPrinter(companyId);
  const [busy, setBusy] = useState(false);
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['destination-pending', companyId] });
  const groups = new Map<string, PendingDestination[]>();
  for (const r of rows) groups.set(r.workstationId ?? '', [...(groups.get(r.workstationId ?? '') ?? []), r]);

  const printGroup = async (g: PendingDestination[]) => {
    setBusy(true);
    try {
      if (await print(g.map((r) => ({ row: r.row, qty: r.qty })))) {
        await finishPendingLabels(companyId, g.flatMap((r) => r.ids), 'imprime');
        refresh();
      }
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const remove = async (ids: number[]) => {
    try { await finishPendingLabels(companyId, ids, 'retire'); toast.success(t('stockG8.labels.removed')); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <section className="mb-5 rounded-md border border-border bg-card p-3">
      <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><Tags className="size-4" /> {t('partPath.labelsPending')}</h2>
      {[...groups.values()].map((g) => (
        <div key={g[0].workstationId ?? 'none'} className="mt-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[13px] font-bold">{g[0].workstationName ?? t('partPath.noWorkstation')}</span>
            <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => printGroup(g)}>{busy ? <Loader2 className="animate-spin" /> : <Printer />} {fillVars(t('partPath.labelsNow'), { n: g.reduce((s, r) => s + r.qty, 0) })}</Button>
          </div>
          <ul className="divide-y divide-border text-[13px]">
            {g.map((r) => (
              <li key={r.ids[0]} className="flex items-center justify-between gap-2 py-1">
                <span><span className="font-mono text-[12px]">{r.row.reference}</span> · {r.row.customerName ?? t('partPath.forStock')} · <span className="font-mono text-[12px]">{destinationDocLine(r.row.docNumber, r.row.appointmentAt, t('partPath.labelRdv')) ?? ''}</span> · <b className="tabular-nums">{r.qty}</b></span>
                <Button size="sm" variant="ghost" className="min-h-11" aria-label={t('stockG8.labels.remove')} onClick={() => remove(r.ids)}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
