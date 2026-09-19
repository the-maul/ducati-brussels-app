/**
 * M2 / mission 03 — Textes du site sur la fiche article (décision W-4).
 * Titre et description web (HTML simple) : repris une fois de Shopify, puis tenus dans le DMS.
 * Si la fiche avait déjà son texte lors de la reprise, le texte Shopify est affiché à côté
 * (lecture seule) pour que l'équipe y pioche ce qui lui est utile.
 * L'aperçu passe toujours par le même nettoyage que la reprise : aucun script ni style n'est rendu.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { getArticleShopifyImport } from './shopify-api';
import { sanitizeShopifyHtml } from '../../../supabase/functions/_shared/shopify-content';

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);
}

function SafeHtml({ html }: { html: string }) {
  const clean = useMemo(() => sanitizeShopifyHtml(html), [html]);
  return (
    <div
      className="prose-sm max-w-none text-[13px] leading-relaxed [&_a]:underline [&_h2]:text-[15px] [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
      // Contenu nettoyé par sanitizeShopifyHtml (liste blanche de balises, aucun attribut sauf href sûr).
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

export function ArticleWebSection({
  companyId, articleId, title, description, onTitle, onDescription,
}: {
  companyId: string;
  articleId: string | null;
  title: string;
  description: string;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const { data: imp } = useQuery({
    queryKey: ['article-shopify-import', articleId],
    queryFn: () => getArticleShopifyImport(companyId, articleId!),
    enabled: !!articleId,
  });

  return (
    <>
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
        <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.webTitle')}</Label>
        <Input value={title} onChange={(e) => onTitle(e.target.value)} />
      </div>
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.webDescription')}</Label>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPreview((p) => !p)} disabled={!description.trim()}>
            <Eye className="size-4" /> {t('articles.webPreview')}
          </Button>
        </div>
        <Textarea value={description} onChange={(e) => onDescription(e.target.value)} rows={5} className="font-mono text-[12px]" />
        <p className="text-[12px] text-muted-foreground">{t('articles.webDescriptionHint')}</p>
        {preview && description.trim() && (
          <div className="rounded-md border border-border bg-muted/40 p-3"><SafeHtml html={description} /></div>
        )}
        {imp?.status === 'fait' && (
          <p className="text-[12px] text-muted-foreground">
            {fill(t('articles.webFromShopify'), { date: new Date(imp.first_imported_at).toLocaleDateString('fr-BE') })}
          </p>
        )}
      </div>
      {imp?.dms_text_kept && (imp.shopify_title || imp.shopify_description) && (
        <div className="rounded-md border border-border bg-info-bg p-3 sm:col-span-2 lg:col-span-3">
          <p className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-info">
            <FileText className="size-4" /> {t('articles.webShopifyKept')}
          </p>
          <p className="mb-2 text-[12px] text-muted-foreground">{t('articles.webShopifyKeptHint')}</p>
          {imp.shopify_title && <p className="mb-1 text-[13px] font-bold">{imp.shopify_title}</p>}
          {imp.shopify_description && <SafeHtml html={imp.shopify_description} />}
        </div>
      )}
    </>
  );
}
