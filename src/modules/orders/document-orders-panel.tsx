/**
 * Sur la fiche d'un document de vente : pièces à commander et commandes de pièces liées.
 *  - Mission 02, carte 3 : bouton « Commander les pièces » (tout le document) et liste des commandes
 *    créées depuis ce document (lien document → commande ; la commande montre le lien inverse).
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, PackageSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { BalancePayment } from '@/modules/sales/balance';
import { canOrderFromDocument, getDocumentOrderNeeds, listDocumentPartOrders, missingCount } from './from-document';
import { DispatchBadge, eur, kindLabel } from './order-ui';
import type { OrderDispatchStatus } from './api';

export function DocumentOrdersPanel({
  doc, payments, onOrder,
}: {
  doc: { id: string; doc_type: string; status: string };
  payments: BalancePayment[] | null;
  /** Ouvre la fenêtre « Commander les pièces » (sans présélection = tout le document). */
  onOrder: () => void;
}) {
  const orderable = canOrderFromDocument(doc);
  const needsQ = useQuery({
    queryKey: ['doc-order-needs', doc.id],
    queryFn: () => getDocumentOrderNeeds(doc.id),
    enabled: orderable,
  });
  const ordersQ = useQuery({ queryKey: ['doc-part-orders', doc.id], queryFn: () => listDocumentPartOrders(doc.id) });

  const missing = missingCount(needsQ.data ?? []);
  void payments;
  const alert = false;
  const orders = ordersQ.data ?? [];

  if (!orderable && orders.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {orderable && !alert && missing > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
          <PackageSearch className="size-4 shrink-0 text-muted-foreground" />
          <span>{t('orderFromDoc.missingLine').replace('{n}', String(missing))}</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={onOrder}><ShoppingCart /> {t('orderFromDoc.button')}</Button>
        </div>
      )}
      {orders.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orderFromDoc.linkedTitle')}</p>
          <ul className="space-y-1 font-data text-[13px]">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <ShoppingCart className="size-4 text-info" />
                <Link to="/orders/$orderId" params={{ orderId: o.id }} className="font-medium text-info underline">
                  {o.number ?? t('orders.draft')}
                </Link>
                <span className="text-muted-foreground">{kindLabel(o.orderKind)}</span>
                <DispatchBadge status={o.dispatchStatus as OrderDispatchStatus} />
                <span className="tabular-nums">{t('orderFromDoc.linkedLine').replace('{n}', String(o.lineCount)).replace('{total}', eur(o.totalHt))}</span>
                {o.sourceDocumentId !== doc.id && (
                  <span className="text-[12px] text-muted-foreground">{t('orderFromDoc.fromParent').replace('{doc}', o.sourceNumber ?? '—')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
