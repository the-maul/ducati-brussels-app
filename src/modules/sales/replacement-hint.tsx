/**
 * M6 — Repère « Remplacée par … » sous une ligne de vente, avec le bouton qui pose la
 * DERNIÈRE référence de la chaîne, et la liste des équivalents (mission 05, carte 3).
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2, Repeat, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { getReplacementInfo } from './replacement';
import { saleStockStatus } from './availability';
import { SaleStockBadge } from './availability-badge';
import type { SaleArticle } from './write-api';

export function ReplacementHint({ companyId, article, onReplace }: {
  companyId: string;
  article: Pick<SaleArticle, 'id' | 'superseded_by_id' | 'equivalence_group'>;
  onReplace: (a: SaleArticle) => void;
}) {
  const enabled = !!article.superseded_by_id || !!article.equivalence_group;
  const { data, isLoading } = useQuery({
    queryKey: ['sale-replacement', companyId, article.id],
    queryFn: () => getReplacementInfo(companyId, article.id),
    enabled,
  });
  if (!enabled) return null;
  if (isLoading) return <Loader2 className="mt-1 size-3.5 animate-spin text-muted-foreground" />;
  if (!data || (!data.latest && data.equivalents.length === 0)) return null;

  return (
    <div className="mt-1 space-y-1 text-[12px]">
      {data.latest && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-warning-bg px-2 py-1">
          <StatusBadge tone="warning" icon={Repeat} label={t('sales.replacedBadge')} />
          <span>
            {t('sales.replacedBy').replace('{ref}', data.direct?.reference ?? data.latest.reference)}
            {data.hops > 1 && <> · {t('sales.replacedLatest').replace('{ref}', data.latest.reference).replace('{n}', String(data.hops))}</>}
          </span>
          <SaleStockBadge status={saleStockStatus(data.latest)} free={data.latest.real_qty - data.latest.reserved_qty} />
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onReplace(data.latest!)}>
            <ArrowRight /> {t('sales.replaceWithLatest').replace('{ref}', data.latest.reference)}
          </Button>
        </div>
      )}
      {data.loop && <p className="rounded-md bg-danger-bg px-2 py-1 text-danger">{t('sales.replacementLoop')}</p>}
      {data.equivalents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{t('sales.equivalents')}</span>
          {data.equivalents.map((e) => (
            <Button key={e.id} type="button" size="sm" variant="ghost" className="h-7 gap-2" onClick={() => onReplace(e)} title={e.designation}>
              <span className="font-mono">{e.reference}</span>
              <SaleStockBadge status={saleStockStatus(e)} free={e.real_qty - e.reserved_qty} />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
