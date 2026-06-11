import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { InventoryScreen } from '@/modules/stock/inventory-screen';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/inventory')({
  head: () => ({ meta: [{ title: 'Inventaire — Ducati Bruxelles' }] }),
  component: InventoryPage,
});

function InventoryPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('stock.inventoryTitle')}
        description={t('stock.inventorySubtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/stock' })}><ArrowLeft /> {t('stock.title')}</Button>}
      />
      <InventoryScreen companyId={activeCompanyId} />
    </>
  );
}
