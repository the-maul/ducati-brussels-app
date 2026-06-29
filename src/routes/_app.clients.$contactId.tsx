import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, FileText, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ContactForm } from '@/modules/contacts/contact-form';
import { ParcTab, DeliveryTab, PriceRulesTab, EncoursBar, DocumentsTab, DueItemsTab, SubcontactsTab } from '@/modules/contacts/client-tabs';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { CommunicationsPanel } from '@/modules/crm/communications-panel';
import {
  getContact, updateContact, contactDisplayName, type ContactInsert,
} from '@/modules/contacts/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/clients/$contactId')({
  head: () => ({ meta: [{ title: 'Fiche client — Ducati Bruxelles' }] }),
  component: EditClient,
});

function EditClient() {
  const { contactId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => getContact(contactId),
  });

  const m = useMutation({
    mutationFn: (payload: ContactInsert) => updateContact(contactId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      navigate({ to: '/clients' });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('contacts.errSave')),
  });

  if (isLoading) {
    return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!contact || !activeCompanyId) {
    return (
      <>
        <PageHeader title={t('contacts.title')} />
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('contacts.errLoad')}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={contactDisplayName(contact)}
        description={t('contacts.edit')}
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
            <Button variant="outline" onClick={() => navigate({ to: '/sales/new', search: { contactId } })}><FileText /> Nouveau document</Button>
          </div>
        }
      />
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
            key={contact.my_ducati_synced_at ?? contact.id}
            initial={contact}
            companyId={activeCompanyId}
            submitting={m.isPending}
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
