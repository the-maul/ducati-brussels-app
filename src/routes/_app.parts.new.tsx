import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { ArticleForm } from '@/modules/articles/article-form';
import { createArticle, type ArticleInsert } from '@/modules/articles/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { useSaveMutation } from '@/lib/use-save-mutation';

export const Route = createFileRoute('/_app/parts/new')({
  head: () => ({ meta: [{ title: 'Nouvel article — Ducati Bruxelles' }] }),
  component: NewArticle,
});

function NewArticle() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const m = useSaveMutation({
    mutationFn: (payload: ArticleInsert) => createArticle(payload),
    success: t('feedback.created'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['articles'] }),
    // Différé de SETTLE_MS : laisse voir la coche du bouton avant de quitter l'écran.
    onDone: (a) => navigate({ to: '/parts/$articleId', params: { articleId: a.id } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('articles.errSave')),
  });

  if (!activeCompanyId) return null;

  return (
    <>
      <PageHeader title={t('articles.new')} />
      <ArticleForm
        initial={null}
        companyId={activeCompanyId}
        status={m.status}
        error={error}
        onSubmit={(p) => { setError(null); m.mutate(p); }}
        onCancel={() => navigate({ to: '/parts' })}
      />
    </>
  );
}
