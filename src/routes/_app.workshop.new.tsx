import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { OrEditor, type OrPayload } from '@/modules/workshop/or-editor';
import { createRepairOrder, checkupSchemaReady } from '@/modules/workshop/write-api';
import { ensureAccidentFileForOr } from '@/modules/workshop/or-page-api';
import { t, pageTitle } from '@/lib/i18n';
import { clearFormDraft, formDraftKey } from '@/lib/form-draft';

export const Route = createFileRoute('/_app/workshop/new')({
  head: () => ({ meta: [{ title: pageTitle('workshopNew') }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    contactId: typeof s.contactId === 'string' ? s.contactId : undefined,
    vehicleId: typeof s.vehicleId === 'string' ? s.vehicleId : undefined,
  }),
  component: NewOr,
});

function NewOr() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Ouvert depuis une fiche client ou moto : client et moto pre-remplis (ATE001).
  const { contactId, vehicleId } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const schema = useQuery({ queryKey: ['checkup-schema'], queryFn: checkupSchemaReady, staleTime: Infinity });
  // Brouillon de saisie (UX011) : par societe ; efface a l'enregistrement, remis a zero a la demande.
  const draftKey = activeCompanyId ? formDraftKey('/workshop/new', activeCompanyId) : null;
  const [editorKey, setEditorKey] = useState(0);
  const m = useMutation({
    mutationFn: async (p: OrPayload) => {
      const id = await createRepairOrder({
        companyId: activeCompanyId!, contactId: p.contactId, vehicleId: p.vehicleId, mileage: p.mileage,
        operator: p.operator, operatorId: p.operatorId, repairType: p.repairType, workDescription: p.workDescription, receptionNotes: p.receptionNotes,
        status: p.status, warrantyStatus: p.warrantyStatus, expertName: p.expertName, expertDate: p.expertDate || null,
        reasonCode: p.reasonCode, lines: p.lines,
      });
      // OR accident : le dossier accident s'ouvre en brouillon, lie a l'OR (ATE001b). Un echec ne
      // perd pas l'OR : le bouton « Dossier accident » de la fiche reste la.
      const file = await ensureAccidentFileForOr({
        companyId: activeCompanyId!, orId: id, reasonCode: p.reasonCode, repairType: p.repairType || null, status: p.status,
        contactId: p.contactId, vehicleId: p.vehicleId, expertName: p.expertName || null,
      }).catch(() => null);
      return { id, file };
    },
    onSuccess: ({ id, file }) => {
      if (draftKey) clearFormDraft(draftKey);
      if (file?.created) {
        qc.invalidateQueries({ queryKey: ['accident-files'] });
        toast.success(t('orPage.accidentFileCreated'));
      }
      navigate({ to: '/workshop/$orId', params: { orId: id } });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader title={t('workshop.newOr')} actions={<Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>} />
      <OrEditor key={editorKey} draftKey={draftKey} onDraftDiscard={() => setEditorKey((k) => k + 1)} companyId={activeCompanyId} defaultContactId={contactId ?? null} defaultVehicleId={vehicleId ?? null} busy={m.isPending} error={error} checkupReady={schema.data === true} onSubmit={(p) => { setError(null); m.mutate(p); }} />
    </>
  );
}
