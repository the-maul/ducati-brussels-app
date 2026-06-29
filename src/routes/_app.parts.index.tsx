import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, Plus, Upload, FolderTree, Wand2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { listArticles } from '@/modules/articles/api';
import { effectiveSaleTtc, useRoundSalePrices } from '@/lib/pricing';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/')({
  head: () => ({ meta: [{ title: 'Pièces & Accessoires — Ducati Bruxelles' }] }),
  component: ArticlesList,
});

function fmtEur(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ');
  return `${s} €`;
}

function ArticlesList() {
  const { activeCompanyId } = useAuth();
  const roundUp = useRoundSalePrices(activeCompanyId);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['articles', activeCompanyId, debounced],
    queryFn: () => listArticles(activeCompanyId!, debounced),
    enabled: !!activeCompanyId,
  });

  return (
    <>
      <PageHeader
        title={t('articles.title')}
        description={t('articles.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate({ to: '/parts/families' })}>
              <FolderTree /> Familles
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/parts/cascade' })}>
              <Wand2 /> Cascade
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/parts/import' })}>
              <Upload /> {t('articles.import')}
            </Button>
            <Button onClick={() => navigate({ to: '/parts/new' })}>
              <Plus /> {t('articles.new')}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('articles.search')} className="pl-9" />
        </div>
        {data && <span className="text-sm text-muted-foreground">{data.length}</span>}
      </div>

      {error && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <p>{t('articles.errLoad')}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{(error as Error).message}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('articles.colRef')}</Th>
              <Th>{t('articles.colDesignation')}</Th>
              <Th>{t('articles.colType')}</Th>
              <Th>{t('articles.colBrand')}</Th>
              <Th>{t('articles.colStock')}</Th>
              <Th className="text-right">{t('articles.colPrice')}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
            )}
            {data && data.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('articles.empty')}</td></tr>
            )}
            {data?.map((a) => (
              <tr
                key={a.id}
                onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: a.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent"
              >
                <td className="px-3 py-2 font-mono text-[12px]">{a.reference}</td>
                <td className="px-3 py-2 font-medium">{a.designation}</td>
                <td className="px-3 py-2"><StatusBadge tone="neutral" label={a.mgmt_type} /></td>
                <td className="px-3 py-2">{a.brand ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{a.bin_location ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtEur(effectiveSaleTtc(a.sale_price_ttc, roundUp))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>
      {children}
    </th>
  );
}
