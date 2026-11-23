import { motoName } from '@/lib/moto-name';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/lib/mutation-feedback';
import { toast } from 'sonner';
import { Loader2, FileText, Receipt, LifeBuoy, ClipboardList, ListChecks, ClipboardCheck, ShoppingCart, ShoppingBasket, AlertTriangle, FilePen, CopyPlus, Printer, BellRing, ChevronDown, MoreHorizontal, Paperclip, PackagePlus, Wrench, Euro, FolderOpen, History, PenLine } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/confirm-provider';
import { listAttachments } from '@/modules/documents/ged-api';
import { createRepairQuoteFromOr, duplicateRepairOrder } from '@/modules/workshop/or-copy';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { getRepairOrderFull } from '@/modules/workshop/api';
import { orWorkedMinutes } from '@/modules/workshop/chrono-api';
import { updateRepairOrder, transformToInvoice, checkupSchemaReady, type RoInput } from '@/modules/workshop/write-api';
import { OrEditor, type OrPayload, type OrEditorIntent } from '@/modules/workshop/or-editor';
import { openAccidentFile, accidentSchemaReady, findAccidentFileFor, getAccidentFile } from '@/modules/workshop/accident/api';
import { AccidentStatusBadge } from '@/modules/workshop/accident/accident-file-screen';
import { AccidentInsurancePanel } from '@/modules/workshop/accident/insurance-panel';
import { insuranceSchemaReady } from '@/modules/workshop/accident/insurance-api';
import { ensureAccidentFileForOr, listVehicleOrs } from '@/modules/workshop/or-page-api';
import { isAccidentOr } from '@/modules/workshop/or-page-rules';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { openPickingForRepairOrder } from '@/modules/workshop/kits/api';
import { OrderFromWorkshopDialog } from '@/modules/workshop/kits/order-from-workshop-dialog';
import { MaintenancePartsPopup } from '@/modules/workshop/parts-popup';
import { isMaintenanceReasonCode } from '@/modules/workshop/parts-popup-rules';
import { BasketFromWorkshopDialog } from '@/modules/purchases/basket-from-workshop-dialog';
import { ProposalAddDialog } from '@/modules/purchases/proposal-add-dialog';
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
import { greetingName } from '@/lib/person-name';
import { getVehicle } from '@/modules/vehicles/api';
import { VehicleWorkshopHistoryPanel } from '@/modules/workshop/or-base/vehicle-history-panel';
import { defaultOrTab, editorPane, parseOrTab, type OrTab } from '@/modules/workshop/or-base/or-tabs';
import { contactLocale } from '@/lib/i18n/client-locale';
import { OrStatusBadge } from '@/modules/workshop/or-base/or-status-badge';
import { OrProgressBanner } from '@/modules/workshop/or-base/or-progress-banner';
import { openSiblings } from '@/modules/workshop/or-base/progress-rules';
import { OrPrintDialog } from '@/modules/workshop/or-base/print-dialog';
import { OrDepositPanel } from '@/modules/workshop/or-base/deposit-panel';
import { ReadyMailDialog } from '@/modules/workshop/or-base/ready-mail-dialog';
import { canNotifyReady } from '@/modules/workshop/or-base/rules';
import { loadJourney } from '@/modules/workshop/journey/store';
import { journeyStarted } from '@/modules/workshop/journey/finding-photos';
import { plannedText } from '@/modules/workshop/dossier/dossier-parts';
import { ReceptionPanel, ReceptionSheet } from '@/modules/workshop/reception/reception-sheet';
import { PlanOpsPanel } from '@/modules/workshop/plan-ops/plan-ops-panel';
import { OperationExplodedButton } from '@/modules/workshop/exploded/operation-exploded-button';
import { t, tIn, fillVars, pageTitle, ensureLocale } from '@/lib/i18n';
import { isOrRouteId, workshopPathAlias } from '@/modules/workshop/or-base/route-id';

