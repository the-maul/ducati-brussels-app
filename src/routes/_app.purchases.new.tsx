import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { PurchaseEditor } from '@/modules/purchases/purchase-editor';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/purchases/new')({
  head: () => ({ meta: [{ title: 'Nouveau document achat — Ducati Bruxelles' }] }),
  validateSearch: (s: Record<string, unknown>) => ({ docType: s.docType === 'CMD' ? 'CMD' as const : 'REC' as const }),
  component: NewPurchase,
});

function NewPurchase() {
  const { activeCompanyId } = useAuth();
  const { docType } = Route.useSearch();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={docType === 'CMD' ? t('purchases.newCommand') : t('purchases.newReception')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>}
      />
      <PurchaseEditor companyId={activeCompanyId} initialDocType={docType} />
    </>
  );
}
