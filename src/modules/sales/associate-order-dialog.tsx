/**
 * M6 — « Associer une commande en cours à ce client » (mission 05, carte 7).
 * Liste les commandes de pièces en cours pour l'article d'une ligne, avec la part de chacune :
 * pour ce client, pour le stock, pour un autre client (jamais comptée ici). Une quantité pour le
 * stock peut être réservée explicitement à ce client ; l'association est tracée et se retire.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, UserCheck, Warehouse, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { listOpenOrderLines, allocateOrderLine } from './on-order-api';
import { orderLineShare, type OnOrderWho, type OpenOrderLine } from './on-order';
import { t } from '@/lib/i18n';

const q = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

export function AssociateOrderDialog({ articleId, reference, designation, documentId, contactId, onClose }: {
  articleId: string; reference: string | null; designation: string; documentId: string; contactId: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const who: OnOrderWho = { contactId, documentId };
  const linesQ = useQuery({ queryKey: ['open-order-lines', articleId, documentId], queryFn: () => listOpenOrderLines(articleId, documentId) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['open-order-lines', articleId, documentId] });
    qc.invalidateQueries({ queryKey: ['doc-lines-stock', documentId] });
    qc.invalidateQueries({ queryKey: ['doc-allocations', documentId] });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('onOrder.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {reference ? <span className="mr-2 font-mono">{reference}</span> : null}{designation}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('onOrder.rule')}</p>

        {linesQ.isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {linesQ.data && linesQ.data.length === 0 && (
          <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">{t('onOrder.noneOpen')}</p>
        )}
        {linesQ.data && linesQ.data.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted">
                <tr>
                  <Th>{t('onOrder.colOrder')}</Th>
                  <Th>{t('onOrder.colFor')}</Th>
                  <Th className="text-right">{t('onOrder.colMine')}</Th>
                  <Th className="text-right">{t('onOrder.colStock')}</Th>
                  <Th className="text-right">{t('onOrder.colOther')}</Th>
                  <Th className="w-48" />
                </tr>
              </thead>
              <tbody>
                {linesQ.data.map((l) => <OrderRow key={l.line_id} line={l} who={who} documentId={documentId} onDone={refresh} />)}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderRow({ line, who, documentId, onDone }: { line: OpenOrderLine; who: OnOrderWho; documentId: string; onDone: () => void }) {
  const share = orderLineShare(line, who);
  const [qty, setQty] = useState(share.freeForAllocation > 0 ? '1' : '0');
  const alloc = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => allocateOrderLine(line.line_id, documentId, Number(qty.replace(',', '.'))),
    onSuccess: () => { toast.success(t('onOrder.allocated')); onDone(); },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('onOrder.errAllocate')),
  });
  const forWhom = share.mine > 0 && share.otherClient === 0
    ? <StatusBadge tone="success" icon={UserCheck} label={t('onOrder.forThisClient')} />
    : line.order_contact_id && share.otherClient > 0
      ? <StatusBadge tone="neutral" icon={UserX} label={t('onOrder.forOtherClient').replace('{name}', line.order_contact_name ?? '—')} />
      : <StatusBadge tone="info" icon={Warehouse} label={t('onOrder.forStock')} />;
  const n = Number(qty.replace(',', '.'));
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-mono text-[12px]">{line.order_number ?? '—'}<div className="font-data text-[11px] text-muted-foreground">{t(`orders.dispatch_${line.dispatch_status}`)}</div></td>
      <td className="px-3 py-2">{forWhom}</td>
      <td className="px-3 py-2 text-right tabular-nums">{q(share.mine)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{q(share.stock)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{q(share.otherClient)}</td>
      <td className="px-3 py-2">
        {share.freeForAllocation > 0 && (
          <div className="flex items-center justify-end gap-1">
            <Input type="number" min={0} max={share.freeForAllocation} step="1" value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 w-16 text-right tabular-nums" />
            <Button size="sm" onClick={() => alloc.mutate()} disabled={alloc.isPending || !(n > 0) || n > share.freeForAllocation} title={t('onOrder.allocateHint')}>
              {alloc.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} {t('onOrder.allocate')}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
