import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ContactForm } from '@/modules/contacts/contact-form';
import { ParcTab, DeliveryTab, PriceRulesTab } from '@/modules/contacts/client-tabs';
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
      <PageHeader title={contactDisplayName(contact)} description={t('contacts.edit')} />
      <Tabs defaultValue="fiche">
        <TabsList>
          <TabsTrigger value="fiche">Fiche</TabsTrigger>
          <TabsTrigger value="parc">Parc</TabsTrigger>
          <TabsTrigger value="livraisons">Livraisons</TabsTrigger>
          <TabsTrigger value="tarifs">Tarifs</TabsTrigger>
        </TabsList>
        <TabsContent value="fiche" className="mt-4">
          <ContactForm
            initial={contact}
            companyId={activeCompanyId}
            submitting={m.isPending}
            error={error}
            onSubmit={(p) => { setError(null); m.mutate(p); }}
            onCancel={() => navigate({ to: '/clients' })}
          />
        </TabsContent>
        <TabsContent value="parc" className="mt-4"><ParcTab contactId={contactId} /></TabsContent>
        <TabsContent value="livraisons" className="mt-4"><DeliveryTab contactId={contactId} /></TabsContent>
        <TabsContent value="tarifs" className="mt-4"><PriceRulesTab contactId={contactId} companyId={activeCompanyId} /></TabsContent>
      </Tabs>
    </>
  );
}
