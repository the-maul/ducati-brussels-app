/**
 * Catalogue Ducati — où une référence apparaît : modèles-années et vues éclatées (paginé côté base,
 * ducati_catalog_part_usage). Chaque ligne ouvre la vue éclatée dans le catalogue, la pièce surlignée.
 * Utilisé sur la fiche article (bloc « Catalogue Ducati ») et dans le catalogue (recherche par référence).
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Globe, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t } from '@/lib/i18n';
import { listPartUsage } from './api';
import { fill, fmtInt } from './format';
import { normalizeCatalogReference } from './reference';

const PAGE = 20;

export function CatalogPartUsage({ reference }: { reference: string }) {
  const ref = normalizeCatalogReference(reference);
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ['ducati-catalog', 'usage', ref, page],
    queryFn: () => listPartUsage(ref, PAGE, page * PAGE),
    enabled: !!ref,
    placeholderData: keepPreviousData,
    retry: false,
  });

  if (!ref) return null;
  if (q.isLoading) return <Loader2 className="m-4 size-5 animate-spin text-muted-foreground" />;
  if (q.error) return <p className="text-sm text-muted-foreground">{t('catalog.usageErr')}</p>;
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  if (!total) return <p className="text-sm text-muted-foreground">{t('catalog.usageNone')}</p>;
  const from = page * PAGE + 1;
  const to = Math.min(total, page * PAGE + rows.length);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.colFamily')}</TableHead>
              <TableHead>{t('catalog.colModel')}</TableHead>
              <TableHead>{t('catalog.colYear')}</TableHead>
              <TableHead>{t('catalog.colDrawing')}</TableHead>
              <TableHead className="w-16">{t('catalog.colPos')}</TableHead>
              <TableHead className="w-12 text-right">{t('catalog.colQty')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.model_year_id}-${r.drawing_id}-${i}`}>
                <TableCell className="text-sm text-muted-foreground">{r.family_description ?? ''}</TableCell>
                <TableCell className="text-sm">
                  {r.model_description}
                  {!r.is_europe && <span className="ml-2"><StatusBadge tone="neutral" icon={Globe} label={t('catalog.notEurope')} /></span>}
                </TableCell>
                <TableCell className="font-data tabular-nums">{r.year ?? r.model_year_code ?? ''}</TableCell>
                <TableCell className="text-sm">
                  <span className="font-data">{r.drawing_code ?? ''}</span>{' '}
                  <span className="text-muted-foreground">{r.drawing_description ?? ''}</span>
                  {r.group_description && <div className="text-[11px] text-muted-foreground">{r.group_description}</div>}
                </TableCell>
                <TableCell className="font-data tabular-nums">{r.position ?? ''}</TableCell>
                <TableCell className="text-right tabular-nums">{r.quantity ?? ''}</TableCell>
                <TableCell className="text-right">
                  <Link
                    to="/parts/catalog"
                    search={{ my: r.model_year_id, drawing: r.drawing_id, ref }}
                    className="whitespace-nowrap text-sm text-info hover:underline"
                  >
                    {t('catalog.openDrawing')}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <span className="tabular-nums">{fill(t('catalog.pageOf'), { from: fmtInt(from), to: fmtInt(to), total: fmtInt(total) })}</span>
        <Button variant="outline" size="sm" disabled={page === 0 || q.isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          <ChevronLeft /> {t('catalog.pagePrev')}
        </Button>
        <Button variant="outline" size="sm" disabled={to >= total || q.isFetching} onClick={() => setPage((p) => p + 1)}>
          {t('catalog.pageNext')} <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
