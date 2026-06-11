import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContactForm } from '@/modules/contacts/contact-form';
import { getContact, updateContact, contactDisplayName, type ContactInsert } from '@/modules/contacts/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/purchases/suppliers/$supplierId')({
  head: () => ({ meta: [{ title: 'Fiche fournisseur — Ducati Bruxelles' }] }),
  component: EditSupplier,
});

function EditSupplier() {
  const { supplierId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: contact, isLoading } = useQuery({ queryKey: ['contact', supplierId], queryFn: () => getContact(supplierId) });

  const m = useMutation({
    mutationFn: (payload: ContactInsert) => updateContact(supplierId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['contact', supplierId] });
      navigate({ to: '/purchases/suppliers' });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('contacts.errSave')),
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!contact || !activeCompanyId) return <><PageHeader title={t('purchases.suppliersTitle')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('contacts.errLoad')}</p></>;

  return (
    <>
      <PageHeader title={contactDisplayName(contact)} description={t('purchases.suppliersTitle')} />
      <ContactForm
        initial={contact}
        companyId={activeCompanyId}
        lockType="fournisseur"
        submitting={m.isPending}
        error={error}
        onSubmit={(p) => { setError(null); m.mutate(p); }}
        onCancel={() => navigate({ to: '/purchases/suppliers' })}
      />
    </>
  );
}
