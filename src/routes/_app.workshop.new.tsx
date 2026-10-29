import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { OrEditor, type OrPayload } from '@/modules/workshop/or-editor';
import { createRepairOrder, checkupSchemaReady } from '@/modules/workshop/write-api';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/new')({
  head: () => ({ meta: [{ title: pageTitle('workshopNew') }] }),
  validateSearch: (s: Record<string, unknown>) => ({ contactId: typeof s.contactId === 'string' ? s.contactId : undefined }),
  component: NewOr,
});

function NewOr() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const schema = useQuery({ queryKey: ['checkup-schema'], queryFn: checkupSchemaReady, staleTime: Infinity });
  const m = useMutation({
    mutationFn: (p: OrPayload) => createRepairOrder({
      companyId: activeCompanyId!, contactId: p.contactId, vehicleId: p.vehicleId, mileage: p.mileage,
      operator: p.operator, repairType: p.repairType, workDescription: p.workDescription, receptionNotes: p.receptionNotes,
      status: p.status, warrantyStatus: p.warrantyStatus, expertName: p.expertName, expertDate: p.expertDate || null,
      reasonCode: p.reasonCode, lines: p.lines,
    }),
    onSuccess: (id) => navigate({ to: '/workshop/$orId', params: { orId: id } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader title={t('workshop.newOr')} actions={<Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>} />
      <OrEditor companyId={activeCompanyId} busy={m.isPending} error={error} checkupReady={schema.data === true} onSubmit={(p) => { setError(null); m.mutate(p); }} />
    </>
  );
}
