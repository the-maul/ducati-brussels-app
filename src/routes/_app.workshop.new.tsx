import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { OrEditor, type OrPayload } from '@/modules/workshop/or-editor';
import { createRepairOrder } from '@/modules/workshop/write-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/new')({
  head: () => ({ meta: [{ title: 'Nouvel OR — Ducati Bruxelles' }] }),
  validateSearch: (s: Record<string, unknown>) => ({ contactId: typeof s.contactId === 'string' ? s.contactId : undefined }),
  component: NewOr,
});

function NewOr() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (p: OrPayload) => createRepairOrder({
      companyId: activeCompanyId!, contactId: p.contactId, vehicleId: p.vehicleId, mileage: p.mileage,
      operator: p.operator, repairType: p.repairType, workDescription: p.workDescription, receptionNotes: p.receptionNotes,
      status: p.status, warrantyStatus: p.warrantyStatus, expertName: p.expertName, expertDate: p.expertDate || null, lines: p.lines,
    }),
    onSuccess: (id) => navigate({ to: '/workshop/$orId', params: { orId: id } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader title={t('workshop.newOr')} actions={<Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>} />
      <OrEditor companyId={activeCompanyId} busy={m.isPending} error={error} onSubmit={(p) => { setError(null); m.mutate(p); }} />
    </>
  );
}
