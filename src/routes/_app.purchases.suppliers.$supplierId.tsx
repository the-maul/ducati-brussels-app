import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContactForm } from '@/modules/contacts/contact-form';
import { getContact, updateContact, contactDisplayName, type ContactInsert } from '@/modules/contacts/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t, pageTitle } from '@/lib/i18n';
import { useSaveMutation } from '@/lib/use-save-mutation';
import { WarrantyReturnsPanel } from '@/modules/workshop/warranty/warranty-views';
import { useCanWrite } from '@/lib/auth/use-access';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SupplierConditionsPanel, SupplierDocumentsPanel, SupplierTurnoverPanel, YearEndRebatesPanel } from '@/modules/purchases/supplier-tabs';

export const Route = createFileRoute('/_app/purchases/suppliers/$supplierId')({
  head: () => ({ meta: [{ title: pageTitle('supplier') }] }),
  component: EditSupplier,
});

function EditSupplier() {
  const { supplierId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const canWrite = useCanWrite();

  const { data: contact, isLoading } = useQuery({ queryKey: ['contact', supplierId], queryFn: () => getContact(supplierId) });

  const m = useSaveMutation({
    mutationFn: (payload: ContactInsert) => updateContact(supplierId, payload),
    success: t('feedback.saved'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['contact', supplierId] });
    },
    // Différé de SETTLE_MS : laisse voir la coche du bouton avant de quitter l'écran.
    onDone: () => navigate({ to: '/purchases/suppliers' }),
    onError: (e) => setError(e instanceof Error ? e.message : t('contacts.errSave')),
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!contact || !activeCompanyId) return <><PageHeader title={t('purchases.suppliersTitle')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('contacts.errLoad')}</p></>;

  return (
    <>
      <PageHeader title={contactDisplayName(contact)} description={t('purchases.suppliersTitle')} />
      {/* Rattrapage G8 (18/11/2026) : onglets de la fiche fournisseur G8 à côté de la fiche contact. */}
      <Tabs defaultValue="fiche">
        <TabsList className="mb-3 flex-wrap">
          <TabsTrigger value="fiche">{t('purchasesG8.supTab_fiche')}</TabsTrigger>
          <TabsTrigger value="conditions">{t('purchasesG8.supTab_conditions')}</TabsTrigger>
          <TabsTrigger value="documents">{t('purchasesG8.supTab_documents')}</TabsTrigger>
          <TabsTrigger value="ca">{t('purchasesG8.supTab_ca')}</TabsTrigger>
          <TabsTrigger value="rfa">{t('purchasesG8.supTab_rfa')}</TabsTrigger>
          <TabsTrigger value="garantie">{t('warranty.supplierTitle')}</TabsTrigger>
        </TabsList>
        <TabsContent value="fiche">
          <ContactForm
            initial={contact}
            companyId={activeCompanyId}
            lockType="fournisseur"
            status={m.status}
            error={error}
            onSubmit={(p) => { setError(null); m.mutate(p); }}
            onCancel={() => navigate({ to: '/purchases/suppliers' })}
          />
        </TabsContent>
        <TabsContent value="conditions"><SupplierConditionsPanel supplierId={supplierId} readOnly={!canWrite} /></TabsContent>
        <TabsContent value="documents"><SupplierDocumentsPanel companyId={activeCompanyId} supplierId={supplierId} /></TabsContent>
        <TabsContent value="ca"><SupplierTurnoverPanel supplierId={supplierId} /></TabsContent>
        <TabsContent value="rfa"><YearEndRebatesPanel companyId={activeCompanyId} supplierId={supplierId} /></TabsContent>
        {/* Fiche fournisseur › Garantie (G8) : retours / remboursements de ce fournisseur (rattrapage G8). */}
        <TabsContent value="garantie">
          <p className="mb-3 text-[13px] text-muted-foreground">{t('warranty.supplierHint')}</p>
          <WarrantyReturnsPanel companyId={activeCompanyId} supplierId={supplierId} />
        </TabsContent>
      </Tabs>
    </>
  );
}
