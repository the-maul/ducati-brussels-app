/**
 * Pièces & Accessoires — quand une recherche par référence ne trouve aucun article du DMS,
 * propose les références du catalogue Ducati correspondantes (« Trouvée dans le catalogue Ducati »).
 * Silencieux si la saisie ne ressemble pas à une référence ou si le lien n'est pas encore en base.
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { t } from '@/lib/i18n';
import { findCatalogParts } from './api';
import { CreateArticleButton } from './create-article-button';
import { fmtMoney } from './format';
import { looksLikeReference, normalizeCatalogReference } from './reference';

export function CatalogSearchHint({ companyId, q }: { companyId: string; q: string }) {
  const k = normalizeCatalogReference(q);
  const enabled = looksLikeReference(q);
  const hits = useQuery({
    queryKey: ['ducati-catalog', 'find', companyId, k, 5],
    queryFn: () => findCatalogParts(companyId, k, 5),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  if (!enabled || !hits.data?.length) return null;

  return (
    <div className="mt-3 rounded-md border border-info/40 bg-info-bg p-3 text-left">
      <div className="flex items-center gap-2 font-ui text-[14px] font-bold text-info">
        <BookOpen className="size-4" /> {t('catalog.foundTitle')}
      </div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{t('catalog.foundHint')}</p>
      <ul className="mt-2 space-y-1.5">
        {hits.data.map((h) => (
          <li key={h.reference_norm} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground">
            <span className="font-data font-semibold tabular-nums">{h.reference}</span>
            <span>{h.description ?? ''}</span>
            <span className="tabular-nums text-muted-foreground" title={t('catalog.colPriceHint')}>{fmtMoney(h.catalog_price_ht)}</span>
            <span className="ml-auto flex items-center gap-3">
              <Link to="/parts/catalog" search={{ ref: h.reference_norm }} className="text-info hover:underline">
                {t('catalog.foundOpen')}
              </Link>
              {h.article_id ? (
                <Link to="/parts/$articleId" params={{ articleId: h.article_id }} className="text-info hover:underline">
                  {t('catalog.foundArticle')} · {h.article_reference}
                </Link>
              ) : (
                <CreateArticleButton reference={h.reference} designation={h.description} />
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
