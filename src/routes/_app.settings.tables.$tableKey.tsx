import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { ReferenceEditor } from '@/modules/settings/reference-editor';
import { refTableDef } from '@/modules/settings/reference-tables';

export const Route = createFileRoute('/_app/settings/tables/$tableKey')({
  head: () => ({ meta: [{ title: 'Table de données — Ducati Bruxelles' }] }),
  component: TableEditorPage,
});

function TableEditorPage() {
  const { tableKey } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const def = refTableDef(tableKey);

  if (!def || !activeCompanyId) {
    return (<><PageHeader title="Table de données" /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">Table inconnue.</p></>);
  }

  return (
    <>
      <PageHeader
        title={def.label}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings/tables' })}><ArrowLeft /> Tables</Button>}
      />
      <ReferenceEditor def={def} companyId={activeCompanyId} />
    </>
  );
}
