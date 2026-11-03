/**
 * M6 — Rouvrir un brouillon dans l'éditeur (mission 08, carte 1, 03/11/2026).
 * Réservé aux brouillons : un document validé est figé (B7) et renvoie vers sa fiche.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { DocumentEditor } from '@/modules/sales/document-editor';
import { getDocumentFull, isDraftDocument } from '@/modules/sales/write-api';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/sales/$documentId_/edit')({
  head: () => ({ meta: [{ title: pageTitle('salesEdit') }] }),
  component: EditDraft,
});

function EditDraft() {
  const { documentId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['doc-full', documentId], queryFn: () => getDocumentFull(documentId) });
  if (!activeCompanyId) return null;
  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  const back = <Button variant="outline" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId } })}><ArrowLeft /> {t('sales.backToDoc')}</Button>;
  if (!data) return (
    <>
      <PageHeader title={t('sales.editDraft')} breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('sales.editDraft') }]} actions={back} />
      <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('sales.notFound')}</p>
    </>
  );
  if (!isDraftDocument(data.doc)) return (
    <>
      <PageHeader title={`${t(`sales.type_${data.doc.doc_type}`)} ${data.doc.number ?? ''}`} breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: data.doc.number ?? t('sales.draftSuffix') }]} actions={back} />
      <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('sales.notDraft')}</p>
    </>
  );
  return (
    <>
      <PageHeader
        title={`${t('sales.editDraft')} — ${t(`sales.type_${data.doc.doc_type}`)}`}
        description={t('sales.editDraftHint')}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: `${t('sales.draftSuffix')} · ${t('action.edit')}` }]}
        actions={back}
      />
      <DocumentEditor companyId={data.doc.company_id} draft={data} />
    </>
  );
}
