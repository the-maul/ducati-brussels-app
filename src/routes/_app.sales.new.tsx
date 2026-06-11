import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { DocumentEditor } from '@/modules/sales/document-editor';

export const Route = createFileRoute('/_app/sales/new')({
  head: () => ({ meta: [{ title: 'Nouveau document — Ducati Bruxelles' }] }),
  validateSearch: (s: Record<string, unknown>) => ({ contactId: typeof s.contactId === 'string' ? s.contactId : undefined }),
  component: NewDocument,
});

function NewDocument() {
  const { activeCompanyId } = useAuth();
  const { contactId } = Route.useSearch();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader title="Nouveau document" actions={<Button variant="outline" onClick={() => navigate({ to: '/sales' })}><ArrowLeft /> Ventes</Button>} />
      <DocumentEditor companyId={activeCompanyId} initialContactId={contactId} />
    </>
  );
}
