import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ImageOff, Eye, EyeOff, ShoppingCart, Trash2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import {
  listShop, setPublishable, getShopSettings, saveShopSettings, listWebOrders, createWebOrder, setWebOrderStatus,
  type ShopItem, type ShopPatch, type CartLine,
} from '@/modules/web/eshop-api';
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
      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">{t('eshop.tabCatalog')}</TabsTrigger>
          <TabsTrigger value="settings">{t('eshop.tabSettings')}</TabsTrigger>
          <TabsTrigger value="orders">{t('eshop.tabOrders')}</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="mt-4"><Catalog companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="settings" className="mt-4"><ShopSettingsForm companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="orders" className="mt-4"><WebOrders companyId={activeCompanyId} /></TabsContent>
      </Tabs>
    </>
  );
}

/* ---------------- Catalogue + panier ---------------- */
function Catalog({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const { data, isLoading } = useQuery({ queryKey: ['shop', companyId], queryFn: () => listShop(companyId) });
  const pub = useMutation({ mutationFn: ({ id, v }: { id: string; v: boolean }) => setPublishable(id, v), onSuccess: () => qc.invalidateQueries({ queryKey: ['shop', companyId] }) });

  const items = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (data ?? []).filter((i) => (!publishedOnly || i.publishable) && (!q || `${i.reference} ${i.designation}`.toLowerCase().includes(q)));
  }, [data, term, publishedOnly]);

  const addToCart = (i: ShopItem) => setCart((c) => {
    const ex = c.find((l) => l.article_id === i.article_id);
    if (ex) return c.map((l) => (l.article_id === i.article_id ? { ...l, quantity: l.quantity + 1 } : l));
    return [...c, { article_id: i.article_id, designation: `${i.reference} ${i.designation}`, quantity: 1, unit_price_ttc: i.price_ttc }];
  });

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('eshop.search')} className="max-w-sm" />
          <Button variant={publishedOnly ? 'default' : 'outline'} size="sm" onClick={() => setPublishedOnly((v) => !v)}>{publishedOnly ? <Eye /> : <EyeOff />} {t('eshop.publishedOnly')}</Button>
          <span className="ml-auto text-sm text-muted-foreground">{t('eshop.count').replace('{n}', String(items.length))}</span>
        </div>
        {isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
                <div className="mt-2 flex gap-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => addToCart(i)} disabled={i.available <= 0}><ShoppingCart /> {t('eshop.addToCart')}</Button>
                  <Button size="sm" variant={i.publishable ? 'outline' : 'default'} onClick={() => pub.mutate({ id: i.article_id, v: !i.publishable })}>{i.publishable ? <EyeOff /> : <Eye />}</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <CartPanel companyId={companyId} cart={cart} setCart={setCart} />
    </div>
  );
}

