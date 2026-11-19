import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, FileText, Receipt, LifeBuoy, ClipboardList, ListChecks, ClipboardCheck, ShoppingCart, ShoppingBasket, AlertTriangle, FilePen, CopyPlus, Printer, BellRing, Play } from 'lucide-react';
import { createRepairQuoteFromOr, duplicateRepairOrder } from '@/modules/workshop/or-copy';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { getRepairOrderFull } from '@/modules/workshop/api';
import { orWorkedMinutes } from '@/modules/workshop/chrono-api';
import { updateRepairOrder, transformToInvoice, checkupSchemaReady, startRepairOrder, type RoInput } from '@/modules/workshop/write-api';
import { OrEditor, type OrPayload, type OrEditorIntent } from '@/modules/workshop/or-editor';
import { openAccidentFile, accidentSchemaReady, findAccidentFileFor, getAccidentFile } from '@/modules/workshop/accident/api';
import { AccidentStatusBadge } from '@/modules/workshop/accident/accident-file-screen';
import { AccidentInsurancePanel } from '@/modules/workshop/accident/insurance-panel';
import { insuranceSchemaReady } from '@/modules/workshop/accident/insurance-api';
import { WarrantyStatusBadge } from '@/modules/workshop/warranty/warranty-views';
import { ensureAccidentFileForOr } from '@/modules/workshop/or-page-api';
import { isAccidentOr } from '@/modules/workshop/or-page-rules';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { openPickingForRepairOrder } from '@/modules/workshop/kits/api';
import { OrderFromWorkshopDialog } from '@/modules/workshop/kits/order-from-workshop-dialog';
import { MaintenancePartsPopup } from '@/modules/workshop/parts-popup';
import { isMaintenanceReasonCode } from '@/modules/workshop/parts-popup-rules';
import { BasketFromWorkshopDialog } from '@/modules/purchases/basket-from-workshop-dialog';
import { ProposalAddButton } from '@/modules/purchases/proposal-add-dialog';
import { ReservedPartsBlock } from '@/modules/workshop/reservations/reserved-parts-block';
import { reservationSchemaReady } from '@/modules/workshop/reservations/api';
import { isServiceCode, serviceCodeForReason } from '@/modules/workshop/service-code';
import { createProposalFromOr, getProposalSignToken, listDeferredToPlan, proposalSignUrl, type DeferredIntervention } from '@/modules/workshop/checkup/api';
import { approvalState, canStartWork } from '@/modules/workshop/checkup/rules';
import { ApprovalPanel, VerbalApprovalDialog } from '@/modules/workshop/checkup/approval-panel';
import { DeferredDateDialog } from '@/modules/workshop/checkup/deferred';
import { TimeControlDialog } from '@/modules/workshop/labour-time/time-control-dialog';
import { labourTimeSchemaReady, saveTimeControl } from '@/modules/workshop/labour-time/api';
import type { ControlLineSource, ControlRow } from '@/modules/workshop/labour-time/rules';
import { lineCoveredByWarranty } from '@/modules/workshop/warranty/rules';
import { DocumentMailDialog } from '@/modules/sales/document-mail-dialog';
import { getDocumentFull, type DocumentFull } from '@/modules/sales/write-api';
import { getContact, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { contactLocale } from '@/lib/i18n/client-locale';
import { OrStatusBadge } from '@/modules/workshop/or-base/or-status-badge';
import { OrPrintDialog } from '@/modules/workshop/or-base/print-dialog';
import { ReadyMailDialog } from '@/modules/workshop/or-base/ready-mail-dialog';
import { canNotifyReady, canStartOr } from '@/modules/workshop/or-base/rules';
import { t, tIn, fillVars, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/$orId')({
  head: () => ({ meta: [{ title: pageTitle('workshopOr') }] }),
  component: OrView,
});

/** Mail de la proposition d'intervention, dans la langue du client, avec son lien de signature. */
type ProposalMail = { full: DocumentFull; contact: Contact; preset: { subject: string; body: string } };

