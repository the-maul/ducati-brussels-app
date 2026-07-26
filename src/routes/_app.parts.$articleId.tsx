import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArticleForm } from '@/modules/articles/article-form';
import { ArticlePhotoCard } from '@/modules/articles/article-photo';
import { BarcodesTab, KitTab, ReplacementTab, StockTab, StatsTab, ApplicabilityTab } from '@/modules/articles/article-tabs';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { Button } from '@/components/ui/button';
import { Tags, BookOpen, ArrowRight } from 'lucide-react';
import { printLabels } from '@/modules/articles/label-print';
import { getArticle, updateArticle, type ArticleInsert } from '@/modules/articles/api';
import { useAuth } from '@/lib/auth/auth-context';
import { effectiveSaleTtc, useRoundSalePrices } from '@/lib/pricing';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/$articleId')({
  head: () => ({ meta: [{ title: 'Article — Ducati Bruxelles' }] }),
  component: EditArticle,
});

function EditArticle() {
  const { articleId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const roundUp = useRoundSalePrices(activeCompanyId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: article, isLoading } = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => getArticle(articleId),
  });

  // Réf. de remplacement (bandeau « remplacée par » — pousse vers la nouvelle réf)
  const { data: replacement } = useQuery({
    queryKey: ['article-replacement', article?.superseded_by_id],
    queryFn: () => getArticle(article!.superseded_by_id!),
    enabled: !!article?.superseded_by_id,
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
      <PageHeader
        title={article.designation}
        description={article.reference}
        actions={
          <>
            <Button variant="outline" onClick={() => window.open(article.catalog_url || 'https://e-catalog.ducati.com/EPC/?lang=fr-FR', '_blank', 'noopener')} title={article.catalog_url ? undefined : t('articles.catalogUrlHint')}>
              <BookOpen /> {t('articles.openCatalog')}
            </Button>
            <Button variant="outline" onClick={() => printLabels([{ code: article.reference, designation: article.designation, price: effectiveSaleTtc(article.sale_price_ttc, roundUp), withPrice: true }], 1)}><Tags /> {t('articles.printLabel')}</Button>
          </>
        }
      />
      {article.superseded_by_id && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <ArrowRight className="size-4 shrink-0" />
          <span>
            {t('articles.replacedBanner')}{' '}
            <span className="font-mono font-bold">{replacement?.reference ?? '…'}</span>
            {replacement?.designation ? ` — ${replacement.designation}` : ''}
          </span>
          {replacement && (
            <Button
              variant="outline" size="sm"
              onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: replacement.id } })}
            >
              {t('articles.openReplacement')}
            </Button>
          )}
        </div>
      )}
      <Tabs defaultValue="fiche">
        <TabsList>
          <TabsTrigger value="fiche">Fiche</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="barcodes">Codes-barres</TabsTrigger>
          <TabsTrigger value="kit">Kit / nomenclature</TabsTrigger>
          <TabsTrigger value="replacement">Remplacement</TabsTrigger>
          <TabsTrigger value="applicability">{t('applicability.tab')}</TabsTrigger>
          <TabsTrigger value="stats">Statistiques</TabsTrigger>
          <TabsTrigger value="photos">{t('ged.title')}</TabsTrigger>
        </TabsList>
        <TabsContent value="fiche" className="mt-4">
          <ArticlePhotoCard companyId={activeCompanyId} articleId={articleId} />
          <ArticleForm
            initial={article}
            companyId={activeCompanyId}
            submitting={m.isPending}
            error={error}
            onSubmit={(p) => { setError(null); m.mutate(p); }}
            onCancel={() => navigate({ to: '/parts' })}
          />
        </TabsContent>
        <TabsContent value="stock" className="mt-4"><StockTab articleId={articleId} /></TabsContent>
        <TabsContent value="barcodes" className="mt-4"><BarcodesTab articleId={articleId} /></TabsContent>
        <TabsContent value="kit" className="mt-4"><KitTab articleId={articleId} companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="replacement" className="mt-4">
          <ReplacementTab articleId={articleId} companyId={activeCompanyId} supersededById={article.superseded_by_id} />
        </TabsContent>
        <TabsContent value="applicability" className="mt-4">
          <ApplicabilityTab articleId={articleId} companyId={activeCompanyId} reference={article.reference} />
        </TabsContent>
        <TabsContent value="stats" className="mt-4"><StatsTab articleId={articleId} /></TabsContent>
        <TabsContent value="photos" className="mt-4"><AttachmentsPanel companyId={activeCompanyId} entityType="article" entityId={articleId} /></TabsContent>
      </Tabs>
    </>
  );
}
