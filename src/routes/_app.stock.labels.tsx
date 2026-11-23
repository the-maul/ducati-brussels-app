import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useState } from 'react';
import { LabelsScreen } from '@/modules/stock/labels-screen';
import { DestinationLabelsDialog, DestinationPendingPanel } from '@/modules/purchases/destination-labels';
import type { DestinationKind } from '@/modules/purchases/part-path';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/labels')({
  head: () => ({ meta: [{ title: pageTitle('stockLabels') }] }),
  // C2 : lien réutilisable (dossier atelier…) vers les étiquettes « pour qui » d'un OR, d'une réception, d'une préparation.
  validateSearch: (s: Record<string, unknown>): { destKind?: DestinationKind; destId?: string } =>
    (['receipt', 'picking', 'repair_order', 'part_order'].includes(String(s.destKind)) && typeof s.destId === 'string'
      ? { destKind: s.destKind as DestinationKind, destId: s.destId } : {}),
  component: StockLabelsPage,
});

function StockLabelsPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const { destKind, destId } = Route.useSearch();
  const [destOpen, setDestOpen] = useState(true);
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('stockG8.labels.title')}
        description={t('stockG8.labels.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/stock' })}><ArrowLeft /> {t('stock.title')}</Button>}
      />
      <DestinationPendingPanel companyId={activeCompanyId} />
      <LabelsScreen companyId={activeCompanyId} />
      {destKind && destId && destOpen && (
        <DestinationLabelsDialog companyId={activeCompanyId} kind={destKind} id={destId} open onOpenChange={setDestOpen} />
      )}
    </>
  );
}
