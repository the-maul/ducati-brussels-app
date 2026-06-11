import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArticleForm } from '@/modules/articles/article-form';
import { BarcodesTab, KitTab, ReplacementTab } from '@/modules/articles/article-tabs';
import { getArticle, updateArticle, type ArticleInsert } from '@/modules/articles/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/$articleId')({
  head: () => ({ meta: [{ title: 'Article — Ducati Bruxelles' }] }),
  component: EditArticle,
});

function EditArticle() {
  const { articleId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: article, isLoading } = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => getArticle(articleId),
  });

  const m = useMutation({
    mutationFn: (payload: ArticleInsert) => updateArticle(articleId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['article', articleId] });
      navigate({ to: '/parts' });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('articles.errSave')),
  });

  if (isLoading) {
    return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!article || !activeCompanyId) {
    return (
      <>
        <PageHeader title={t('articles.title')} />
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('articles.errLoad')}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title={article.designation} description={article.reference} />
      <Tabs defaultValue="fiche">
        <TabsList>
          <TabsTrigger value="fiche">Fiche</TabsTrigger>
          <TabsTrigger value="barcodes">Codes-barres</TabsTrigger>
          <TabsTrigger value="kit">Kit / nomenclature</TabsTrigger>
          <TabsTrigger value="replacement">Remplacement</TabsTrigger>
        </TabsList>
        <TabsContent value="fiche" className="mt-4">
          <ArticleForm
            initial={article}
            companyId={activeCompanyId}
            submitting={m.isPending}
            error={error}
            onSubmit={(p) => { setError(null); m.mutate(p); }}
            onCancel={() => navigate({ to: '/parts' })}
          />
        </TabsContent>
        <TabsContent value="barcodes" className="mt-4"><BarcodesTab articleId={articleId} /></TabsContent>
        <TabsContent value="kit" className="mt-4"><KitTab articleId={articleId} companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="replacement" className="mt-4">
          <ReplacementTab articleId={articleId} companyId={activeCompanyId} supersededById={article.superseded_by_id} />
        </TabsContent>
      </Tabs>
    </>
  );
}
