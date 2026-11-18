import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { PurchaseEditor } from '@/modules/purchases/purchase-editor';
import type { PurchaseDocType } from '@/modules/purchases/g8-rules';
import { t, pageTitle } from '@/lib/i18n';

const DOC_TYPES: PurchaseDocType[] = ['REC', 'CMD', 'PCF', 'RTF'];

export const Route = createFileRoute('/_app/purchases/new')({
  head: () => ({ meta: [{ title: pageTitle('purchaseNew') }] }),
  // `recall` : id d'une commande à réceptionner (bouton « Réceptionner » de la commande, G8 « Rappel cde »).
  validateSearch: (s: Record<string, unknown>): { docType: PurchaseDocType; recall?: string } => ({
    docType: DOC_TYPES.includes(s.docType as PurchaseDocType) ? (s.docType as PurchaseDocType) : 'REC',
    ...(typeof s.recall === 'string' && s.recall ? { recall: s.recall } : {}),
  }),
  component: NewPurchase,
});

function NewPurchase() {
  const { activeCompanyId } = useAuth();
  const { docType, recall } = Route.useSearch();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t(`purchasesG8.new_${docType}`)}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>}
      />
      <PurchaseEditor key={`${docType}-${recall ?? ''}`} companyId={activeCompanyId} initialDocType={docType} recallOrderId={recall ?? null} />
    </>
  );
}
