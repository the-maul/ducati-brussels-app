import { createFileRoute } from '@tanstack/react-router';
import { InvoiceListView } from '@/modules/portal/invoices';
import { pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/mon-espace/factures/')({
  head: () => ({ meta: [{ title: pageTitle('portalInvoices') }] }),
  component: InvoiceListView,
});
