import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileSpreadsheet, Loader2, Mail, Printer, Redo2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, pageTitle } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { DocumentListPanel } from '@/modules/sales/document-list-panel';
import { BatchMailDialog, BatchPrintDialog, exportDocListXlsx } from '@/modules/sales/document-list-actions';
import { INVOICE_LIST_DOC_TYPES, todayIso, type DocListFilters, type DocListRow } from '@/modules/sales/document-list';
import { duplicateDocument, listPaymentMethods, rebillFromCreditNote } from '@/modules/sales/write-api';

/**
 * Ventes → Liste des factures (G8 « Utilitaires factures › Liste des factures » et « Consultation
 * ventes ») : factures, tickets, avoirs et factures d'acompte, sans limite de nombre, filtres,
 * totaux et panier moyen, impression par plage, envoi groupé, export Excel, dupliquer, refacturer.
 */
export const Route = createFileRoute('/_app/sales/invoices')({
  head: () => ({ meta: [{ title: pageTitle('salesInvoices') }] }),
  component: InvoiceListPage,
});

function InvoiceListPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const [printCtx, setPrintCtx] = useState<{ filters: DocListFilters; selected: DocListRow[] } | null>(null);
  const [mailRows, setMailRows] = useState<DocListRow[] | null>(null);
  const methodsQ = useQuery({ queryKey: ['payment-methods', activeCompanyId], queryFn: () => listPaymentMethods(activeCompanyId!), enabled: !!activeCompanyId, staleTime: 300_000 });
  const methodLabel = useMemo(() => {
    const m = new Map((methodsQ.data ?? []).map((x) => [x.code, x.label]));
    return (c: string) => m.get(c) ?? c;
  }, [methodsQ.data]);

  const exportMut = useMutation({
    meta: { success: false, error: false },
    mutationFn: (f: DocListFilters) => exportDocListXlsx(activeCompanyId!, f, methodLabel, `factures-${todayIso()}.xlsx`),
    onSuccess: (n) => toast.success(t('docList.exported').replace('{n}', String(n))),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const duplicateMut = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => duplicateDocument(id),
    onSuccess: (newId) => { toast.success(t('sales.duplicated')); qc.invalidateQueries({ queryKey: ['sales-doc-list'] }); navigate({ to: '/sales/$documentId/edit', params: { documentId: newId } }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rebillMut = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => rebillFromCreditNote(id),
    onSuccess: (newId) => { toast.success(t('docList.rebilled')); navigate({ to: '/sales/$documentId/edit', params: { documentId: newId } }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('docList.invoicesTitle')}
        description={t('docList.invoicesSubtitle')}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('docList.invoicesTitle') }]}
      />
      <DocumentListPanel
        companyId={activeCompanyId}
        docTypes={INVOICE_LIST_DOC_TYPES}
        typeChoices={INVOICE_LIST_DOC_TYPES}
        showTransfer
        toolbar={({ selected, filters }) => (
          <>
            <Button variant="outline" onClick={() => setPrintCtx({ filters, selected })}><Printer /> {t('docList.printBatch')}</Button>
            {canWrite && (
              <Button variant="outline" onClick={() => setMailRows(selected)} disabled={!selected.length} title={t('docList.mailNeedSelection')}>
                <Mail /> {t('docList.mailBatch')}{selected.length ? ` (${selected.length})` : ''}
              </Button>
            )}
            <Button variant="outline" onClick={() => exportMut.mutate(filters)} disabled={exportMut.isPending}>
              {exportMut.isPending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} {t('docList.exportExcel')}
            </Button>
          </>
        )}
        rowActions={canWrite ? (r) => (
          <>
            {r.doc_type === 'AVO' && (
              <Button variant="ghost" size="icon" title={t('docList.rebill')} onClick={() => rebillMut.mutate(r.id)} disabled={rebillMut.isPending}>
                <Redo2 className="size-4" />
              </Button>
            )}
            {r.doc_type !== 'AVO' && (
              <Button variant="ghost" size="icon" title={t('docList.duplicate')} onClick={() => duplicateMut.mutate(r.id)} disabled={duplicateMut.isPending}>
                <Copy className="size-4" />
              </Button>
            )}
          </>
        ) : undefined}
      />
      {printCtx && <BatchPrintDialog companyId={activeCompanyId} filters={printCtx.filters} selected={printCtx.selected} onClose={() => setPrintCtx(null)} />}
      {mailRows && <BatchMailDialog companyId={activeCompanyId} rows={mailRows} onClose={() => setMailRows(null)} />}
    </>
  );
}
