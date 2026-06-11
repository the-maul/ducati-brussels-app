import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ImageOff, Eye, EyeOff } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { listShop, setPublishable, listWebOrders, setWebOrderStatus } from '@/modules/web/eshop-api';
import { SiteBuilder } from '@/modules/web/site-builder';
import { signedUrl } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/eshop')({
  head: () => ({ meta: [{ title: 'E-shop — Ducati Bruxelles' }] }),
  component: EshopPage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const ORDER_STATUS = ['panier', 'en_attente_paiement', 'payee', 'preparee', 'expediee', 'annulee'] as const;

function EshopPage() {
  const { activeCompanyId } = useAuth();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader title={t('eshop.title')} description={t('eshop.subtitle')} />
      <Tabs defaultValue="site">
        <TabsList>
          <TabsTrigger value="site">{t('eshop.tabSite')}</TabsTrigger>
          <TabsTrigger value="products">{t('eshop.tabProducts')}</TabsTrigger>
          <TabsTrigger value="orders">{t('eshop.tabOrders')}</TabsTrigger>
        </TabsList>
        <TabsContent value="site" className="mt-4"><SiteBuilder companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="products" className="mt-4"><Products companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="orders" className="mt-4"><WebOrders companyId={activeCompanyId} /></TabsContent>
      </Tabs>
    </>
  );
}

/* ---- Produits (publication) ---- */
function Products({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['shop', companyId], queryFn: () => listShop(companyId) });
  const pub = useMutation({ mutationFn: ({ id, v }: { id: string; v: boolean }) => setPublishable(id, v), onSuccess: () => qc.invalidateQueries({ queryKey: ['shop', companyId] }) });
  const items = useMemo(() => { const q = term.trim().toLowerCase(); return (data ?? []).filter((i) => !q || `${i.reference} ${i.designation}`.toLowerCase().includes(q)); }, [data, term]);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('eshop.search')} className="max-w-sm" />
        <span className="ml-auto text-sm text-muted-foreground">{t('eshop.count').replace('{n}', String(items.length))}</span>
      </div>
      {isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((i) => (
          <div key={i.article_id} className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
            <button type="button" onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: i.article_id } })} className="aspect-square bg-muted"><Photo path={i.image_path} /></button>
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

/* ---- Commandes web ---- */
function WebOrders({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['web-orders', companyId], queryFn: () => listWebOrders(companyId) });
  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => setWebOrderStatus(id, status), onSuccess: () => qc.invalidateQueries({ queryKey: ['web-orders', companyId] }) });
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted"><tr><Th>{t('eshop.colNumber')}</Th><Th>{t('eshop.colCustomer')}</Th><Th>{t('eshop.colStatus')}</Th><Th className="text-right">{t('eshop.colTotal')}</Th></tr></thead>
        <tbody>
          {isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
          {data && data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{t('eshop.noOrders')}</td></tr>}
          {data?.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-mono text-[12px]">{o.number ?? '—'}</td>
              <td className="px-3 py-2">{o.customer_name ?? '—'}<span className="block text-[11px] text-muted-foreground">{o.email}</span></td>
              <td className="px-3 py-2">
                <select value={o.status} onChange={(e) => setStatus.mutate({ id: o.id, status: e.target.value })} className="rounded border border-border bg-background px-2 py-1 text-[12px]">
                  {ORDER_STATUS.map((s) => <option key={s} value={s}>{t(`eshop.os_${s}`)}</option>)}
                </select>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(Number(o.total_ttc))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Photo({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; if (path) signedUrl(path).then((u) => { if (on) setUrl(u); }).catch(() => {}); return () => { on = false; }; }, [path]);
  if (!path) return <div className="grid size-full place-items-center text-muted-foreground"><ImageOff className="size-8" /></div>;
  return url ? <img src={url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
