import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { ArticleForm } from '@/modules/articles/article-form';
import { createArticle, type ArticleInsert } from '@/modules/articles/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { useSaveMutation } from '@/lib/use-save-mutation';

type NewArticleSearch = { reference?: string; designation?: string; mgmt?: 'A' | 'M'; from?: 'catalog' };

export const Route = createFileRoute('/_app/parts/new')({
  // Pré-remplissage depuis le catalogue Ducati (mission 06) : référence, désignation, type A ou M.
  validateSearch: (s: Record<string, unknown>): NewArticleSearch => ({
    reference: typeof s.reference === 'string' && s.reference ? s.reference.slice(0, 60) : undefined,
    designation: typeof s.designation === 'string' && s.designation ? s.designation.slice(0, 200) : undefined,
    mgmt: s.mgmt === 'A' || s.mgmt === 'M' ? s.mgmt : undefined,
    from: s.from === 'catalog' ? 'catalog' : undefined,
  }),
  head: () => ({ meta: [{ title: 'Nouvel article — Ducati Bruxelles' }] }),
  component: NewArticle,
});

function NewArticle() {
  const { activeCompanyId } = useAuth();
  const search = Route.useSearch();
  const preset = search.reference
    ? { reference: search.reference, designation: search.designation ?? '', mgmt_type: search.mgmt ?? 'A' }
    : undefined;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const m = useSaveMutation({
    mutationFn: (payload: ArticleInsert) => createArticle(payload),
    success: t('feedback.created'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['articles'] });
      // La pièce du catalogue est désormais reliée à cet article (lien par la référence).
      qc.invalidateQueries({ queryKey: ['ducati-catalog'] });
    },
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
        preset={preset}
        companyId={activeCompanyId}
        status={m.status}
        error={error}
        onSubmit={(p) => { setError(null); m.mutate(p); }}
        onCancel={() => navigate({ to: '/parts' })}
      />
    </>
  );
}
