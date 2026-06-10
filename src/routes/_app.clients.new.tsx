import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { ContactForm } from '@/modules/contacts/contact-form';
import { createContact, type ContactInsert } from '@/modules/contacts/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/clients/new')({
  head: () => ({ meta: [{ title: 'Nouveau client — Ducati Bruxelles' }] }),
  component: NewClient,
});

function NewClient() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: (payload: ContactInsert) => createContact(payload),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      navigate({ to: '/clients/$contactId', params: { contactId: c.id } });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('contacts.errSave')),
  });

  if (!activeCompanyId) return null;

  return (
    <>
      <PageHeader title={t('contacts.new')} />
      <ContactForm
        initial={null}
        companyId={activeCompanyId}
        submitting={m.isPending}
        error={error}
        onSubmit={(p) => { setError(null); m.mutate(p); }}
        onCancel={() => navigate({ to: '/clients' })}
      />
    </>
  );
}
