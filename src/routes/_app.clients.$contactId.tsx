import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, FileText, ExternalLink, Tags, Star, AlertTriangle, Archive, ArchiveRestore, Merge, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ContactForm } from '@/modules/contacts/contact-form';
import { ContactLabelDialog } from '@/modules/contacts/contact-label-dialog';
import { ModelInterestBadges } from '@/modules/contacts/model-interest-badges';
import { ParcTab, DeliveryTab, PriceRulesTab, EncoursBar, DocumentsTab, DueItemsTab, SubcontactsTab } from '@/modules/contacts/client-tabs';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { CommunicationsPanel } from '@/modules/crm/communications-panel';
import {
  getContact, updateContact, archiveContact, unarchiveContact, mergeContacts, mergeErrorMessage, listContacts,
  contactDisplayName, getModelInterests, getWatchNote, contactDependencies, deleteContact,
  type ContactInsert, type Contact,
} from '@/modules/contacts/api';
import { MergeSummary, useMergePreviews } from '@/modules/contacts/merge-summary';
import { getDebtorsList } from '@/modules/accounting/api';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { useSaveMutation } from '@/lib/use-save-mutation';

const eurFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

export const Route = createFileRoute('/_app/clients/$contactId')({
  head: () => ({ meta: [{ title: 'Fiche client — Ducati Bruxelles' }] }),
  component: EditClient,
});

function EditClient() {
  const { contactId } = Route.useParams();
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

  const { data: debtors } = useQuery({
    queryKey: ['debtors-list', activeCompanyId],
    queryFn: () => getDebtorsList(activeCompanyId!, new Date().toISOString().slice(0, 10)),
    enabled: !!activeCompanyId,
  });
  const debtorRow = debtors?.find((d) => d.contact_id === contactId);

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
            <Button variant="outline" onClick={() => navigate({ to: '/sales/new', search: { contactId } })}><FileText /> Nouveau document</Button>
            {/* Fusion reservee aux admins (decision F-9, controle aussi par contact_merge). */}
            {isAdmin(activeCompanyId) && (
              <Button variant="outline" onClick={() => setMergeOpen(true)}><Merge /> {t('contacts.merge')}</Button>
            )}
            {contact.is_active ? (
              <Button
                variant="outline"
                disabled={archive.isPending}
                onClick={() => { if (window.confirm(t('contacts.archiveConfirm'))) archive.mutate(); }}
              >
                <Archive /> {t('contacts.archive')}
              </Button>
            ) : (
              <Button variant="outline" disabled={unarchive.isPending} onClick={() => unarchive.mutate()}>
                <ArchiveRestore /> {t('contacts.unarchive')}
              </Button>
            )}
            {/* Suppression physique reservee aux admins (policy RLS contacts_delete). */}
            {isAdmin() && (
              <Button variant="outline" disabled={del.isPending} onClick={() => { void askDelete(); }}>
                <Trash2 className="text-danger" /> {t('contacts.delete')}
              </Button>
            )}
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
      <EncoursBar contactId={contactId} />
      <Tabs defaultValue="fiche">
        <TabsList>
          <TabsTrigger value="fiche">Fiche</TabsTrigger>
          <TabsTrigger value="parc">Parc</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="echeances">Échéances</TabsTrigger>
          <TabsTrigger value="livraisons">Livraisons</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="tarifs">Tarifs</TabsTrigger>
          <TabsTrigger value="documents-ged">{t('ged.title')}</TabsTrigger>
          <TabsTrigger value="comms">{t('crm.history')}</TabsTrigger>
        </TabsList>
        <TabsContent value="fiche" className="mt-4">
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
        <TabsContent value="parc" className="mt-4"><ParcTab contactId={contactId} /></TabsContent>
        <TabsContent value="documents" className="mt-4"><DocumentsTab contactId={contactId} /></TabsContent>
        <TabsContent value="echeances" className="mt-4"><DueItemsTab contactId={contactId} /></TabsContent>
        <TabsContent value="livraisons" className="mt-4"><DeliveryTab contactId={contactId} /></TabsContent>
        <TabsContent value="contacts" className="mt-4"><SubcontactsTab contactId={contactId} /></TabsContent>
        <TabsContent value="tarifs" className="mt-4"><PriceRulesTab contactId={contactId} companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="documents-ged" className="mt-4"><AttachmentsPanel companyId={activeCompanyId} entityType="contact" entityId={contactId} /></TabsContent>
        <TabsContent value="comms" className="mt-4"><CommunicationsPanel companyId={activeCompanyId} contactId={contactId} /></TabsContent>
      </Tabs>
    </>
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