export const Route = createFileRoute('/_app/workshop/$orId')({
  // Lot UX atelier (20/11/2026) : l'onglet de la fiche est garde dans l'adresse (?tab=).
  validateSearch: (s: Record<string, unknown>): { tab?: OrTab } => ({ tab: parseOrTab(s.tab) }),
  head: () => ({ meta: [{ title: pageTitle('workshopOr') }] }),
  // Constat du 20/11 : /workshop/mon-atelier tombait ici (« mon-atelier » pris pour un n° d'OR) et
  // lancait ~6 requetes en 400 a chaque chargement. Alias connus → leur page ; autre id non valide :
  // « Introuvable » sans aucune requete.
  beforeLoad: ({ params }) => {
    const to = workshopPathAlias(params.orId);
    if (to) throw redirect({ to, replace: true });
  },
  component: OrRoute,
});

function OrRoute() {
  const { orId } = Route.useParams();
  if (!isOrRouteId(orId)) return (
    <>
      <PageHeader
        title={t('nav.workshop')}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop/planning' }, { label: t('nav.workshop') }]}
      />
      <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('workshop.notFound')}</p>
    </>
  );
  return <OrView />;
}

/** Mail de la proposition d'intervention, dans la langue du client, avec son lien de signature. */
type ProposalMail = { full: DocumentFull; contact: Contact; preset: { subject: string; body: string } };