function CartPanel({ companyId, cart, setCart }: { companyId: string; cart: CartLine[]; setCart: (f: (c: CartLine[]) => CartLine[]) => void }) {
  const qc = useQueryClient();
  const [cust, setCust] = useState({ name: '', email: '', phone: '', address: '' });
  const [done, setDone] = useState(false);
  const total = cart.reduce((s, l) => s + l.quantity * l.unit_price_ttc, 0);
  const place = useMutation({
    mutationFn: () => createWebOrder(companyId, cust, cart),
    onSuccess: () => { setDone(true); setCart(() => []); qc.invalidateQueries({ queryKey: ['web-orders', companyId] }); qc.invalidateQueries({ queryKey: ['shop', companyId] }); },
  });
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><ShoppingCart className="size-4" /> {t('eshop.cart')}</p>
      {done && <p className="rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{t('eshop.orderCreated')}</p>}
      {cart.length === 0 ? <p className="text-sm text-muted-foreground">{t('eshop.cartEmpty')}</p> : (
        <>
          {cart.map((l) => (
            <div key={l.article_id} className="flex items-center gap-2 text-[13px]">
              <span className="flex-1 truncate">{l.designation}</span>
              <Input type="number" value={String(l.quantity)} onChange={(e) => { const q = Number(e.target.value) || 0; setCart((c) => c.map((x) => (x.article_id === l.article_id ? { ...x, quantity: q } : x))); }} className="h-7 w-14 text-right tabular-nums" />
              <span className="w-16 text-right tabular-nums">{eur(l.quantity * l.unit_price_ttc)}</span>
              <Button size="sm" variant="ghost" onClick={() => setCart((c) => c.filter((x) => x.article_id !== l.article_id))}><Trash2 className="size-4 text-danger" /></Button>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-2 font-data tabular-nums"><span className="font-bold">{t('eshop.cartTotal')}</span><b>{eur(total)}</b></div>
          <div className="space-y-2 border-t border-border pt-2">
            <Input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} placeholder={t('eshop.custName')} />
            <Input value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} placeholder={t('eshop.custEmail')} />
            <Input value={cust.address} onChange={(e) => setCust({ ...cust, address: e.target.value })} placeholder={t('eshop.custAddress')} />
          </div>
          <Button className="w-full" onClick={() => { setDone(false); place.mutate(); }} disabled={place.isPending || !cust.name.trim()}>{place.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('eshop.placeOrder')}</Button>
          <p className="text-[11px] text-muted-foreground">{t('eshop.stripeHint')}</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Réglages boutique ---------------- */
function ShopSettingsForm({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['shop-settings', companyId], queryFn: () => getShopSettings(companyId) });
  const [f, setF] = useState<ShopPatch>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data) setF({ name: data.name, slug: data.slug, custom_domain: data.custom_domain, description: data.description, hero_text: data.hero_text, theme_color: data.theme_color, phone: data.phone, email: data.email, address: data.address, published: data.published }); }, [data]);
  const set = (k: keyof ShopPatch, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({ mutationFn: () => saveShopSettings(companyId, f), onSuccess: () => { setMsg(t('eshop.saved')); qc.invalidateQueries({ queryKey: ['shop-settings', companyId] }); } });

  return (
    <div className="max-w-2xl space-y-3 rounded-md border border-border bg-card p-4">
      <Field label={t('eshop.shopName')}><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('eshop.slug')}><Input value={f.slug ?? ''} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} className="font-mono" /></Field>
        <Field label={t('eshop.customDomain')}><Input value={f.custom_domain ?? ''} onChange={(e) => set('custom_domain', e.target.value.toLowerCase().trim())} className="font-mono" placeholder="boutique.ducati-bxl.be" /></Field>
      </div>
      <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
        {t('eshop.publicUrl')} : <a href={`/shop/${f.slug ?? ''}`} target="_blank" rel="noreferrer" className="font-mono text-info underline">/shop/{f.slug ?? ''}</a>
        <span>— {t('eshop.urlHint')}</span>
      </p>
      <Field label={t('eshop.hero')}><Input value={f.hero_text ?? ''} onChange={(e) => set('hero_text', e.target.value)} /></Field>
      <Field label={t('eshop.description')}><Textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={3} /></Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={t('eshop.themeColor')}><Input type="color" value={f.theme_color ?? '#cc0000'} onChange={(e) => set('theme_color', e.target.value)} className="h-9 w-full" /></Field>
        <Field label={t('eshop.contactPhone')}><Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={t('eshop.contactEmail')}><Input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
      </div>
      <Field label={t('eshop.contactAddress')}><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.published} onChange={(e) => set('published', e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('eshop.publishedShop')}</label>
      {msg && <p className="rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{msg}</p>}
      <div className="flex justify-end"><Button onClick={() => { setMsg(null); save.mutate(); }} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : null} {t('eshop.save')}</Button></div>
    </div>
  );
}

/* ---------------- Commandes web ---------------- */
function WebOrders({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['web-orders', companyId], queryFn: () => listWebOrders(companyId) });
  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => setWebOrderStatus(id, status), onSuccess: () => qc.invalidateQueries({ queryKey: ['web-orders', companyId] }) });
  const tone = (s: string) => (s === 'payee' || s === 'expediee' ? 'success' : s === 'annulee' ? 'neutral' : 'warning');

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted"><tr><Th>{t('eshop.colCustomer')}</Th><Th>{t('eshop.colStatus')}</Th><Th className="text-right">{t('eshop.colTotal')}</Th></tr></thead>
        <tbody>
          {isLoading && <tr><td colSpan={3} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
          {data && data.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">{t('eshop.noOrders')}</td></tr>}
          {data?.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0">
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
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
