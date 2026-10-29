import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { ReferenceEditor } from '@/modules/settings/reference-editor';
import { refTableDef } from '@/modules/settings/reference-tables';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/tables/$tableKey')({
  head: () => ({ meta: [{ title: pageTitle('settingsTable') }] }),
  component: TableEditorPage,
});

function TableEditorPage() {
  const { tableKey } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const def = refTableDef(tableKey);

  if (!def || !activeCompanyId) {
    return (<><PageHeader title={t('settings.tableTitle')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('settings.tableUnknown')}</p></>);
  }

  return (
    <>
      <PageHeader
        title={def.label}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings/tables' })}><ArrowLeft /> {t('settings.tablesBack')}</Button>}
      />
      <ReferenceEditor def={def} companyId={activeCompanyId} />
    </>
  );
}