function OrView() {
  const { orId } = Route.useParams();
  const search = Route.useSearch();
  const routeNavigate = Route.useNavigate();
  const { activeCompanyId, companies } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const confirm = useConfirm();
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
  // Parcours deja commence : le bouton devient « Reprendre le parcours » (etape, cases cochees).
  const savedJourney = useQuery({ queryKey: ['journey-saved', orId], queryFn: () => loadJourney(orId) });
  // Lot C parcours mecanicien (19/11) : serie de photos de reception. Lot « OR lisible » : ouverte par le
  // gros bouton « Prendre les photos » du bandeau ; a la fin, retour a l'OR, etape cochee, bouton « Demarrer ».
  const [receptionOpen, setReceptionOpen] = useState<{ startMode: boolean; go?: () => void } | null>(null);
  // Autres OR ouverts de la meme moto (essai du 19/11 : photos et chrono partis sur un ancien OR).
  const vehicleOrs = useQuery({
    queryKey: ['vehicle-ors', activeCompanyId, data?.or.vehicle_id ?? null],
    enabled: !!activeCompanyId && !!data?.or.vehicle_id,
    queryFn: () => listVehicleOrs(activeCompanyId!, data!.or.vehicle_id!),
  });
  // GED repliee : le nombre de documents suffit a l'ouverture.
  const ged = useQuery({ queryKey: ['attachments', 'repair_order', orId], queryFn: () => listAttachments('repair_order', orId) });
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
  // Q64 : le km de l'OR met à jour la fiche moto (en base) → fiche et relevés relus.
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ro-full', orId] }); qc.invalidateQueries({ queryKey: ['repair-orders'] }); qc.invalidateQueries({ queryKey: ['reserved-parts'] }); qc.invalidateQueries({ queryKey: ['vehicle'] }); qc.invalidateQueries({ queryKey: ['vehicle-mileage'] }); };

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
    // T4 : tarif assureur applique aux lignes (retenu sur l OR pour le re-tarifage automatique).
    insurerPriceListId: p.insurerPriceListId,
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

  const save = useMutation({
    mutationFn: async (p: OrPayload) => { await updateRepairOrder(orId, toInput(p)); await ensureAccident(p); },
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave')),
  });

  /** Ouvre la fenêtre d'envoi (objet / corps dans la langue du client, lien de signature inclus). */
  const openProposalMail = async (documentId: string, token: string) => {
    const full = await getDocumentFull(documentId);
    if (!full.doc.contact_id) throw new Error(t('checkup.needClient'));
    const contact = await getContact(full.doc.contact_id);
    if (!contact) throw new Error(t('checkup.needClient'));
    const locale = contactLocale(contact);
    await ensureLocale(locale); // dictionnaire de la langue du client (charge a la demande, lot perf 2)
    const vars = { number: full.doc.number ?? '', company: companyName, client: greetingName(contact), link: proposalSignUrl(token), or: data?.or.number ?? '' };
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
    onError: (e) => setError(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave')),
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
    onError: (e) => setError(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave')),
  });
  // Lot parcours-fix (20/11, comme G8) : le controle du temps atelier s'ouvre TOUJOURS avant la facture,
  // meme sans ligne de MO (il montre alors le temps pointe face a 0 h facturee). Il ne bloque pas.
  const afterDeferred = () => { if (labourSchema.data === true) setControlOpen(true); else invoiceNow.mutate(); };
  const controlAndInvoice = useMutation({
    mutationFn: async (rows: ControlRow[]) => { if (rows.length) await saveTimeControl(orId, rows); return transformToInvoice(orId); },
    onSuccess: (docId) => { setControlOpen(false); refresh(); navigate({ to: '/sales/$documentId', params: { documentId: docId } }); },
    onError: (e) => setError(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave')),
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
    onError: (e) => setError(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave')),
  });
  // Rattrapage G8 : devis de reparation qui recopie les lignes de l'OR, et duplication de l'OR.
  const repairQuote = useMutation({
    mutationFn: () => createRepairQuoteFromOr(orId, t('parcG8.repairQuoteNote')),
    onSuccess: (documentId) => navigate({ to: '/sales/$documentId/edit', params: { documentId } }),
    onError: (e) => setError(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave')),
  });
  const duplicateOr = useMutation({
    mutationFn: () => duplicateRepairOrder(orId),
    onSuccess: (newId) => { toast.success(t('parcG8.orDuplicated')); navigate({ to: '/workshop/$orId', params: { orId: newId } }); },
    onError: (e) => setError(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave')),
  });

  // Ligne d'identite : memes requetes (memes cles) que l'editeur, donc lues une seule fois.
  const identContact = useQuery({
    queryKey: ['ro-contact', data?.or.contact_id ?? null], enabled: !!data?.or.contact_id, staleTime: Infinity,
    queryFn: () => getContact(data!.or.contact_id!),
  });
  const identVehicle = useQuery({
    queryKey: ['ro-vehicle', data?.or.vehicle_id ?? null], enabled: !!data?.or.vehicle_id, staleTime: Infinity,
    queryFn: () => getVehicle(data!.or.vehicle_id!),
  });
  // Onglet par defaut fixe a l'ouverture de l'OR (selon l'etape), pour ne pas sauter d'onglet
  // quand le statut change sous les yeux (ex. « Passer pret »). `?tab=` l'emporte toujours.
  const [openTab, setOpenTab] = useState<{ orId: string; tab: OrTab } | null>(null);
  const loadedStatus = data?.or.id === orId ? data.or.status : null;
  useEffect(() => {
    if (loadedStatus && openTab?.orId !== orId) setOpenTab({ orId, tab: defaultOrTab(loadedStatus) });
  }, [loadedStatus, orId, openTab?.orId]);

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return (
    <>
      <PageHeader
        title={t('nav.workshop')}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop/planning' }, { label: t('nav.workshop') }]}
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

  const siblings = openSiblings(vehicleOrs.data ?? [], orId);
  const gedCount = ged.data?.length ?? 0;
  const goInvoice = () => { setError(null); toInvoice.mutate(); };
  const invoiceBusy = toInvoice.isPending || invoiceNow.isPending || controlAndInvoice.isPending;
  // « Dupliquer l'OR » : confirmation (le 19/11, une copie est partie d'un clic perdu dans la barre).
  const askDuplicate = async () => {
    const ok = await confirm({ title: t('orLisible.dupTitle'), message: t('orLisible.dupMessage'), confirmLabel: t('orLisible.dupOk') });
    if (ok) { setError(null); duplicateOr.mutate(); }
  };
  const canNotify = canNotifyReady({ status: or.status, hasContact: !!or.contact_id });
  const openInvoice = or.invoice_document_id
    ? () => navigate({ to: '/sales/$documentId', params: { documentId: or.invoice_document_id! } })
    : undefined;

  const tab: OrTab = search.tab ?? (openTab?.orId === orId ? openTab.tab : defaultOrTab(or.status));
  const setTab = (v: string) => {
    const next = parseOrTab(v);
    if (next) void routeNavigate({ search: (prev) => ({ ...prev, tab: next }), replace: true });
  };
  const contact = identContact.data ?? null;
  const vehicle = identVehicle.data ?? null;
  const motoName = vehicle ? motoName(vehicle) : '';

  // Ligne d'identite (lot UX atelier) : n° d'OR, client, moto + plaque, km — toujours visibles.
  const identity = (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h1 className="font-mono text-[20px] font-bold leading-tight tabular-nums">{or.number ?? t('uxAtelier.orNoNumber')}</h1>
      <span className="min-w-0 truncate text-[17px] font-bold leading-tight">{contact ? contactDisplayName(contact) : or.contact_id ? '' : t('myWorkshop.noClient')}</span>
      <span className="min-w-0 truncate text-[16px] leading-tight">
        {motoName || (or.vehicle_id ? '' : t('myWorkshop.noVehicle'))}
        {vehicle?.plate && <> · <span className="font-mono">{vehicle.plate}</span></>}
      </span>
      <span className="font-data text-[16px] leading-tight tabular-nums text-muted-foreground">
        {or.mileage != null ? fillVars(t('uxAtelier.kmValue'), { km: Number(or.mileage).toLocaleString('fr-BE') }) : t('uxAtelier.kmNone')}
      </span>
      {plannedText((or as unknown as { planned_minutes?: number | null }).planned_minutes) && (
        <span className="font-data text-[14px] leading-tight tabular-nums text-muted-foreground">{plannedText((or as unknown as { planned_minutes?: number | null }).planned_minutes)}</span>
      )}
    </div>
  );

  // Imprimer + « Plus d'actions » (lot « OR lisible ») : dans la barre d'identite. Aucune fonction retiree.
  const actions = (
    <>
      {/* Chantier C1 : la fiche complète reste, le dossier en 4 étapes est à un clic. */}
      <Button variant="outline" className="h-11" onClick={() => navigate({ to: '/workshop/dossier/$id', params: { id: orId } })}>
        <FolderOpen /> {t('dossier.openDossier')}
      </Button>
      <Button variant="outline" className="h-11" onClick={() => setPrintOpen(true)} aria-label={t('orBase.print')}>
        <Printer /> <span className="hidden xl:inline">{t('orBase.print')}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-11"><MoreHorizontal /> {t('orLisible.moreActions')} <ChevronDown className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>{t('orLisible.group_documents')}</DropdownMenuLabel>
          <DropdownMenuGroup>
            <MenuItem icon={<Printer />} onSelect={() => setPrintOpen(true)}>{t('orBase.print')}</MenuItem>
            {invoiced && openInvoice && <MenuItem icon={<Receipt />} onSelect={openInvoice}>{t('workshop.viewInvoice')}</MenuItem>}
            {!invoiced && <MenuItem icon={<FileText />} disabled={invoiceBusy || pending} onSelect={goInvoice}>{t('workshop.toInvoice')}</MenuItem>}
            {!invoiced && (
              <MenuItem icon={<ClipboardList />} onSelect={() => navigate({ to: '/sales/new', search: { contactId: or.contact_id ?? undefined, vehicleId: or.vehicle_id ?? undefined, orNumber: or.number ?? undefined, workshop: true } })}>
                {t('workshop.quoteParts')}
              </MenuItem>
            )}
            {!invoiced && <MenuItem icon={<FilePen />} disabled={repairQuote.isPending} onSelect={() => { setError(null); repairQuote.mutate(); }}>{t('parcG8.repairQuote')}</MenuItem>}
          </DropdownMenuGroup>
          {!invoiced && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('orLisible.group_parts')}</DropdownMenuLabel>
              <DropdownMenuGroup>
                <MenuItem icon={<ClipboardCheck />} disabled={toPicking.isPending} onSelect={() => { setError(null); toPicking.mutate(); }}>{t('workshop.createPicking')}</MenuItem>
                {/* Une seule facon de commander (carte 7, debut) : avec la reservation en base, le manque va au panier. */}
                {!reservationsOn && <MenuItem icon={<ShoppingCart />} onSelect={() => setOrderOpen(true)}>{t('workshop.orderMissing')}</MenuItem>}
                <MenuItem icon={<ShoppingBasket />} onSelect={() => setBasketOpen(true)}>{t('basket.addToStandard')}</MenuItem>
                {/* G8 « Prop. commande » (Stock / Dépannage / Garantie), rattrapage du 18/11/2026 */}
                {activeCompanyId && <MenuItem icon={<PackagePlus />} onSelect={() => setProposalOpen(true)}>{t('purchasesG8.propButton')}</MenuItem>}
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('orLisible.group_other')}</DropdownMenuLabel>
          <DropdownMenuGroup>
            {!invoiced && (
              <MenuItem icon={<ListChecks />} disabled={!workAllowed} onSelect={() => navigate({ to: '/workshop/journey/$orId', params: { orId } })}>
                {journeyStarted(savedJourney.data) ? t('workshop.resumeJourney') : t('workshop.startJourney')}
              </MenuItem>
            )}
            {canNotify && <MenuItem icon={<BellRing />} onSelect={() => setReadyOpen(true)}>{t('orBase.notifyReady')}</MenuItem>}
            <MenuItem icon={<CopyPlus />} disabled={duplicateOr.isPending} onSelect={() => void askDuplicate()}>{t('parcG8.duplicateOr')}</MenuItem>
            <MenuItem icon={<LifeBuoy />} disabled={accident.isPending} onSelect={() => accident.mutate()}>{accidentFile ? t('accidentFile.openExisting') : t('accidentFile.open')}</MenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  // Volet Travail, en tete : photos de reception, operations du plan, dossier accident.
  const workTop = (
    <>
      {/* Lot C (19/11) : photos et commentaires de reception, dans la GED de l'OR (vignettes). */}
      {activeCompanyId && (
        <ReceptionPanel orId={orId} orStatus={or.status} companyId={activeCompanyId} onOpen={() => setReceptionOpen({ startMode: false })} />
      )}
      {/* Lot D (19/11) : operations du plan d'entretien de la moto, cochees et tracees, « Terminer » → Pret. */}
      {activeCompanyId && (
        <PlanOpsPanel
          orId={orId} companyId={activeCompanyId} orStatus={or.status} autoInit={!!serviceCode} onChanged={refresh}
          operationExtra={(info) => <OperationExplodedButton info={info} companyId={activeCompanyId} />}
        />
      )}
      {/* OR accident : le dossier accident, bien visible (ATE001b). */}
      {(accidentOr || accidentFile) && accidentSchema.data === true && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
          <LifeBuoy className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold">{t('orPage.accidentTitle')}</p>
            <p className="text-[12px] text-muted-foreground">{accidentFile ? t('orPage.accidentLinked') : t('orPage.accidentNone')}</p>
          </div>
          {accidentFile && <AccidentStatusBadge status={accidentFile.status} />}
          <Button variant="outline" onClick={() => accident.mutate()} disabled={accident.isPending}>
            {accident.isPending ? <Loader2 className="animate-spin" /> : <LifeBuoy />} {accidentFile ? t('orPage.accidentOpenFile') : t('orPage.accidentCreateFile')}
          </Button>
        </div>
      )}
      {/* Onglet « Assurance » de G8 : sur le dossier accident de l'OR (une seule source). */}
      {accidentFile && insuranceSchema.data === true && (
        <div className="rounded-md border border-border bg-card p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('insurance.panelTitle')}</p>
          <AccidentInsurancePanel companyId={activeCompanyId!} fileId={accidentFile.id} repairOrderId={orId} orTotalTtc={Number(or.total_ttc)} origin="OR" />
        </div>
      )}
    </>
  );

  // Volet Lignes et prix, sous les lignes : pieces reservees et acompte.
  const linesBottom = (
    <>
      {(serviceCode || isMaintenanceReasonCode(reasonCode)) && or.status !== 'annule' && (
        <ReservedPartsBlock orId={orId} serviceCode={serviceCode} readOnly={invoiced} compactWhenEmpty />
      )}
      {/* Acompte sur l'OR (decision Q45 du 18/11, comme G8) : le mecanisme de l'acompte de vente. */}
      <OrDepositPanel companyId={activeCompanyId!} or={{ id: or.id, status: or.status, contact_id: or.contact_id, vehicle_id: or.vehicle_id, total_ttc: Number(or.total_ttc) }} />
    </>
  );

  return (
    <div className="touch-44">
      {/* Lot UX atelier (20/11) : barre d'identite collee en haut (n°, client, moto, km, etat + frise,
          gros bouton de l'etape suivante), puis 3 onglets Travail / Lignes et prix / Documents. */}
      <OrProgressBanner
        orId={orId} companyId={activeCompanyId} orStatus={or.status} warrantyStatus={or.warranty_status}
        workAllowed={workAllowed} warrantyPending={pending} hasService={!!serviceCode}
        invoiceBusy={invoiceBusy} fallbackWorkedMinutes={worked.data ?? 0}
        onPhotos={() => setReceptionOpen({ startMode: false })}
        onInvoice={goInvoice}
        onViewInvoice={openInvoice}
        onNotifyReady={canNotify ? () => setReadyOpen(true) : undefined}
        onApproval={checkupReady ? () => setVerbalOpen(true) : undefined}
        onChanged={refresh}
        identity={identity}
        actions={actions}
      />
      {siblings.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="font-bold">{t('orLisible.siblingsTitle')}</span>
          <span className="min-w-0 flex-1 text-foreground">{t('orLisible.siblingsHint')}</span>
          {siblings.slice(0, 3).map((o) => (
            <Button key={o.id} size="sm" variant="outline" className="h-11 gap-2 bg-card" onClick={() => navigate({ to: '/workshop/$orId', params: { orId: o.id } })}>
              {fillVars(t('orLisible.siblingOpen'), { number: o.number ?? '' })} <OrStatusBadge status={o.status} />
            </Button>
          ))}
        </div>
      )}
      {pending && <p className="mb-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('workshop.warrantyBlocked')}</p>}

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList className="h-auto w-full justify-start gap-1 p-1 sm:w-auto" aria-label={t('uxAtelier.tabsLabel')}>
          <TabsTrigger value="travail" className="h-11 flex-1 gap-2 px-4 text-[15px] sm:flex-none">
            <Wrench className="size-4" aria-hidden /> {t('uxAtelier.tab_travail')}
            {approval === 'en_attente' && (
              <span className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-warning-bg px-1.5 font-data text-[12px] font-bold text-warning">
                <PenLine className="size-3.5" aria-hidden /> {t('uxAtelier.alertApprovalShort')}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="lignes" className="h-11 flex-1 gap-2 px-4 text-[15px] sm:flex-none">
            <Euro className="size-4" aria-hidden /> {t('uxAtelier.tab_lignes')}
            <span className="hidden font-data text-[13px] tabular-nums text-muted-foreground sm:inline">{eurShort(Number(or.total_ttc))}</span>
          </TabsTrigger>
          <TabsTrigger value="documents" className="h-11 flex-1 gap-2 px-4 text-[15px] sm:flex-none">
            <FolderOpen className="size-4" aria-hidden /> {t('uxAtelier.tab_documents')}
            {gedCount > 0 && <span className="font-data text-[13px] tabular-nums text-muted-foreground">{gedCount}</span>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* L'editeur reste monte d'un onglet a l'autre (une saisie n'est jamais perdue) : seuls ses volets changent. */}
      <OrEditor
        companyId={activeCompanyId!} initial={data} busy={busy} error={error} onSubmit={onSubmit}
        checkupReady={checkupReady && !invoiced} approvalPending={approval === 'en_attente'}
        expertInPanel={!!accidentFile && insuranceSchema.data === true}
        pane={editorPane(tab)} workTop={workTop} linesBottom={linesBottom}
        header={checkupReady ? (
          <ApprovalPanel
            or={orx} compactWhenNone
            onVerbal={() => setVerbalOpen(true)}
            onSignAtCounter={() => signAtCounter.mutate()} signBusy={signAtCounter.isPending}
            onOpenProposal={orx.proposal_document_id ? () => navigate({ to: '/sales/$documentId', params: { documentId: orx.proposal_document_id! } }) : undefined}
            onResend={orx.proposal_document_id ? () => resend.mutate() : undefined}
          />
        ) : null}
      />

      {tab === 'documents' && (
        <div className="space-y-4">
          {/* Impressions : l'OR / la fiche de travail, et les documents de vente lies a l'OR. */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-[17px] font-bold"><Printer className="size-5" aria-hidden /> {t('uxAtelier.docsPrintTitle')}</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-11" onClick={() => setPrintOpen(true)}><Printer /> {t('orBase.print')}</Button>
              {openInvoice && <Button variant="outline" className="h-11" onClick={openInvoice}><Receipt /> {t('workshop.viewInvoice')}</Button>}
              {orx.proposal_document_id && (
                <Button variant="outline" className="h-11" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: orx.proposal_document_id! } })}>
                  <FileText /> {t('checkup.openProposal')}
                </Button>
              )}
            </div>
          </section>
          {/* GED de l'OR (photos de reception, check-up, documents joints). */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 flex flex-wrap items-center gap-2 text-[17px] font-bold">
              <Paperclip className="size-5" aria-hidden /> {t('orLisible.gedTitle')}
              <span className="text-[14px] font-normal text-muted-foreground">{gedCount ? fillVars(t('orLisible.gedCount'), { n: gedCount }) : t('orLisible.gedNone')}</span>
            </h2>
            <AttachmentsPanel companyId={activeCompanyId!} entityType="repair_order" entityId={orId} />
          </section>
          {/* Historique atelier de la moto (B8 : historique cumule par vehicule). */}
          {or.vehicle_id && (
            <section className="rounded-md border border-border bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-[17px] font-bold"><History className="size-5" aria-hidden /> {t('uxAtelier.docsHistoryTitle')}</h2>
              <VehicleWorkshopHistoryPanel vehicleId={or.vehicle_id} />
            </section>
          )}
        </div>
      )}
      {proposalOpen && activeCompanyId && <ProposalAddDialog companyId={activeCompanyId} kind="repair_order" sourceId={orId} onClose={() => setProposalOpen(false)} />}
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
      {receptionOpen && activeCompanyId && (
        <ReceptionSheet
          open orId={orId} orNumber={or.number} companyId={activeCompanyId} startMode={receptionOpen.startMode}
          onClose={() => setReceptionOpen(null)}
          onDone={() => { const go = receptionOpen.go; setReceptionOpen(null); go?.(); }}
        />
      )}
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
    </div>
  );
}

/** Entree du menu « Plus d'actions » : icone + libelle, hauteur tactile. */
function MenuItem({ icon, children, onSelect, disabled }: { icon: ReactNode; children: ReactNode; onSelect: () => void; disabled?: boolean }) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="min-h-11 gap-2 text-[14px] [&_svg]:size-4">
      {icon} {children}
    </DropdownMenuItem>
  );
}

/** Total TTC court sur l'onglet « Lignes et prix » (separateur de milliers, 2 decimales). */
function eurShort(n: number): string {
  return `${(Number.isFinite(n) ? n : 0).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
