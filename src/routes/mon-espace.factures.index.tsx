import { createFileRoute } from '@tanstack/react-router';
import { InvoiceListView } from '@/modules/portal/invoices';

export const Route = createFileRoute('/mon-espace/factures/')({
  head: () => ({ meta: [{ title: 'Mes factures — Ducati Bruxelles' }] }),
  component: InvoiceListView,
});
