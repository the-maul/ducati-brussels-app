import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, FileText, Receipt, LifeBuoy } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { getRepairOrderFull } from '@/modules/workshop/api';
import { orWorkedMinutes } from '@/modules/workshop/chrono-api';
import { updateRepairOrder, transformToInvoice, type OrPayload } from '@/modules/workshop/write-api';
import { OrEditor } from '@/modules/workshop/or-editor';
import { AccidentHelpDialog } from '@/modules/workshop/accident-help-dialog';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/$orId')({
  head: () => ({ meta: [{ title: 'OR — Ducati Bruxelles' }] }),
  component: OrView,
});

const tone = (s: string) => (s === 'facture' ? 'success' : s === 'annule' ? 'neutral' : s === 'pret' ? 'info' : 'warning');

function OrView() {
  const { orId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [accidentOpen, setAccidentOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['ro-full', orId], queryFn: () => getRepairOrderFull(orId) });
  const worked = useQuery({ queryKey: ['ro-worked', orId], queryFn: () => orWorkedMinutes(orId) });

  const save = useMutation({
    mutationFn: (p: OrPayload) => updateRepairOrder(orId, {
      companyId: activeCompanyId!, contactId: p.contactId, vehicleId: p.vehicleId, mileage: p.mileage, operator: p.operator,
      repairType: p.repairType, workDescription: p.workDescription, receptionNotes: p.receptionNotes, status: p.status,
      warrantyStatus: p.warrantyStatus, expertName: p.expertName, expertDate: p.expertDate || null, lines: p.lines,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ro-full', orId] }); qc.invalidateQueries({ queryKey: ['repair-orders'] }); },
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const toInvoice = useMutation({
    mutationFn: () => transformToInvoice(orId),
    onSuccess: (docId) => navigate({ to: '/sales/$documentId', params: { documentId: docId } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return (
    <>
      <PageHeader
        title={t('nav.workshop')}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: t('nav.workshop') }]}
      />
      <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('workshop.notFound')}</p>
    </>
  );

  const { or } = data;
  const invoiced = or.status === 'facture';
  const pending = or.warranty_status === 'en_attente';

  return (
    <>
      <PageHeader
        title={`OR ${or.number ?? ''}`}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: `OR ${or.number ?? ''}` }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {invoiced && or.invoice_document_id && <Button variant="outline" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: or.invoice_document_id! } })}><Receipt /> {t('workshop.viewInvoice')}</Button>}
            {!invoiced && <Button onClick={() => toInvoice.mutate()} disabled={toInvoice.isPending || pending}><FileText /> {t('workshop.toInvoice')}</Button>}
            <Button variant="outline" onClick={() => setAccidentOpen(true)}><LifeBuoy /> {t('accident.btn')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone(or.status)} label={t(`workshop.status_${or.status}`)} />
        {or.warranty_status !== 'aucune' && <StatusBadge tone={pending ? 'warning' : 'info'} label={t(`workshop.warranty_${or.warranty_status}`)} />}
        {worked.data ? <span className="font-data text-[13px] tabular-nums text-muted-foreground">{t('workshop.workedTime')} : {worked.data} {t('workshop.minutes')}</span> : null}
      </div>
      {pending && <p className="mb-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('workshop.warrantyBlocked')}</p>}
      <OrEditor companyId={activeCompanyId!} initial={data} busy={save.isPending} error={error} onSubmit={(p) => { setError(null); save.mutate(p); }} />
      <div className="mt-6">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ged.title')}</p>
        <AttachmentsPanel companyId={activeCompanyId!} entityType="repair_order" entityId={orId} />
      </div>
      <AccidentHelpDialog key={String(accidentOpen)} open={accidentOpen} onOpenChange={setAccidentOpen} orFull={data} />
    </>
  );
}
