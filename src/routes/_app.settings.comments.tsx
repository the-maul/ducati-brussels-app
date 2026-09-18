import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { CommentTemplatesEditor } from '@/modules/sales/comment-templates-editor';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/comments')({
  head: () => ({ meta: [{ title: 'Commentaires types — Ducati Bruxelles' }] }),
  component: CommentTemplatesPage,
});

function CommentTemplatesPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('commentTemplates.title')}
        description={t('commentTemplates.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('settings.title')}</Button>}
      />
      <CommentTemplatesEditor companyId={activeCompanyId} />
    </>
  );
}
