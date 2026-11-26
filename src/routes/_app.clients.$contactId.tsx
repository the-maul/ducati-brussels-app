import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, FileText, ExternalLink, Tags, Star, AlertTriangle, Archive, ArchiveRestore, Merge, Search, Trash2, ChevronDown, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ContactForm } from '@/modules/contacts/contact-form';
import { ContactLabelDialog } from '@/modules/contacts/contact-label-dialog';
import { ModelInterestBadges } from '@/modules/contacts/model-interest-badges';
import { ParcTab, DeliveryTab, PriceRulesTab, EncoursBar, DocumentsTab, DueItemsTab, SubcontactsTab } from '@/modules/contacts/client-tabs';
import { ClientReceivablesTab } from '@/modules/receivables/client-receivables-tab';
import { DeferredPanel } from '@/modules/workshop/checkup/deferred';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { CommunicationsPanel } from '@/modules/crm/communications-panel';
import {
  getContact, updateContact, archiveContact, unarchiveContact, mergeContacts, mergeErrorMessage, listContacts,
  contactDisplayName, getModelInterests, getWatchNote, contactDependencies, deleteContact, getContactPortalVisit,
  type ContactInsert, type Contact,
} from '@/modules/contacts/api';
import { MergeSummary, useMergePreviews } from '@/modules/contacts/merge-summary';
import {
  RgpdTab, GroupsTab, GroupSalesTab, DispoTab, AppointmentsTab, FollowupsTab, ImagesTab, ArchivesTab, CampaignHistoryTab,
} from '@/modules/contacts/g8/client-g8-tabs';
import { RgpdMenu, MessageTestMenu } from '@/modules/contacts/g8/fiche-actions';
import { getDebtorsList } from '@/modules/accounting/api';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { sendAccountInvitation } from '@/modules/settings/users-api';
import { t, pageTitle, fillVars } from '@/lib/i18n';
import {
  clientMainTabs, tabForContact, CLIENT_MORE_TABS, CLIENT_TAB_LABEL, CLIENT_DEFAULT_TAB, isMoreTab, parseClientTab, type ClientTab,
} from '@/modules/contacts/fiche-tabs';
import { useSaveMutation } from '@/lib/use-save-mutation';

const eurFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

export const Route = createFileRoute('/_app/clients/$contactId')({
  head: () => ({ meta: [{ title: pageTitle('client') }] }),
  // Lot design des fiches (20/11/2026) : l'onglet de la fiche est gardé dans l'adresse (?tab=).
  validateSearch: (s: Record<string, unknown>): { tab?: ClientTab } => ({ tab: parseClientTab(s.tab) }),
  component: EditClient,
});

