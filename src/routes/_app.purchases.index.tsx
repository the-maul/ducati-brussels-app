import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plus, Truck, Users, ShoppingCart, ShoppingBasket, PackageCheck, ClipboardList, Undo2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { PurchaseDocumentsList } from '@/modules/purchases/documents-list';
import { t, pageTitle } from '@/lib/i18n';
import { useCanWrite } from '@/lib/auth/use-access';

export const Route = createFileRoute('/_app/purchases/')({
  head: () => ({ meta: [{ title: pageTitle('purchases') }] }),
  component: PurchasesList,
});

function PurchasesList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  // Lecture seule : on ne propose pas une action qui serait refusée ensuite.
  const canWrite = useCanWrite();

  return (
    <>
      <PageHeader
        title={t('purchases.title')}
        description={t('purchases.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/purchases/suppliers' })}><Users /> {t('purchases.tabSuppliers')}</Button>
            {/* search explicite : `highlight` est facultatif mais l'objet est exige. */}
            <Button variant="outline" onClick={() => navigate({ to: '/purchases/reorder', search: { highlight: undefined } })}><ShoppingCart /> {t('purchases.reorderTitle')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/purchases/proposal' })}><PackageCheck /> {t('purchases.proposalBtn')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/purchases/baskets' })}><ShoppingBasket /> {t('basket.title')}</Button>
            {canWrite && (
              <>
                <Button variant="outline" onClick={() => navigate({ to: '/purchases/new', search: { docType: 'PCF' } })}><ClipboardList /> {t('purchasesG8.new_PCF')}</Button>
                <Button variant="outline" onClick={() => navigate({ to: '/purchases/new', search: { docType: 'RTF' } })}><Undo2 /> {t('purchasesG8.new_RTF')}</Button>
                <Button variant="outline" onClick={() => navigate({ to: '/purchases/new', search: { docType: 'CMD' } })}><Plus /> {t('purchases.newCommand')}</Button>
                <Button onClick={() => navigate({ to: '/purchases/new', search: { docType: 'REC' } })}><Truck /> {t('purchases.newReception')}</Button>
              </>
            )}
          </div>
        }
      />
      {activeCompanyId && <PurchaseDocumentsList companyId={activeCompanyId} canWrite={canWrite} />}
    </>
  );
}
