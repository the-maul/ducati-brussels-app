/**
 * M4 — « Infos commandes client » (G8, fenêtre ouverte automatiquement après une réception) : pour chaque
 * article reçu, les clients qui l'attendent (commande de pièces, réservation / bon de commande, OR ouvert),
 * avec leur téléphone, le casier, et « client informé » (trace append-only purchase_customer_notices).
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PhoneCall, CheckCircle2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { getReceiptCustomerInfos, markCustomerInformed, type CustomerInfoRow } from './g8-api';
import { INFORM_CHANNELS, type InformChannel } from './g8-rules';
import { t, fillVars } from '@/lib/i18n';

const qtyFmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export function useReceiptCustomerInfos(receiptId: string | null) {
  return useQuery({ queryKey: ['receipt-infos', receiptId], queryFn: () => getReceiptCustomerInfos(receiptId!), enabled: !!receiptId });
}

export function CustomerInfosDialog({ receiptId, open, onOpenChange }: { receiptId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useReceiptCustomerInfos(receiptId);
  const qc = useQueryClient();
  const [channel, setChannel] = useState<InformChannel>('telephone');
  const [busy, setBusy] = useState<string | null>(null);
  const rows = q.data ?? [];

  const inform = async (r: CustomerInfoRow) => {
    const key = `${r.source_kind}:${r.source_id}:${r.article_id}`;
    setBusy(key);
    try {
      await markCustomerInformed({ receiptId, articleId: r.article_id, sourceKind: r.source_kind, sourceId: r.source_id, contactId: r.contact_id, channel });
      toast.success(fillVars(t('purchasesG8.informedOk'), { name: r.contact_name ?? '' }));
      qc.invalidateQueries({ queryKey: ['receipt-infos', receiptId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : t('purchases.errSave')); }
    setBusy(null);
  };

  const link = (r: CustomerInfoRow) => {
    if (r.source_kind === 'part_order') return <Link to="/orders/$orderId" params={{ orderId: r.source_id }} className="text-info underline">{r.source_number ?? '—'}</Link>;
    if (r.source_kind === 'document') return <Link to="/sales/$documentId" params={{ documentId: r.source_id }} className="text-info underline">{r.source_number ?? '—'}</Link>;
    return <Link to="/workshop/$orId" params={{ orId: r.source_id }} className="text-info underline">{r.source_number ?? '—'}</Link>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="size-5" /> {t('purchasesG8.infosTitle')}</DialogTitle></DialogHeader>
        <p className="text-[12px] text-muted-foreground">{t('purchasesG8.infosHint')}</p>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">{t('purchasesG8.informChannel')}</span>
          <Select value={channel} onValueChange={(v) => setChannel(v as InformChannel)}>
            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{INFORM_CHANNELS.map((c) => <SelectItem key={c} value={c}>{t(`purchasesG8.channel_${c}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {q.isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {q.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(q.error as Error).message}</p>}
        {!q.isLoading && rows.length === 0 && <p className="py-4 text-center text-[13px] text-muted-foreground">{t('purchasesG8.infosEmpty')}</p>}
        {rows.length > 0 && (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {[t('purchasesG8.colRef'), t('purchasesG8.colReceivedQty'), t('purchases.colBin'), t('purchasesG8.colDocument'), t('purchasesG8.colClient'),
                    t('purchasesG8.colPhone'), t('purchasesG8.colNeeded'), t('purchasesG8.colInformed'), ''].map((h, i) => (
                    <th key={i} className="px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.source_kind}:${r.source_id}:${r.article_id}`;
                  return (
                    <tr key={`${r.receipt_line_id}-${key}`} className="border-t border-border">
                      <td className="px-2 py-1.5"><span className="font-mono text-[12px]">{r.reference ?? ''}</span><span className="block text-[12px] text-muted-foreground">{r.designation}</span></td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qtyFmt(r.qty_received)}</td>
                      <td className="px-2 py-1.5 font-mono text-[12px]">{r.bin_location ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        <span className="block text-[11px] text-muted-foreground">{t(`purchasesG8.source_${r.source_kind}`)}{r.source_date ? ` · ${r.source_date}` : ''}</span>
                        {link(r)}
                        {r.ordered_for && <span className="ml-1"><StatusBadge tone="info" label={t('purchasesG8.orderedFor')} /></span>}
                        {r.via_kind && <span className="block text-[11px] text-muted-foreground">{t(`partPath.kind_${r.via_kind}`)}{r.via_number ? ` · ${r.via_number}` : ''}</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.contact_id ? <Link to="/clients/$contactId" params={{ contactId: r.contact_id }} className="text-info underline">{r.contact_name ?? '—'}</Link>
                          : <span className="text-muted-foreground">{t('purchasesG8.shopStock')}</span>}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[12px]">{r.contact_phone ? <a href={`tel:${r.contact_phone}`} className="text-info underline">{r.contact_phone}</a> : '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qtyFmt(r.qty_needed)}</td>
                      <td className="px-2 py-1.5">
                        {r.informed_at
                          ? <StatusBadge tone="success" icon={CheckCircle2} label={`${t(`purchasesG8.channel_${r.informed_channel ?? 'autre'}`)} ${r.informed_at.slice(0, 10)}`} />
                          : <StatusBadge tone="warning" label={t('purchasesG8.notInformed')} />}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {r.contact_id && (
                          <Button size="sm" variant="outline" disabled={busy === key} onClick={() => inform(r)}>
                            {busy === key ? <Loader2 className="animate-spin" /> : <PhoneCall />} {t('purchasesG8.markInformed')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('proposal.close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
