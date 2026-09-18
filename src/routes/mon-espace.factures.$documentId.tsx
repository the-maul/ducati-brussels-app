import { createFileRoute } from '@tanstack/react-router';
import { InvoiceDetailView } from '@/modules/portal/invoices';

export const Route = createFileRoute('/mon-espace/factures/$documentId')({
  head: () => ({ meta: [{ title: 'Facture — Ducati Bruxelles' }] }),
  component: InvoicePage,
});

function InvoicePage() {
  const { documentId } = Route.useParams();
  return <InvoiceDetailView documentId={documentId} />;
}
