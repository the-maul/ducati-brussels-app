import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ImageOff, Eye, EyeOff } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { listShop, setPublishable } from '@/modules/web/eshop-api';
import { signedUrl } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/eshop')({
  head: () => ({ meta: [{ title: 'E-shop — Ducati Bruxelles' }] }),
  component: EshopPage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

function EshopPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [publishedOnly, setPublishedOnly] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['shop', activeCompanyId], queryFn: () => listShop(activeCompanyId!), enabled: !!activeCompanyId });
  const pub = useMutation({ mutationFn: ({ id, v }: { id: string; v: boolean }) => setPublishable(id, v), onSuccess: () => qc.invalidateQueries({ queryKey: ['shop', activeCompanyId] }) });

  const items = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (data ?? []).filter((i) => {
      if (publishedOnly && !i.publishable) return false;
      if (q && !`${i.reference} ${i.designation}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, term, publishedOnly]);

  return (
    <>
      <PageHeader title={t('eshop.title')} description={t('eshop.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('eshop.search')} className="max-w-sm" />
        <Button variant={publishedOnly ? 'default' : 'outline'} size="sm" onClick={() => setPublishedOnly((v) => !v)}>{publishedOnly ? <Eye /> : <EyeOff />} {t('eshop.publishedOnly')}</Button>
        <span className="ml-auto text-sm text-muted-foreground">{t('eshop.count').replace('{n}', String(items.length))}</span>
      </div>

      {isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      {data && items.length === 0 && <p className="text-sm text-muted-foreground">{t('eshop.empty')}</p>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((i) => (
          <div key={i.article_id} className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
            <button type="button" onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: i.article_id } })} className="aspect-square bg-muted">
              <Photo path={i.image_path} />
            </button>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <span className="font-mono text-[11px] text-muted-foreground">{i.reference}</span>
              <span className="line-clamp-2 text-[13px] font-medium">{i.designation}</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-data text-sm tabular-nums">{eur(i.price_ttc)}</span>
                <StatusBadge tone={i.available > 0 ? 'success' : 'danger'} label={i.available > 0 ? t('eshop.inStock') : t('eshop.outStock')} />
              </div>
              <Button size="sm" variant={i.publishable ? 'outline' : 'default'} className="mt-2" onClick={() => pub.mutate({ id: i.article_id, v: !i.publishable })} disabled={pub.isPending}>
                {i.publishable ? <><EyeOff /> {t('eshop.unpublish')}</> : <><Eye /> {t('eshop.publish')}</>}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Photo({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; if (path) signedUrl(path).then((u) => { if (on) setUrl(u); }).catch(() => {}); return () => { on = false; }; }, [path]);
  if (!path) return <div className="grid size-full place-items-center text-muted-foreground"><ImageOff className="size-8" /></div>;
  return url ? <img src={url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
}
