import { createFileRoute } from '@tanstack/react-router';
import { InvoiceDetailView } from '@/modules/portal/invoices';
import { pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/mon-espace/factures/$documentId')({
  head: () => ({ meta: [{ title: pageTitle('portalInvoice') }] }),
  component: InvoicePage,
});

function InvoicePage() {
  const { documentId } = Route.useParams();
  return <InvoiceDetailView documentId={documentId} />;
}
