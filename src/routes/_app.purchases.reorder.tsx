import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, ArrowLeft, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { getReorderProposals, listSuppliers, supplierName, type ReorderProposal } from '@/modules/purchases/api';
import { createOrdersFromProposals } from '@/modules/purchases/write-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/purchases/reorder')({
  head: () => ({ meta: [{ title: 'Proposition de commande — Ducati Bruxelles' }] }),
  component: ReorderPage,
});

function ReorderPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['reorder', activeCompanyId], queryFn: () => getReorderProposals(activeCompanyId!), enabled: !!activeCompanyId });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-map', activeCompanyId], queryFn: () => listSuppliers(activeCompanyId!), enabled: !!activeCompanyId });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [done, setDone] = useState<number | null>(null);

  const supName = (id: string | null) => (id ? supplierName(suppliers?.find((s) => s.id === id) ?? { company_name: null, first_name: null, last_name: null }) : '—');
  const getQty = (p: ReorderProposal) => (qty[p.article_id] !== undefined ? Number(qty[p.article_id].replace(',', '.')) || 0 : p.suggested_qty);

  const create = useMutation({
    mutationFn: () => {
      const items = (data ?? []).map((p) => ({ article_id: p.article_id, supplier_id: p.supplier_id, designation: `${p.reference} ${p.designation}`, quantity: getQty(p) })).filter((i) => i.quantity > 0);
      return createOrdersFromProposals(activeCompanyId!, items);
    },
    onSuccess: (n) => setDone(n),
  });

  const supplierCount = useMemo(() => new Set((data ?? []).filter((p) => getQty(p) > 0).map((p) => p.supplier_id ?? '_')).size, [data, qty]);

  return (
    <>
      <PageHeader
        title={t('purchases.reorderTitle')}
        description={t('purchases.reorderSubtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !(data && data.length)}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <ShoppingCart />} {t('purchases.createOrders')}{supplierCount > 0 ? ` (${supplierCount})` : ''}
            </Button>
          </div>
        }
      />
      {done !== null && <p className="mb-3 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{t('purchases.ordersCreated').replace('{n}', String(done))}</p>}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr><Th>{t('purchases.colSupplierRef')}</Th><Th>{t('purchases.colArticle')}</Th><Th>{t('purchases.colSupplier')}</Th><Th className="text-right">{t('purchases.reorderAvail')}</Th><Th className="text-right">{t('purchases.reorderMin')}</Th><Th className="text-right">{t('purchases.reorderQty')}</Th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('purchases.reorderEmpty')}</td></tr>}
            {data?.map((p) => (
              <tr key={p.article_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-[12px]">{p.reference}</td>
                <td className="px-3 py-2">{p.designation}</td>
                <td className="px-3 py-2">{supName(p.supplier_id)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.available_qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.stock_min}</td>
                <td className="px-3 py-2 text-right">
                  <Input type="number" step="1" value={qty[p.article_id] ?? String(p.suggested_qty)} onChange={(e) => setQty((q) => ({ ...q, [p.article_id]: e.target.value }))} className="ml-auto h-8 w-20 text-right tabular-nums" />
                </td>
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