function OrView() {
  const { orId } = Route.useParams();
  const { activeCompanyId, companies } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  const [verbalOpen, setVerbalOpen] = useState(false);
  const [mail, setMail] = useState<ProposalMail | null>(null);
  const [deferredStep, setDeferredStep] = useState<DeferredIntervention[] | null>(null);
  // Rattrapage G8 (18/11) : impression OR / fiche de travail, message « moto prete ».
  const [printOpen, setPrintOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  // « Contrôle du temps atelier » avant la facture (rattrapage G8, 18/11/2026).
  const [controlOpen, setControlOpen] = useState(false);
  const labourSchema = useQuery({ queryKey: ['labour-time-schema'], queryFn: labourTimeSchemaReady, staleTime: Infinity });
  // Popup « pieces d'entretien manquantes » (mission 09, carte 3) : une fois par ouverture d'ecran,
  // seulement pour un OR a motif entretien ; la memoire sur l'OR evite de redemander les memes pieces.
  const [partsPopupDone, setPartsPopupDone] = useState(false);
  const partsPopupDone_ = useCallback(() => setPartsPopupDone(true), []);
  const { data, isLoading } = useQuery({ queryKey: ['ro-full', orId], queryFn: () => getRepairOrderFull(orId) });
  const worked = useQuery({ queryKey: ['ro-worked', orId], queryFn: () => orWorkedMinutes(orId) });
  const schema = useQuery({ queryKey: ['checkup-schema'], queryFn: checkupSchemaReady, staleTime: Infinity });
  // Reservation des pieces au RDV (mission 10, carte 6) : en base, elle remplace le popup et la commande de pieces.
  const reservationSchema = useQuery({ queryKey: ['reservation-schema'], queryFn: reservationSchemaReady, staleTime: Infinity });
  const companyName = companies.find((c) => c.id === activeCompanyId)?.name ?? '';
  // Dossier accident deja ouvert pour cet OR (bandeau et bouton « Voir le dossier accident »).
  const accidentSchema = useQuery({ queryKey: ['accident-schema'], queryFn: accidentSchemaReady, staleTime: Infinity });
  const accidentFileQ = useQuery({
    queryKey: ['accident-file-for-or', orId],
    enabled: accidentSchema.data === true && !!activeCompanyId,
    queryFn: async () => {
      const id = await findAccidentFileFor(activeCompanyId!, { repairOrderId: orId });
      return id ? getAccidentFile(id) : null;
    },
  });
  // Volet assureur du dossier accident (rattrapage G8 : cabinet, expert, franchise, demarrage accepte).
  const insuranceSchema = useQuery({ queryKey: ['insurance-schema'], queryFn: insuranceSchemaReady, staleTime: Infinity });
  // Mission 09 carte 5 : le dossier accident (fiche, photos, devis, formulaire Ducati, mail) remplace l'ancienne fenetre d'aide.
  const accident = useMutation({
    mutationFn: () => openAccidentFile({ companyId: activeCompanyId!, vehicleId: data?.or.vehicle_id, contactId: data?.or.contact_id, repairOrderId: orId, expertName: data?.or.expert_name }),
    meta: { success: false },
    onSuccess: (fileId) => navigate({ to: '/workshop/accidents/$fileId', params: { fileId } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ro-full', orId] }); qc.invalidateQueries({ queryKey: ['repair-orders'] }); qc.invalidateQueries({ queryKey: ['reserved-parts'] }); };

  const toInput = (p: OrPayload): RoInput => ({
    companyId: activeCompanyId!, contactId: p.contactId, vehicleId: p.vehicleId, mileage: p.mileage, operator: p.operator, operatorId: p.operatorId,
    repairType: p.repairType, workDescription: p.workDescription, receptionNotes: p.receptionNotes, status: p.status,
    warrantyStatus: p.warrantyStatus, expertName: p.expertName,
    // undefined : expert et passage geres par le volet assurance du dossier accident.
    expertDate: p.expertDate === undefined ? undefined : (p.expertDate || null),
    warrantyCessionCode: p.warrantyCessionCode, warrantyNote: p.warrantyNote,
    reasonCode: p.reasonCode, lines: p.lines,
    // Rattrapage G8 (18/11) : promis le, 30 points, notes internes, km inferieur confirme.
    promisedAt: p.promisedAt, checkPoints: p.checkPoints, internalNotes: p.internalNotes, mileageAckPrevious: p.mileageAckPrevious,
  });

  // OR accident : a l'enregistrement, le dossier accident s'ouvre en brouillon s'il n'existe pas (ATE001b).
  const ensureAccident = async (p: OrPayload) => {
    const file = await ensureAccidentFileForOr({
      companyId: activeCompanyId!, orId, reasonCode: p.reasonCode, repairType: p.repairType || null, status: p.status,
      contactId: p.contactId, vehicleId: p.vehicleId, expertName: p.expertName || null,
    }).catch(() => null);
    if (file?.created) {
      qc.invalidateQueries({ queryKey: ['accident-files'] });
      qc.invalidateQueries({ queryKey: ['accident-file-for-or', orId] });
      toast.success(t('orPage.accidentFileCreated'));
    }
  };

  // Decision Q43 (18/11) : « Demarrer » passe l'OR en cours (le premier pointage le fait aussi).
  const start = useMutation({
    mutationFn: () => startRepairOrder(orId),
    meta: { success: false },
    onSuccess: () => { toast.success(t('orBase.started')); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const save = useMutation({
    mutationFn: async (p: OrPayload) => { await updateRepairOrder(orId, toInput(p)); await ensureAccident(p); },
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

  // Facturation : d'abord la date des interventions reportées de la moto (s'il y en a), puis le
  // contrôle du temps atelier (lignes MO), puis la facture.
  const invoiceNow = useMutation({
    mutationFn: () => transformToInvoice(orId),
    onSuccess: (docId) => navigate({ to: '/sales/$documentId', params: { documentId: docId } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const hasMoLines = (data?.lines ?? []).some((l) => l.kind === 'mo');
  const afterDeferred = () => { if (labourSchema.data === true && hasMoLines) setControlOpen(true); else invoiceNow.mutate(); };
  const controlAndInvoice = useMutation({
    mutationFn: async (rows: ControlRow[]) => { await saveTimeControl(orId, rows); return transformToInvoice(orId); },
    onSuccess: (docId) => { setControlOpen(false); refresh(); navigate({ to: '/sales/$documentId', params: { documentId: docId } }); },
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const toInvoice = useMutation({
    mutationFn: async () => (data?.or.vehicle_id ? listDeferredToPlan(data.or.vehicle_id) : []),
    meta: { success: false, error: false },
    onSuccess: (deferred) => { if (deferred.length) setDeferredStep(deferred); else afterDeferred(); },
    onError: () => afterDeferred(),
  });
  // Mission 07 carte 2 : la liste de préparation reprend le kit d'entretien de l'échéance
  // en cours (parcours technicien) + les pièces ajoutées par le technicien sur l'OR.
  const toPicking = useMutation({
    mutationFn: () => openPickingForRepairOrder(orId),
    onSuccess: (pickingId) => navigate({ to: '/preparation/$pickingId', params: { pickingId } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  // Rattrapage G8 : devis de reparation qui recopie les lignes de l'OR, et duplication de l'OR.
  const repairQuote = useMutation({
    mutationFn: () => createRepairQuoteFromOr(orId, t('parcG8.repairQuoteNote')),
    onSuccess: (documentId) => navigate({ to: '/sales/$documentId/edit', params: { documentId } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const duplicateOr = useMutation({
    mutationFn: () => duplicateRepairOrder(orId),
    onSuccess: (newId) => { toast.success(t('parcG8.orDuplicated')); navigate({ to: '/workshop/$orId', params: { orId: newId } }); },
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
  // Colonne de la migration 20261031110000 (non appliquee) : inconnue de types.ts.
  const reasonCode = ((or as unknown as Record<string, unknown>).reason_code as string | null | undefined) ?? null;
  const invoiced = or.status === 'facture';
  const pending = or.warranty_status === 'en_attente';
  const checkupReady = schema.data === true;
  const approval = approvalState(orx);
  const workAllowed = canStartWork(orx);
  const busy = save.isPending || proposal.isPending;
  const accidentOr = isAccidentOr({ reasonCode, repairType: or.repair_type });
  const accidentFile = accidentFileQ.data ?? null;
  // L'entretien choisi enregistre sur l'OR (colonne de la migration 20261103270000), sinon deduit du motif.
  const savedService = (or as unknown as Record<string, unknown>).service_code;
  const serviceCode = isServiceCode(savedService) ? savedService : serviceCodeForReason(reasonCode);
  const reservationsOn = reservationSchema.data === true;

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
            {canStartOr(or.status) && (
              <Button variant="outline" onClick={() => start.mutate()} disabled={start.isPending || !workAllowed} title={workAllowed ? t('orBase.startHint') : t('checkup.workBlocked')}>
                {start.isPending ? <Loader2 className="animate-spin" /> : <Play />} {t('orBase.start')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setPrintOpen(true)}><Printer /> {t('orBase.print')}</Button>
            {canNotifyReady({ status: or.status, hasContact: !!or.contact_id }) && (
              <Button variant="outline" onClick={() => setReadyOpen(true)}><BellRing /> {t('orBase.notifyReady')}</Button>
            )}
            {invoiced && or.invoice_document_id && <Button variant="outline" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: or.invoice_document_id! } })}><Receipt /> {t('workshop.viewInvoice')}</Button>}
            {!invoiced && <Button onClick={() => { setError(null); toInvoice.mutate(); }} disabled={toInvoice.isPending || invoiceNow.isPending || controlAndInvoice.isPending || pending}>{toInvoice.isPending || invoiceNow.isPending || controlAndInvoice.isPending ? <Loader2 className="animate-spin" /> : <FileText />} {t('workshop.toInvoice')}</Button>}
            {!invoiced && <Button variant="outline" onClick={() => navigate({ to: '/sales/new', search: { contactId: or.contact_id ?? undefined, vehicleId: or.vehicle_id ?? undefined, orNumber: or.number ?? undefined, workshop: true } })}><ClipboardList /> {t('workshop.quoteParts')}</Button>}
            {!invoiced && (
              <Button variant="outline" onClick={() => { setError(null); repairQuote.mutate(); }} disabled={repairQuote.isPending} title={t('parcG8.repairQuoteHint')}>
                {repairQuote.isPending ? <Loader2 className="animate-spin" /> : <FilePen />} {t('parcG8.repairQuote')}
              </Button>
            )}
            <Button variant="outline" onClick={() => { setError(null); duplicateOr.mutate(); }} disabled={duplicateOr.isPending}>
              {duplicateOr.isPending ? <Loader2 className="animate-spin" /> : <CopyPlus />} {t('parcG8.duplicateOr')}
            </Button>
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
            {/* Une seule facon de commander (carte 7, debut) : avec la reservation en base, le manque va au panier. */}
            {!invoiced && !reservationsOn && <Button variant="outline" onClick={() => setOrderOpen(true)}><ShoppingCart /> {t('workshop.orderMissing')}</Button>}
            {!invoiced && <Button variant="outline" onClick={() => setBasketOpen(true)}><ShoppingBasket /> {t('basket.addToStandard')}</Button>}
            {/* G8 « Prop. commande » (Stock / Dépannage / Garantie), rattrapage du 18/11/2026 */}
            {!invoiced && <ProposalAddButton companyId={activeCompanyId} kind="repair_order" sourceId={orId} />}
            <Button variant="outline" onClick={() => accident.mutate()} disabled={accident.isPending}>{accident.isPending ? <Loader2 className="animate-spin" /> : <LifeBuoy />} {accidentFile ? t('accidentFile.openExisting') : t('accidentFile.open')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <OrStatusBadge status={or.status} />
        {or.warranty_status !== 'aucune' && <WarrantyStatusBadge status={or.warranty_status} />}
        {worked.data ? <span className="font-data text-[13px] tabular-nums text-muted-foreground">{t('workshop.workedTime')} : {worked.data} {t('workshop.minutes')}</span> : null}
      </div>
      {/* OR accident : le dossier accident, bien visible (ATE001b). */}
      {(accidentOr || accidentFile) && accidentSchema.data === true && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
          <LifeBuoy className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold">{t('orPage.accidentTitle')}</p>
            <p className="text-[12px] text-muted-foreground">{accidentFile ? t('orPage.accidentLinked') : t('orPage.accidentNone')}</p>
          </div>
          {accidentFile && <AccidentStatusBadge status={accidentFile.status} />}
          <Button onClick={() => accident.mutate()} disabled={accident.isPending}>
            {accident.isPending ? <Loader2 className="animate-spin" /> : <LifeBuoy />} {accidentFile ? t('orPage.accidentOpenFile') : t('orPage.accidentCreateFile')}
          </Button>
        </div>
      )}
      {/* Onglet « Assurance » de G8 : sur le dossier accident de l'OR (une seule source). */}
      {accidentFile && insuranceSchema.data === true && (
        <div className="mb-4 rounded-md border border-border bg-card p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('insurance.panelTitle')}</p>
          <AccidentInsurancePanel companyId={activeCompanyId!} fileId={accidentFile.id} repairOrderId={orId} orTotalTtc={Number(or.total_ttc)} />
        </div>
      )}
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
        expertInPanel={!!accidentFile && insuranceSchema.data === true}
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
      {(serviceCode || isMaintenanceReasonCode(reasonCode)) && or.status !== 'annule' && (
        <div className="mt-6">
          <ReservedPartsBlock orId={orId} serviceCode={serviceCode} readOnly={invoiced} />
        </div>
      )}
      <div className="mt-6">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ged.title')}</p>
        <AttachmentsPanel companyId={activeCompanyId!} entityType="repair_order" entityId={orId} />
      </div>
      {orderOpen && (
        <OrderFromWorkshopDialog
          orId={orId} companyId={activeCompanyId!} label={`OR ${or.number ?? ''}`.trim()}
          onClose={() => setOrderOpen(false)}
        />
      )}
      {/* Repli avant la migration de reservation : l'ancien popup « pieces manquantes ». */}
      {!partsPopupDone && !invoiced && or.status !== 'annule' && reservationSchema.data === false && isMaintenanceReasonCode(reasonCode) && (
        <MaintenancePartsPopup
          ctx={{
            companyId: activeCompanyId!, vehicleId: or.vehicle_id, contactId: or.contact_id, reasonCode,
            orId, orNumber: or.number, appointmentAt: null,
          }}
          onDone={partsPopupDone_}
        />
      )}
      {basketOpen && (
        <BasketFromWorkshopDialog
          orId={orId} companyId={activeCompanyId!} contactId={or.contact_id ?? null} label={`OR ${or.number ?? ''}`.trim()}
          onClose={() => setBasketOpen(false)}
        />
      )}
      <VerbalApprovalDialog key={String(verbalOpen)} orId={orId} open={verbalOpen} onClose={() => setVerbalOpen(false)} onDone={refresh} />
      {mail && (
        <DocumentMailDialog
          full={mail.full} contact={mail.contact} companyName={companyName} preset={mail.preset}
          onClose={() => setMail(null)} onSent={refresh}
        />
      )}
      {printOpen && <OrPrintDialog orId={orId} orNumber={or.number} onClose={() => setPrintOpen(false)} />}
      {readyOpen && (
        <ReadyMailDialog
          companyId={activeCompanyId!} companyName={companyName}
          or={{ id: or.id, number: or.number, contact_id: or.contact_id, vehicle_id: or.vehicle_id, total_ttc: Number(or.total_ttc) }}
          onClose={() => setReadyOpen(false)} onInformed={() => { setReadyOpen(false); refresh(); }}
        />
      )}
      {deferredStep && (
        <DeferredDateDialog
          items={deferredStep}
          onDone={() => { setDeferredStep(null); afterDeferred(); }}
          onCancel={() => setDeferredStep(null)}
        />
      )}
      {controlOpen && (
        <TimeControlDialog
          companyId={activeCompanyId!} orId={orId} orNumber={or.number}
          // Garantie (lot B10) : une ligne re-routee vers le client se controle comme une ligne facturee.
          lines={(data.lines as unknown as (ControlLineSource & { warranty_decision?: string | null })[]).map((l) => ({ ...l, is_warranty: lineCoveredByWarranty({ is_warranty: !!l.is_warranty, warranty_decision: l.warranty_decision ?? null }, or.warranty_status) }))}
          busy={controlAndInvoice.isPending} error={controlAndInvoice.isPending ? null : error}
          onConfirm={(rows) => { setError(null); controlAndInvoice.mutate(rows); }}
          onCancel={() => setControlOpen(false)}
        />
      )}
    </>
  );
}
