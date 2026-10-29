import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, FileText, Receipt, LifeBuoy, ClipboardList, ListChecks, ClipboardCheck, ShoppingCart, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { getRepairOrderFull } from '@/modules/workshop/api';
import { orWorkedMinutes } from '@/modules/workshop/chrono-api';
import { updateRepairOrder, transformToInvoice, checkupSchemaReady, type RoInput } from '@/modules/workshop/write-api';
import { OrEditor, type OrPayload, type OrEditorIntent } from '@/modules/workshop/or-editor';
import { AccidentHelpDialog } from '@/modules/workshop/accident-help-dialog';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { openPickingForRepairOrder } from '@/modules/workshop/kits/api';
import { OrderFromWorkshopDialog } from '@/modules/workshop/kits/order-from-workshop-dialog';
import { createProposalFromOr, getProposalSignToken, listDeferredToPlan, proposalSignUrl, type DeferredIntervention } from '@/modules/workshop/checkup/api';
import { approvalState, canStartWork } from '@/modules/workshop/checkup/rules';
import { ApprovalPanel, VerbalApprovalDialog } from '@/modules/workshop/checkup/approval-panel';
import { DeferredDateDialog } from '@/modules/workshop/checkup/deferred';
import { DocumentMailDialog } from '@/modules/sales/document-mail-dialog';
import { getDocumentFull, type DocumentFull } from '@/modules/sales/write-api';
import { getContact, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { contactLocale } from '@/lib/i18n/client-locale';
import { t, tIn, fillVars, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/$orId')({
  head: () => ({ meta: [{ title: pageTitle('workshopOr') }] }),
  component: OrView,
});

const tone = (s: string) => (s === 'facture' ? 'success' : s === 'annule' ? 'neutral' : s === 'pret' ? 'info' : 'warning');

/** Mail de la proposition d'intervention, dans la langue du client, avec son lien de signature. */
type ProposalMail = { full: DocumentFull; contact: Contact; preset: { subject: string; body: string } };

