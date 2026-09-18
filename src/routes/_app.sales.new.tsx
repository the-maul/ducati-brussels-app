import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { DocumentEditor } from '@/modules/sales/document-editor';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/sales/new')({
  head: () => ({ meta: [{ title: 'Nouveau document — Ducati Bruxelles' }] }),
  validateSearch: (s: Record<string, unknown>): { contactId?: string; vehicleId?: string; orNumber?: string; workshop?: boolean } => ({
    contactId: typeof s.contactId === 'string' ? s.contactId : undefined,
    // devis atelier (depuis un OR) : véhicule, n° d'OR, case « Devis atelier » cochée
    vehicleId: typeof s.vehicleId === 'string' ? s.vehicleId : undefined,
    orNumber: typeof s.orNumber === 'string' ? s.orNumber : undefined,
    workshop: s.workshop === true || s.workshop === '1' || s.workshop === 1 ? true : undefined,
  }),
  component: NewDocument,
});

function NewDocument() {
  const { activeCompanyId } = useAuth();
  const { contactId, vehicleId, orNumber, workshop } = Route.useSearch();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader title={t('sales.newDoc')} actions={<Button variant="outline" onClick={() => navigate({ to: '/sales' })}><ArrowLeft /> {t('sales.backToList')}</Button>} />
      <DocumentEditor companyId={activeCompanyId} initialContactId={contactId} initialVehicleId={vehicleId} workshopOrNumber={orNumber} workshop={workshop} />
    </>
  );
}