function EditClient() {
  const { contactId } = Route.useParams();
  const search = Route.useSearch();
  const routeNavigate = Route.useNavigate();
  const requestedTab: ClientTab = search.tab ?? CLIENT_DEFAULT_TAB;
  const setTab = (v: string) => {
    const next = parseClientTab(v);
    if (next) void routeNavigate({ search: (prev) => ({ ...prev, tab: next === CLIENT_DEFAULT_TAB ? undefined : next }), replace: true });
  };
  const { activeCompanyId, isAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [debtorAlertOpen, setDebtorAlertOpen] = useState(false);
  const debtorAlertShown = useRef(false);

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => getContact(contactId),
  });
  // CON002 : un onglet masqué pour ce type (Atelier d'une banque) retombe sur « L'essentiel ».
  const tab = tabForContact(requestedTab, contact?.type);

  const { data: debtors } = useQuery({
    queryKey: ['debtors-list', activeCompanyId],
    queryFn: () => getDebtorsList(activeCompanyId!, new Date().toISOString().slice(0, 10)),
    enabled: !!activeCompanyId,
  });
  const debtorRow = debtors?.find((d) => d.contact_id === contactId);

  // Espace client (P-6) : jamais ouvert / dernière visite.
  const { data: portalVisit, isSuccess: portalVisitLoaded } = useQuery({
    queryKey: ['contact-portal-visit', contactId],
    queryFn: () => getContactPortalVisit(contactId),
  });

  // Renvoyer au client le lien « choisir mon mot de passe » (Simon, 05/10) : utile quand
  // le mail d'inscription n'est pas arrivé, ou quand le client ne l'a jamais ouvert.
  const resendInvite = useMutation({
    mutationFn: async () => {
      if (!activeCompanyId || !portalVisit?.user_id) throw new Error('missing');
      const r = await sendAccountInvitation(activeCompanyId, portalVisit.user_id);
      if (r.error) throw new Error(r.error);
      return r;
    },
    onSuccess: (r) => toast.success(t('contacts.portalResendOk').replace('{email}', r.to ?? contact?.email ?? '')),
    onError: (e) => toast.error(t('contacts.portalResendErr').replace('{code}', e instanceof Error ? e.message : 'erreur')),
  });

  useEffect(() => {
    if (!debtorAlertShown.current && debtorRow && debtorRow.total_due > 0) {
      debtorAlertShown.current = true;
      setDebtorAlertOpen(true);
    }
  }, [debtorRow]);

  const m = useSaveMutation({
    mutationFn: (payload: ContactInsert) => updateContact(contactId, payload),
    success: t('feedback.saved'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
    },
    // Différé de SETTLE_MS : laisse voir la coche du bouton avant de quitter l'écran.
    onDone: () => navigate({ to: '/clients' }),
    onError: (e) => setError(e instanceof Error ? e.message : t('contacts.errSave')),
  });

  // Suppression d'un modèle d'intérêt depuis l'en-tête — patch ciblé, sans quitter la fiche.
  const removeModel = useMutation({
    mutationFn: (models: string[]) => updateContact(contactId, { model_interests: models } as unknown as ContactInsert),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
    },
  });

  const [mergeOpen, setMergeOpen] = useState(false);

  const archive = useMutation({
    // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
    meta: { success: false, error: false },
    mutationFn: () => archiveContact(contactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(t('contacts.archived'));
      navigate({ to: '/clients' });
    },
    onError: () => toast.error(t('contacts.errSave')),
  });

  const unarchive = useMutation({
    // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
    meta: { success: false, error: false },
    mutationFn: () => unarchiveContact(contactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      toast.success(t('contacts.unarchived'));
    },
    onError: () => toast.error(t('contacts.errSave')),
  });

  // ── Suppression definitive ──────────────────────────────────────────
  // Reservee aux fiches vierges : la base refuse si la moindre donnee metier
  // est rattachee, auquel cas on propose l'archivage (regle 4, audit preserve).
  const confirm = useConfirm();
  const del = useMutation({
    // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
    meta: { success: false, error: false },
    mutationFn: () => deleteContact(contactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(t('contacts.deleted'));
      navigate({ to: '/clients' });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t('contacts.errSave')),
  });

  const askDelete = async () => {
    // Idem : sans catch, un rejet laisserait le bouton Supprimer muet.
    let deps;
    try {
      deps = await contactDependencies(contactId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('contacts.errSave'));
      return;
    }
    if (deps.length > 0) {
      const ok = await confirm({
        title: t('contacts.deleteBlockedTitle'),
        message: t('contacts.deleteBlockedMessage'),
        confirmLabel: t('contacts.deleteBlockedArchive'),
      });
      if (ok) archive.mutate();
      return;
    }
    const ok = await confirm({
      title: t('contacts.deleteTitle'),
      message: t('contacts.deleteMessage'),
      variant: 'delete',
    });
    if (ok) del.mutate();
  };

  if (isLoading) {
    return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!contact || !activeCompanyId) {
    return (
      <>
        <PageHeader
          title={t('contacts.title')}
          breadcrumbs={[{ label: t('nav.clients'), to: '/clients' }, { label: t('contacts.title') }]}
        />
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('contacts.errLoad')}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {contactDisplayName(contact)}
            {/* title sur un <span> : les icones lucide ne l'acceptent pas,
                l'infobulle ne s'affichait donc pas. */}
            {contact.is_vip && (
              <span title={t('contacts.flagVip')} className="inline-flex">
                <Star className="size-4 shrink-0 fill-current text-warning" />
              </span>
            )}
            {contact.is_watch && (
              <span title={getWatchNote(contact) ?? t('contacts.flagWatch')} className="inline-flex">
                <AlertTriangle className="size-4 shrink-0 text-danger" />
              </span>
            )}
            {!contact.is_active && <StatusBadge tone="neutral" icon={Archive} label={t('contacts.archivedBadge')} />}
          </span>
        }
        description={t('contacts.edit')}
        breadcrumbs={[{ label: t('nav.clients'), to: '/clients' }, { label: contactDisplayName(contact) }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {contact.ducati_url && (
              <Button
                variant="outline"
                onClick={() => window.open(contact.ducati_url!, '_blank', 'noopener,noreferrer')}
                title={contact.ducati_url}
              >
                <ExternalLink /> {t('contacts.ducatiView')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setLabelOpen(true)}><Tags /> {t('contacts.labelBtn')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/sales/new', search: { contactId } })}><FileText /> {t('contacts.newDoc')}</Button>
            {/* Rattrapage G8 (18/11/2026) : RGPD - Edition fiche / Portabilite, Mail / SMS en essai. */}
            <RgpdMenu contactId={contactId} />
            <MessageTestMenu contact={contact} companyId={activeCompanyId} />
            {/* Revue UX/UI : fusion, archivage et suppression rangés sous « Outils », à part. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><Wrench /> {t('designFiches.tools')} <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Fusion reservee aux admins (decision F-9, controle aussi par contact_merge). */}
                {isAdmin(activeCompanyId) && (
                  <DropdownMenuItem onSelect={() => setMergeOpen(true)}><Merge className="size-4" /> {t('contacts.merge')}</DropdownMenuItem>
                )}
                {contact.is_active ? (
                  <DropdownMenuItem
                    disabled={archive.isPending}
                    onSelect={() => { if (window.confirm(t('contacts.archiveConfirm'))) archive.mutate(); }}
                  >
                    <Archive className="size-4" /> {t('contacts.archive')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled={unarchive.isPending} onSelect={() => unarchive.mutate()}>
                    <ArchiveRestore className="size-4" /> {t('contacts.unarchive')}
                  </DropdownMenuItem>
                )}
                {/* Suppression physique reservee aux admins (policy RLS contacts_delete). */}
                {isAdmin() && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={del.isPending} onSelect={() => { void askDelete(); }} className="text-danger focus:text-danger">
                      <Trash2 className="size-4" /> {t('contacts.delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <ContactLabelDialog open={labelOpen} onOpenChange={setLabelOpen} companyId={activeCompanyId} contact={contact} />
      <MergeContactDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        companyId={activeCompanyId}
        keepContact={contact}
        onMerged={() => qc.invalidateQueries()}
      />
      <Dialog open={debtorAlertOpen} onOpenChange={setDebtorAlertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('contacts.debtorAlertTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-foreground">
            {t('contacts.debtorAlertBody').replace('{amount}', eurFormat.format(debtorRow?.total_due ?? 0))}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDebtorAlertOpen(false)}>{t('common.no')}</Button>
            <Button
              onClick={() => {
                // TODO: brancher flux paiement M6
                setDebtorAlertOpen(false);
              }}
            >
              {t('contacts.debtorSettle')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {getModelInterests(contact).length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
            {t('contacts.modelInterestsTitle')}
          </span>
          <ModelInterestBadges
            models={getModelInterests(contact)}
            onRemove={(model) => removeModel.mutate(getModelInterests(contact).filter((x) => x !== model))}
          />
        </div>
      )}
      {portalVisitLoaded && (
        <p
          className="mb-3 text-[12px] text-muted-foreground"
          title={portalVisit && !portalVisit.first_visit_at ? t('contacts.portalNeverHint') : undefined}
        >
          <span className="font-bold uppercase tracking-[0.04em]">{t('contacts.portalSpace')}</span>
          {' : '}
          {!portalVisit
            ? t('contacts.portalNoAccount')
            : !portalVisit.first_visit_at
              ? t('contacts.portalNeverOpened')
              : t('contacts.portalLastVisit').replace(
                  '{date}',
                  new Date(portalVisit.last_visit_at ?? portalVisit.first_visit_at).toLocaleString('fr-BE', {
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  }),
                )}
          {portalVisit?.user_id && isAdmin() && (
            <Button
              variant="outline"
              size="sm"
              className="ml-3 h-7 align-middle"
              title={t('contacts.portalResendHint')}
              onClick={() => resendInvite.mutate()}
              disabled={resendInvite.isPending}
            >
              {resendInvite.isPending ? <Loader2 className="animate-spin" /> : null} {t('contacts.portalResend')}
            </Button>
          )}
        </p>
      )}
      <EncoursBar contactId={contactId} />
      {/* Revue UX/UI (20/11/2026) : 20 onglets ramenés à 5 + « Plus ». Rien ne disparaît, tout se range
          (ancien onglet → nouvel onglet : LEGACY_CLIENT_TAB dans modules/contacts/fiche-tabs.ts). */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          {clientMainTabs(contact.type).map((v) => (
            <TabsTrigger key={v} value={v}>{t(CLIENT_TAB_LABEL[v])}</TabsTrigger>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-state={isMoreTab(tab) ? 'active' : 'inactive'}
                className="inline-flex cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow"
              >
                {isMoreTab(tab) ? fillVars(t('designFiches.tabMoreActive'), { tab: t(CLIENT_TAB_LABEL[tab]) }) : t('designFiches.tabMore')}
                <ChevronDown className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {CLIENT_MORE_TABS.map((v) => (
                <DropdownMenuItem key={v} onSelect={() => setTab(v)} className={v === tab ? 'font-bold' : undefined}>
                  {t(CLIENT_TAB_LABEL[v])}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </TabsList>
        {/* forceMount : passer sur un autre onglet ne perd pas une saisie en cours (le formulaire reste monté). */}
        <TabsContent value="essentiel" forceMount className="mt-4 data-[state=inactive]:hidden">
          <ContactForm
            key={`${contact.my_ducati_synced_at ?? contact.id}|${getModelInterests(contact).join(',')}`}
            initial={contact}
            companyId={activeCompanyId}
            status={m.status}
            error={error}
            onSubmit={(p) => { setError(null); m.mutate(p); }}
            onCancel={() => navigate({ to: '/clients' })}
          />
        </TabsContent>
        <TabsContent value="motos" className="mt-4"><ParcTab contactId={contactId} /></TabsContent>
        <TabsContent value="atelier" className="mt-4 space-y-6">
          <Block title={t('designFiches.secAppointments')}><AppointmentsTab contactId={contactId} /></Block>
          <DeferredPanel contactId={contactId} />
          <Block title={t('designFiches.secParts')}><DispoTab contactId={contactId} /></Block>
        </TabsContent>
        <TabsContent value="documents" className="mt-4 space-y-6">
          <Block title={t('designFiches.secSalesDocs')}><DocumentsTab contactId={contactId} /></Block>
          <Block title={t('designFiches.secAttachments')}><AttachmentsPanel companyId={activeCompanyId} entityType="contact" entityId={contactId} /></Block>
          <Block title={t('designFiches.secImages')}><ImagesTab contactId={contactId} companyId={activeCompanyId} /></Block>
        </TabsContent>
        <TabsContent value="relances" className="mt-4 space-y-6">
          <Block title={t('designFiches.secDueInvoices')}><DueItemsTab contactId={contactId} /></Block>
          <Block title={t('designFiches.secPayments')}><ClientReceivablesTab companyId={activeCompanyId} contactId={contactId} contactName={contact.company_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ')} /></Block>
          <Block title={t('designFiches.secMaintenance')}><FollowupsTab contactId={contactId} /></Block>
        </TabsContent>
        <TabsContent value="livraisons" className="mt-4"><DeliveryTab contactId={contactId} /></TabsContent>
        <TabsContent value="interlocuteurs" className="mt-4"><SubcontactsTab contactId={contactId} companyId={activeCompanyId} bank={contact.type === 'banque_leasing'} /></TabsContent>
        <TabsContent value="tarifs" className="mt-4"><PriceRulesTab contactId={contactId} companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="communications" className="mt-4"><CommunicationsPanel companyId={activeCompanyId} contactId={contactId} /></TabsContent>
        <TabsContent value="emails" className="mt-4"><CampaignHistoryTab contactId={contactId} /></TabsContent>
        <TabsContent value="rgpd" className="mt-4"><RgpdTab contact={contact} companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="groupes" className="mt-4"><GroupsTab contactId={contactId} companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="groupement" className="mt-4"><GroupSalesTab contactId={contactId} companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="archives" className="mt-4"><ArchivesTab contactId={contactId} /></TabsContent>
      </Tabs>
    </>
  );
}

/** Rubrique d'un onglet qui en regroupe plusieurs (ex. Documents = devis/factures + GED + images). */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-ui text-[15px] font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Recherche + confirmation d'une fusion de fiche DANS la fiche courante (keepContact). */
function MergeContactDialog({ open, onOpenChange, companyId, keepContact, onMerged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  keepContact: Contact;
  onMerged: () => void;
}) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  const [candidate, setCandidate] = useState<Contact | null>(null);

  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({
    queryKey: ['contact-merge-pick', companyId, deb],
    queryFn: () => listContacts(companyId, deb),
    enabled: open && deb.length >= 2,
  });
  const results = (data ?? []).filter((c) => c.id !== keepContact.id);

  const reset = () => { setTerm(''); setDeb(''); setCandidate(null); };

  const absorbed = candidate ? [candidate] : [];
  const preview = useMergePreviews(keepContact, absorbed, open && !!candidate);

  const merge = useMutation({
    // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
    meta: { success: false, error: false },
    mutationFn: () => mergeContacts(keepContact.id, candidate!.id),
    onSuccess: () => {
      onMerged();
      toast.success(t('contacts.merged'));
      reset();
      onOpenChange(false);
    },
    // Transaction SQL : un refus n'a rien modifié. On dit pourquoi.
    onError: (e) => toast.error(mergeErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('contacts.mergeTitle')}</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">{t('contacts.mergeHint')}</p>
        {candidate ? (
          <div className="space-y-3">
            <p className="text-sm">
              {t('contacts.mergeConfirmQuestion')
                .replace('{name}', contactDisplayName(candidate))
                .replace('{kept}', contactDisplayName(keepContact))}
            </p>
            <MergeSummary keep={keepContact} absorbed={absorbed} preview={preview} />
            <Button variant="outline" size="sm" onClick={() => setCandidate(null)}>{t('contacts.mergeBack')}</Button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('contacts.mergeSearchPlaceholder')}
              className="pl-9"
            />
            {deb.length >= 2 && (
              <div className="mt-1 max-h-60 overflow-auto rounded-md border border-border">
                {results.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{t('contacts.empty')}</p>}
                {results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCandidate(c)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    {contactDisplayName(c)}
                    {c.code ? <span className="ml-2 font-mono text-[12px] text-muted-foreground">{c.code}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('contacts.mergeCancel')}</Button>
          <Button
            disabled={!candidate || merge.isPending || !preview.ready || preview.blocked}
            onClick={() => merge.mutate()}
          >
            {merge.isPending ? <Loader2 className="animate-spin" /> : <Merge />} {t('contacts.mergeConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
