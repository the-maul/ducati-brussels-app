import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Truck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { listPurchaseOrders, listSuppliers, supplierName } from '@/modules/purchases/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/purchases/')({
  head: () => ({ meta: [{ title: 'Achats & réceptions — Ducati Bruxelles' }] }),
  component: PurchasesList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: string) => (s === 'recue' ? 'success' : s === 'annulee' ? 'neutral' : s === 'brouillon' ? 'info' : 'warning');

function PurchasesList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders', activeCompanyId], queryFn: () => listPurchaseOrders(activeCompanyId!), enabled: !!activeCompanyId });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-map', activeCompanyId], queryFn: () => listSuppliers(activeCompanyId!), enabled: !!activeCompanyId });
  const supName = (id: string | null) => (id ? supplierName(suppliers?.find((s) => s.id === id) ?? { company_name: null, first_name: null, last_name: null }) : '—');

  return (
    <>
      <PageHeader
        title={t('purchases.title')}
        description={t('purchases.subtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/purchases/new', search: { docType: 'CMD' } })}><Plus /> {t('purchases.newCommand')}</Button>
            <Button onClick={() => navigate({ to: '/purchases/new', search: { docType: 'REC' } })}><Truck /> {t('purchases.newReception')}</Button>
          </div>
        }
      />
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr><Th>{t('purchases.colNumber')}</Th><Th>{t('purchases.colType')}</Th><Th>{t('purchases.colSupplier')}</Th><Th>{t('purchases.colDate')}</Th><Th>{t('purchases.colStatus')}</Th><Th className="text-right">{t('purchases.colTtc')}</Th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('purchases.empty')}</td></tr>}
            {data?.map((d) => (
              <tr key={d.id} onClick={() => navigate({ to: '/purchases/$orderId', params: { orderId: d.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{d.number ?? '—'}</td>
                <td className="px-3 py-2">{t(`purchases.type_${d.doc_type}`)}</td>
                <td className="px-3 py-2">{supName(d.supplier_id)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.receipt_date ?? d.order_date ?? '—'}</td>
                <td className="px-3 py-2"><StatusBadge tone={statusTone(d.status)} label={t(`purchases.status_${d.status}`)} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(d.total_ttc))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