function OrView() {
  const { orId } = Route.useParams();
  const { activeCompanyId, companies } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [accidentOpen, setAccidentOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [verbalOpen, setVerbalOpen] = useState(false);
  const [mail, setMail] = useState<ProposalMail | null>(null);
  const [deferredStep, setDeferredStep] = useState<DeferredIntervention[] | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['ro-full', orId], queryFn: () => getRepairOrderFull(orId) });
  const worked = useQuery({ queryKey: ['ro-worked', orId], queryFn: () => orWorkedMinutes(orId) });
  const schema = useQuery({ queryKey: ['checkup-schema'], queryFn: checkupSchemaReady, staleTime: Infinity });
  const companyName = companies.find((c) => c.id === activeCompanyId)?.name ?? '';
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ro-full', orId] }); qc.invalidateQueries({ queryKey: ['repair-orders'] }); };

  const toInput = (p: OrPayload): RoInput => ({
    companyId: activeCompanyId!, contactId: p.contactId, vehicleId: p.vehicleId, mileage: p.mileage, operator: p.operator,
    repairType: p.repairType, workDescription: p.workDescription, receptionNotes: p.receptionNotes, status: p.status,
    warrantyStatus: p.warrantyStatus, expertName: p.expertName, expertDate: p.expertDate || null, reasonCode: p.reasonCode, lines: p.lines,
  });

  const save = useMutation({
    mutationFn: (p: OrPayload) => updateRepairOrder(orId, toInput(p)),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  /** Ouvre la fenêtre d'envoi (objet / corps dans la langue du client, lien de signature inclus). */
  const openProposalMail = async (documentId: string, token: string) => {
    const full = await getDocumentFull(documentId);
    if (!full.doc.contact_id) throw new Error(t('checkup.needClient'));
    const contact = await getContact(full.doc.contact_id);
    if (!contact) throw new Error(t('checkup.needClient'));
    const locale = contactLocale(contact);
    const vars = { number: full.doc.number ?? '', company: companyName, client: contactDisplayName(contact), link: proposalSignUrl(token), or: data?.or.number ?? '' };
    setMail({ full, contact, preset: { subject: fillVars(tIn(locale, 'checkup.mailSubject'), vars), body: fillVars(tIn(locale, 'checkup.mailBody'), vars) } });
  };

  // « Envoyer la proposition » : enregistrer l'OR, créer le devis Proposition d'intervention, puis la fenêtre d'envoi.
  const proposal = useMutation({
    mutationFn: async (p: OrPayload) => {
      await updateRepairOrder(orId, toInput(p));
      const created = await createProposalFromOr(orId);
      await openProposalMail(created.documentId, created.token);
      return created;
    },
    onSuccess: () => { refresh(); toast.success(t('checkup.proposalCreated')); },
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  // Renvoyer la proposition existante (même document, jeton renouvelé si expiré).
  const resend = useMutation({
    mutationFn: async () => {
      const docId = (data?.or as { proposal_document_id?: string | null } | undefined)?.proposal_document_id;
      if (!docId) throw new Error(t('checkup.noProposal'));
      await openProposalMail(docId, await getProposalSignToken(docId));
    },
    meta: { success: false },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  // « Faire signer sur la tablette » : même écran que le lien du client, en mode comptoir, plein écran.
  const signAtCounter = useMutation({
    mutationFn: async () => {
      const docId = (data?.or as { proposal_document_id?: string | null } | undefined)?.proposal_document_id;
      if (!docId) throw new Error(t('checkup.noProposal'));
      return getProposalSignToken(docId);
    },
    meta: { success: false },
    onSuccess: (token) => navigate({ to: '/signer/$token', params: { token }, search: { mode: 'comptoir', retour: orId } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  // Facturation : d'abord la date des interventions reportées de la moto (s'il y en a), puis la facture.
  const invoiceNow = useMutation({
    mutationFn: () => transformToInvoice(orId),
    onSuccess: (docId) => navigate({ to: '/sales/$documentId', params: { documentId: docId } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const toInvoice = useMutation({
    mutationFn: async () => (data?.or.vehicle_id ? listDeferredToPlan(data.or.vehicle_id) : []),
    meta: { success: false, error: false },
    onSuccess: (deferred) => { if (deferred.length) setDeferredStep(deferred); else invoiceNow.mutate(); },
    onError: () => invoiceNow.mutate(),
  });
  // Mission 07 carte 2 : la liste de préparation reprend le kit d'entretien de l'échéance
  // en cours (parcours technicien) + les pièces ajoutées par le technicien sur l'OR.
  const toPicking = useMutation({
    mutationFn: () => openPickingForRepairOrder(orId),
    onSuccess: (pickingId) => navigate({ to: '/preparation/$pickingId', params: { pickingId } }),
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
  const orx = or as typeof or & { customer_approval?: string | null; proposal_document_id?: string | null };
  const invoiced = or.status === 'facture';
  const pending = or.warranty_status === 'en_attente';
  const checkupReady = schema.data === true;
  const approval = approvalState(orx);
  const workAllowed = canStartWork(orx);
  const busy = save.isPending || proposal.isPending;

  const onSubmit = (p: OrPayload, intent: OrEditorIntent) => {
    setError(null);
    if (intent === 'proposal') proposal.mutate(p); else save.mutate(p);
  };

  return (
    <>
      <PageHeader
        title={`OR ${or.number ?? ''}`}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: `OR ${or.number ?? ''}` }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {invoiced && or.invoice_document_id && <Button variant="outline" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: or.invoice_document_id! } })}><Receipt /> {t('workshop.viewInvoice')}</Button>}
            {!invoiced && <Button onClick={() => { setError(null); toInvoice.mutate(); }} disabled={toInvoice.isPending || invoiceNow.isPending || pending}>{toInvoice.isPending || invoiceNow.isPending ? <Loader2 className="animate-spin" /> : <FileText />} {t('workshop.toInvoice')}</Button>}
            {!invoiced && <Button variant="outline" onClick={() => navigate({ to: '/sales/new', search: { contactId: or.contact_id ?? undefined, vehicleId: or.vehicle_id ?? undefined, orNumber: or.number ?? undefined, workshop: true } })}><ClipboardList /> {t('workshop.quoteParts')}</Button>}
            {!invoiced && (
              <Button variant="outline" onClick={() => navigate({ to: '/workshop/journey/$orId', params: { orId } })} disabled={!workAllowed} title={!workAllowed ? t('checkup.workBlocked') : undefined}>
                <ListChecks /> {t('workshop.startJourney')}
              </Button>
            )}
            {!invoiced && (
              <Button variant="outline" onClick={() => { setError(null); toPicking.mutate(); }} disabled={toPicking.isPending}>
                {toPicking.isPending ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} {t('workshop.createPicking')}
              </Button>
            )}
            {!invoiced && <Button variant="outline" onClick={() => setOrderOpen(true)}><ShoppingCart /> {t('workshop.orderMissing')}</Button>}
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
      {!workAllowed && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('checkup.workBlocked')}
        </p>
      )}
      {schema.data === false && (
        <p className="mb-3 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('checkup.migrationMissing')}</p>
      )}
      <OrEditor
        companyId={activeCompanyId!} initial={data} busy={busy} error={error} onSubmit={onSubmit}
        checkupReady={checkupReady && !invoiced} approvalPending={approval === 'en_attente'}
        header={checkupReady ? (
          <ApprovalPanel
            or={orx}
            onVerbal={() => setVerbalOpen(true)}
            onSignAtCounter={() => signAtCounter.mutate()} signBusy={signAtCounter.isPending}
            onOpenProposal={orx.proposal_document_id ? () => navigate({ to: '/sales/$documentId', params: { documentId: orx.proposal_document_id! } }) : undefined}
            onResend={orx.proposal_document_id ? () => resend.mutate() : undefined}
          />
        ) : null}
      />
      <div className="mt-6">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ged.title')}</p>
        <AttachmentsPanel companyId={activeCompanyId!} entityType="repair_order" entityId={orId} />
      </div>
      <AccidentHelpDialog key={String(accidentOpen)} open={accidentOpen} onOpenChange={setAccidentOpen} orFull={data} />
      {orderOpen && (
        <OrderFromWorkshopDialog
          orId={orId} companyId={activeCompanyId!} label={`OR ${or.number ?? ''}`.trim()}
          onClose={() => setOrderOpen(false)}
        />
      )}
      <VerbalApprovalDialog key={String(verbalOpen)} orId={orId} open={verbalOpen} onClose={() => setVerbalOpen(false)} onDone={refresh} />
      {mail && (
        <DocumentMailDialog
          full={mail.full} contact={mail.contact} companyName={companyName} preset={mail.preset}
          onClose={() => setMail(null)} onSent={refresh}
        />
      )}
      {deferredStep && (
        <DeferredDateDialog
          items={deferredStep}
          onDone={() => { setDeferredStep(null); invoiceNow.mutate(); }}
          onCancel={() => setDeferredStep(null)}
        />
      )}
    </>
  );
}
