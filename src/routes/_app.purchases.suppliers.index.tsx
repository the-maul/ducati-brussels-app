import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/purchases/suppliers/')({
  head: () => ({ meta: [{ title: 'Fournisseurs — Ducati Bruxelles' }] }),
  component: SuppliersList,
});

function SuppliersList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', activeCompanyId, term],
    queryFn: () => listSuppliers(activeCompanyId!, term),
    enabled: !!activeCompanyId,
  });

  return (
    <>
      <PageHeader
        title={t('purchases.suppliersTitle')}
        description={t('purchases.suppliersSubtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>
            <Button onClick={() => navigate({ to: '/purchases/suppliers/new' })}><Plus /> {t('purchases.newSupplier')}</Button>
          </div>
        }
      />
      <div className="mb-3 max-w-sm">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('purchases.supplierPlaceholder')} />
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr><Th>{t('contacts.colName')}</Th><Th>{t('contacts.colCity')}</Th><Th>{t('contacts.vatNumber')}</Th><Th className="text-right">{t('contacts.supplierRfa')}</Th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{t('contacts.empty')}</td></tr>}
            {data?.map((s) => (
              <tr key={s.id} onClick={() => navigate({ to: '/purchases/suppliers/$supplierId', params: { supplierId: s.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2">{supplierName(s)}</td>
                <td className="px-3 py-2">{s.city ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{s.vat_number ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.supplier_rfa_rate != null ? `${s.supplier_rfa_rate} %` : '—'}</td>
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
