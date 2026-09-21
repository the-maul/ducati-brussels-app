/**
 * Catalogue Ducati — une référence : fiche Ducati (désignation, prix d'information), article du DMS
 * correspondant (ou « Créer l'article »), puis les motos et vues éclatées où elle apparaît.
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Replace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { findCatalogParts } from './api';
import { CreateArticleButton } from './create-article-button';
import { CatalogPartUsage } from './part-usage';
import { fill, fmtMoney } from './format';
import { normalizeCatalogReference } from './reference';

export function CatalogReferencePanel({ companyId, reference, onBack }: { companyId: string | null; reference: string; onBack: () => void }) {
  const ref = normalizeCatalogReference(reference);
  const hit = useQuery({
    queryKey: ['ducati-catalog', 'find', companyId, ref, 1],
    queryFn: () => findCatalogParts(companyId as string, ref, 1),
    enabled: !!companyId && ref.length >= 4,
    retry: false,
  });
  const p = hit.data?.find((h) => h.reference_norm === ref) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft /> {t('catalog.backToBrowse')}</Button>
        <h3 className="font-ui text-[15px] font-bold">{fill(t('catalog.refTitle'), { ref: p?.reference ?? reference })}</h3>
      </div>
      {hit.isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : hit.error ? (
        <p className="text-sm text-muted-foreground">{t('catalog.usageErr')}</p>
      ) : !p ? (
        <p className="text-sm text-muted-foreground">{t('catalog.refUnknown')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-card p-3 text-sm">
          <div>
            <div className="font-semibold">{p.description ?? ''}</div>
            {p.replaced && p.replaced_part && (
              <span className="flex items-center gap-1 text-[12px] text-warning"><Replace className="size-3" />{fill(t('catalog.replacedBy'), { ref: p.replaced_part })}</span>
            )}
          </div>
          <div title={t('catalog.colPriceHint')}>
            <span className="text-muted-foreground">{t('catalog.colPrice')} : </span>
            <span className="tabular-nums">{fmtMoney(p.catalog_price_ht)}</span>
          </div>
          <div className="ml-auto">
            {p.article_id ? (
              <Link to="/parts/$articleId" params={{ articleId: p.article_id }} className="text-info hover:underline">
                {t('catalog.foundArticle')} : {p.article_reference} · {p.article_designation}
              </Link>
            ) : (
              <CreateArticleButton reference={p.reference} designation={p.description} />
            )}
          </div>
        </div>
      )}
      <CatalogPartUsage key={ref} reference={ref} />
    </div>
  );
}
