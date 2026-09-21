/**
 * Mission 03 — bouton admin « Aligner le DMS sur le site (stock et prix) » (décision W-10, 21/09).
 * Aperçu des écarts (rien n'est écrit), confirmation, application par la fonction SQL shopify_realign
 * (mouvements d'inventaire + changements de prix tracés), puis compte rendu. Rien n'est écrit sur Shopify.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Info, Loader2, Package, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge } from '@/components/status-badge';
import { useRoundSalePrices } from '@/lib/pricing';
import { shopifyRealign, type RealignReport } from './shopify-sync-api';
import { t } from '@/lib/i18n';

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);
}
const errMsg = (e: unknown) => (e as { message?: string } | null)?.message ?? String(e);
const fmtEur = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
const fmtQty = (n: number | null | undefined) => (n == null ? '—' : String(Number(n)));
const ONE_HOUR = 60 * 60 * 1000;

function Counter({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="text-[18px] font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function ShopifyRealignButton({ companyId, disabled }: { companyId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <ArrowRightLeft /> {t('shopifyRealign.button')}
      </Button>
      {open && <ShopifyRealignDialog companyId={companyId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShopifyRealignDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const roundUp = useRoundSalePrices(companyId);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<RealignReport | null>(null);

  const preview = useQuery({
    queryKey: ['shopify-realign-preview', companyId],
    queryFn: () => shopifyRealign(companyId, false),
    staleTime: 0,
    gcTime: 0,
  });

  const apply = useMutation({
    mutationFn: () => shopifyRealign(companyId, true),
    onSuccess: (r) => {
      setReport(r);
      toast.success(fill(t('shopifyRealign.done'), { stock: r.stock_moves, price: r.price_changes, pieces: r.pieces_after }));
      qc.invalidateQueries({ queryKey: ['shopify-products', companyId] });
      qc.invalidateQueries({ queryKey: ['shopify-sync-status', companyId] });
    },
    onError: (e) => toast.error(`${t('shopifyRealign.err')} : ${errMsg(e)}`),
  });

  const data = report ?? preview.data;
  const snapshotAt = data?.snapshot_at ? new Date(data.snapshot_at) : null;
  const snapshotOld = snapshotAt ? Date.now() - snapshotAt.getTime() > ONE_HOUR : true;
  const rows = data?.rows ?? [];
  const toDo = !report && data ? data.stock_to_change + data.price_to_change : 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{report ? t('shopifyRealign.reportTitle') : t('shopifyRealign.title')}</DialogTitle>
          <DialogDescription>{t('shopifyRealign.intro')}</DialogDescription>
        </DialogHeader>

        {preview.isLoading && !report ? (
          <p className="flex items-center gap-2 text-[13px]"><Loader2 className="size-4 animate-spin" /> {t('shopifyRealign.loading')}</p>
        ) : preview.error && !report ? (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('shopifyRealign.err')} : {errMsg(preview.error)}</p>
        ) : data ? (
          <>
            {snapshotAt && (
              <p className="text-[13px] text-muted-foreground">
                {fill(t('shopifyRealign.snapshot'), { date: snapshotAt.toLocaleString('fr-BE') })}
              </p>
            )}
            {snapshotOld && !report && (
              <p className="flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
                <AlertTriangle className="size-4" /> {t('shopifyRealign.snapshotOld')}
              </p>
            )}
            {roundUp && (
              <p className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
                <Info className="size-4" /> {t('shopifyRealign.rounding')}
              </p>
            )}
            {report && (
              <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
                <CheckCircle2 className="size-4" />
                {fill(t('shopifyRealign.reportText'), {
                  stock: report.stock_moves, price: report.price_changes, before: report.pieces_before, after: report.pieces_after,
                })}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Counter label={t('shopifyRealign.cLinked')} value={data.linked} />
              <Counter label={t('shopifyRealign.cStock')} value={report ? report.stock_moves : data.stock_to_change} />
              <Counter label={t('shopifyRealign.cPrice')} value={report ? report.price_changes : data.price_to_change} />
              <Counter label={t('shopifyRealign.cPieces')} value={`${fmtQty(data.pieces_before)} → ${fmtQty(data.pieces_after)}`} />
              <Counter label={t('shopifyRealign.cNotes')} value={data.with_notes} />
            </div>

            {rows.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t('shopifyRealign.nothing')}</p>
            ) : (
              <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
                <table className="w-full border-collapse font-data text-[13px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="text-left text-[12px] uppercase text-muted-foreground">
                      <th className="px-2 py-1.5">{t('shopifyRealign.colRef')}</th>
                      <th className="px-2 py-1.5">{t('shopifyRealign.colDesignation')}</th>
                      <th className="px-2 py-1.5 text-right">{t('shopifyRealign.colStock')}</th>
                      <th className="px-2 py-1.5 text-right">{t('shopifyRealign.colHt')}</th>
                      <th className="px-2 py-1.5 text-right">{t('shopifyRealign.colTtc')}</th>
                      <th className="px-2 py-1.5">{t('shopifyRealign.colNotes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.article_id} className="border-t border-border align-top">
                        <td className="px-2 py-1 font-mono text-[12px]">{r.reference}</td>
                        <td className="px-2 py-1">{r.designation}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                          {r.stock_change
                            ? <span className="font-semibold">{fmtQty(r.stock_before)} → {fmtQty(r.stock_after)}</span>
                            : fmtQty(r.stock_before)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                          {r.price_change
                            ? <span className="font-semibold">{fmtEur(r.ht_before)} → {fmtEur(r.ht_after)}</span>
                            : fmtEur(r.ht_before)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                          {r.price_change ? <>{fmtEur(r.ttc_before)} → {fmtEur(r.ttc_after)}</> : fmtEur(r.ttc_before)}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex flex-wrap gap-1">
                            {r.stock_change && <StatusBadge tone={report ? 'success' : 'warning'} icon={Package} label={t('shopifyRealign.stStock')} />}
                            {r.price_change && <StatusBadge tone={report ? 'success' : 'warning'} icon={Tag} label={t('shopifyRealign.stPrice')} />}
                          </div>
                          {r.notes.map((n) => <div key={n} className="text-[11px] text-muted-foreground">{n}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!report && (
              <div className="flex justify-end">
                <Button onClick={() => setConfirm(true)} disabled={apply.isPending || toDo === 0}>
                  {apply.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  {apply.isPending ? t('shopifyRealign.applying') : fill(t('shopifyRealign.apply'), { stock: data.stock_to_change, price: data.price_to_change })}
                </Button>
              </div>
            )}
          </>
        ) : null}

        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('shopifyRealign.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {fill(t('shopifyRealign.confirmText'), { stock: data?.stock_to_change ?? 0, price: data?.price_to_change ?? 0 })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirm(false); apply.mutate(); }}>{t('shopifyRealign.confirmTitle')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
