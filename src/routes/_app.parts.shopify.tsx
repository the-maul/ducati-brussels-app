import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, RefreshCw, Search, Link2, Unlink, EyeOff, Eye, CheckCircle2, Zap, CircleDashed, Ban, ImageOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { listArticles } from '@/modules/articles/api';
import {
  listShopifyProducts, listShopifySuggestions, linkShopifyVariant, setShopifyDecision, runShopifySync, countShopify,
  type ShopifyOverviewRow,
} from '@/modules/articles/shopify-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/shopify')({
  head: () => ({ meta: [{ title: 'Produits Shopify — Ducati Bruxelles' }] }),
  component: ShopifyProductsPage,
});

type Filter = 'all' | 'review' | 'linked' | 'auto' | 'valide' | 'ignore' | 'nosku';
const MAX_ROWS = 300;

function fmtEur(n: number | null): string {
  if (n == null) return '—';
  const s = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ');
  return `${s} €`;
}

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);
}

function errMsg(e: unknown): string {
  return (e as { message?: string } | null)?.message ?? String(e);
}

const LINK_BADGE: Record<string, { tone: StatusTone; label: string; icon: typeof Zap }> = {
  auto_exact: { tone: 'success', label: 'shopify.stAuto', icon: Zap },
  valide: { tone: 'success', label: 'shopify.stValide', icon: CheckCircle2 },
  a_valider: { tone: 'warning', label: 'shopify.stReview', icon: CircleDashed },
  ignore: { tone: 'neutral', label: 'shopify.stIgnored', icon: Ban },
};

function shopStatusLabel(s: string | null): string {
  if (s === 'ACTIVE') return t('shopify.shopActive');
  if (s === 'DRAFT') return t('shopify.shopDraft');
  if (s === 'ARCHIVED') return t('shopify.shopArchived');
  return s ?? '—';
}

function ShopifyProductsPage() {
  const { activeCompanyId, isAdmin, hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const admin = isAdmin();
  const canRead = admin || hasRole('vendeur');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('review');
  const [shopStatus, setShopStatus] = useState<string>('all');
  const [linking, setLinking] = useState<ShopifyOverviewRow | null>(null);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ['shopify-products', activeCompanyId],
    queryFn: () => listShopifyProducts(activeCompanyId!),
    enabled: !!activeCompanyId && canRead,
  });

  const counters = useMemo(() => countShopify(rows ?? []), [rows]);
  const lastSync = useMemo(() => {
    let max: string | null = null;
    for (const r of rows ?? []) if (r.synced_at && (!max || r.synced_at > max)) max = r.synced_at;
    return max;
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === 'review' && r.link_status !== 'a_valider') return false;
      if (filter === 'linked' && r.link_status !== 'auto_exact' && r.link_status !== 'valide') return false;
      if (filter === 'auto' && r.link_status !== 'auto_exact') return false;
      if (filter === 'valide' && r.link_status !== 'valide') return false;
      if (filter === 'ignore' && r.link_status !== 'ignore') return false;
      if (filter === 'nosku' && (r.sku ?? '').trim()) return false;
      if (shopStatus !== 'all' && r.product_status !== shopStatus) return false;
      if (!s) return true;
      return [r.product_title, r.variant_title, r.sku, r.barcode, r.article_reference, r.article_designation, r.vendor]
        .some((v) => (v ?? '').toLowerCase().includes(s));
    });
  }, [rows, filter, shopStatus, search]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['shopify-products', activeCompanyId] });

  const sync = useMutation({
    mutationFn: () => runShopifySync(activeCompanyId!),
    onSuccess: (r) => {
      toast.success(fill(t('shopify.syncDone'), { new: r.auto_linked_new ?? 0, removed: r.removed ?? 0 }));
      refresh();
    },
    onError: (e) => toast.error(`${t('shopify.syncErr')} : ${errMsg(e)}`),
  });

  const decide = useMutation({
    mutationFn: ({ variant, decision }: { variant: string; decision: 'a_valider' | 'ignore' }) =>
      setShopifyDecision(activeCompanyId!, variant, decision),
    onSuccess: (_d, v) => { toast.success(t(v.decision === 'ignore' ? 'shopify.ignored' : 'shopify.unlinked')); refresh(); },
    onError: (e) => toast.error(`${t('shopify.actionErr')} : ${errMsg(e)}`),
  });

  if (!canRead) {
    return <><PageHeader title={t('shopify.title')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('shopify.notAllowed')}</p></>;
  }

  const shown = filtered.slice(0, MAX_ROWS);

  return (
    <>
      <PageHeader
        title={t('shopify.title')}
        description={t('shopify.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate({ to: '/parts' })}>
              <ArrowLeft /> {t('shopify.back')}
            </Button>
            {admin && (
              <Button onClick={() => sync.mutate()} disabled={sync.isPending || !activeCompanyId}>
                {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {sync.isPending ? t('shopify.syncing') : t('shopify.syncBtn')}
              </Button>
            )}
          </>
        }
      />

      <p className="mb-3 text-[13px] text-muted-foreground">
        {t('shopify.rule')}{' '}
        {lastSync && <>· {t('shopify.lastSync')} : <span className="tabular-nums">{new Date(lastSync).toLocaleString('fr-BE')}</span></>}
      </p>
      {!admin && <p className="mb-3 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('shopify.readOnly')}</p>}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Counter label={t('shopify.cTotal')} value={counters.total} onClick={() => setFilter('all')} active={filter === 'all'} />
        <Counter label={t('shopify.cAuto')} value={counters.auto} onClick={() => setFilter('auto')} active={filter === 'auto'} />
        <Counter label={t('shopify.cValide')} value={counters.valide} onClick={() => setFilter('valide')} active={filter === 'valide'} />
        <Counter label={t('shopify.cReview')} value={counters.toReview} onClick={() => setFilter('review')} active={filter === 'review'} />
        <Counter label={t('shopify.cIgnored')} value={counters.ignored} onClick={() => setFilter('ignore')} active={filter === 'ignore'} />
        <Counter label={t('shopify.cNoSku')} value={counters.noSku} onClick={() => setFilter('nosku')} active={filter === 'nosku'} />
      </div>

      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 bg-background pb-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('shopify.search')} className="pl-9" />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('shopify.fAll')}</SelectItem>
            <SelectItem value="review">{t('shopify.fReview')}</SelectItem>
            <SelectItem value="linked">{t('shopify.fLinked')}</SelectItem>
            <SelectItem value="auto">{t('shopify.fAuto')}</SelectItem>
            <SelectItem value="valide">{t('shopify.fValide')}</SelectItem>
            <SelectItem value="ignore">{t('shopify.fIgnored')}</SelectItem>
            <SelectItem value="nosku">{t('shopify.fNoSku')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={shopStatus} onValueChange={setShopStatus}>
          <SelectTrigger className="w-44"><SelectValue placeholder={t('shopify.fShopStatus')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('shopify.fShopAll')}</SelectItem>
            <SelectItem value="ACTIVE">{t('shopify.shopActive')}</SelectItem>
            <SelectItem value="DRAFT">{t('shopify.shopDraft')}</SelectItem>
            <SelectItem value="ARCHIVED">{t('shopify.shopArchived')}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm tabular-nums text-muted-foreground">{filtered.length}</span>
      </div>

      {error && <p className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errMsg(error)}</p>}
      {!isLoading && rows && rows.length === 0 && <p className="mb-3 text-[13px] text-muted-foreground">{t('shopify.never')}</p>}

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th className="w-14">{t('shopify.colImage')}</Th>
              <Th>{t('shopify.colTitle')}</Th>
              <Th>{t('shopify.colSku')}</Th>
              <Th className="text-right">{t('shopify.colPrice')}</Th>
              <Th className="text-right">{t('shopify.colStock')}</Th>
              <Th>{t('shopify.colLink')}</Th>
              <Th>{t('shopify.colArticle')}</Th>
              {admin && <Th className="w-48" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
            )}
            {!isLoading && shown.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{t('shopify.empty')}</td></tr>
            )}
            {shown.map((r) => {
              const b = LINK_BADGE[r.link_status] ?? LINK_BADGE.a_valider;
              const busy = decide.isPending && decide.variables?.variant === r.shopify_variant_id;
              return (
                <tr key={r.shopify_variant_id} className="border-t border-border align-middle">
                  <td className="px-3 py-1.5">
                    {r.image_url
                      ? <img src={r.image_url} alt="" loading="lazy" className="size-10 rounded-sm border border-border object-cover" />
                      : <div className="flex size-10 items-center justify-center rounded-sm border border-border text-muted-foreground"><ImageOff className="size-4" /></div>}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium">{r.product_title ?? '—'}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {r.variant_title && r.variant_title !== 'Default Title' ? `${r.variant_title} · ` : ''}
                      {shopStatusLabel(r.product_status)}{r.vendor ? ` · ${r.vendor}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[12px]">
                    {r.sku || '—'}
                    {r.barcode && <div className="text-muted-foreground">{r.barcode}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtEur(r.price)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.inventory_quantity ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <StatusBadge tone={b.tone} icon={b.icon} label={t(b.label)} />
                    {r.link_status === 'auto_exact' && r.match_via && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{t(r.match_via === 'barcode' ? 'shopify.viaBarcode' : 'shopify.viaSku')}</div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.article_id ? (
                      <button type="button" className="text-left hover:underline" onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: r.article_id! } })}>
                        <span className="font-mono text-[12px]">{r.article_reference}</span>
                        <div className="text-[12px] text-muted-foreground">{r.article_designation}</div>
                      </button>
                    ) : '—'}
                  </td>
                  {admin && (
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        {r.link_status !== 'ignore' && (
                          <Button size="sm" variant="outline" onClick={() => setLinking(r)} disabled={busy}>
                            <Link2 /> {r.article_id ? t('shopify.change') : t('shopify.link')}
                          </Button>
                        )}
                        {r.article_id && (
                          <Button size="sm" variant="ghost" disabled={busy}
                            onClick={() => decide.mutate({ variant: r.shopify_variant_id, decision: 'a_valider' })}>
                            <Unlink /> {t('shopify.unlink')}
                          </Button>
                        )}
                        {!r.article_id && r.link_status !== 'ignore' && (
                          <Button size="sm" variant="ghost" disabled={busy}
                            onClick={() => decide.mutate({ variant: r.shopify_variant_id, decision: 'ignore' })}>
                            <EyeOff /> {t('shopify.ignore')}
                          </Button>
                        )}
                        {r.link_status === 'ignore' && (
                          <Button size="sm" variant="ghost" disabled={busy}
                            onClick={() => decide.mutate({ variant: r.shopify_variant_id, decision: 'a_valider' })}>
                            <Eye /> {t('shopify.unignore')}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > MAX_ROWS && (
        <p className="mt-2 text-[13px] text-muted-foreground">{fill(t('shopify.more'), { n: filtered.length - MAX_ROWS })}</p>
      )}

      {linking && activeCompanyId && (
        <LinkDialog
          companyId={activeCompanyId}
          row={linking}
          onClose={() => setLinking(null)}
          onDone={() => { setLinking(null); toast.success(t('shopify.linked')); refresh(); }}
        />
      )}
    </>
  );
}

function Counter({ label, value, onClick, active }: { label: string; value: number; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border bg-card p-3 text-left shadow-[var(--shadow-card)] ${active ? 'border-foreground' : 'border-border'}`}
    >
      <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="font-data text-[22px] font-bold tabular-nums">{value}</div>
    </button>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>
      {children}
    </th>
  );
}

const REASON_LABEL: Record<string, string> = {
  reference_proche: 'shopify.rsRefClose',
  reference_remplacee: 'shopify.rsReplaced',
  ref_fournisseur: 'shopify.rsSupplier',
  libelle_proche: 'shopify.rsLabel',
};

function LinkDialog({ companyId, row, onClose, onDone }: {
  companyId: string; row: ShopifyOverviewRow; onClose: () => void; onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const { data: suggestions, isLoading: sugLoading } = useQuery({
    queryKey: ['shopify-suggestions', companyId, row.shopify_variant_id],
    queryFn: () => listShopifySuggestions(companyId, row.shopify_variant_id),
  });
  const term = q.trim();
  const { data: found, isFetching } = useQuery({
    queryKey: ['shopify-article-search', companyId, term],
    queryFn: () => listArticles(companyId, { search: term, limit: 30 }),
    enabled: term.length >= 2,
  });
  const link = useMutation({
    mutationFn: (articleId: string) => linkShopifyVariant(companyId, row.shopify_variant_id, articleId),
    onSuccess: onDone,
    onError: (e) => toast.error(`${t('shopify.actionErr')} : ${errMsg(e)}`),
  });

  const Line = ({ id, reference, designation, note }: { id: string; reference: string; designation: string | null; note?: string }) => (
    <li className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0">
      <div className="min-w-0">
        <span className="font-mono text-[12px]">{reference}</span>{' '}
        <span className="text-[13px]">{designation}</span>
        {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
      </div>
      <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate(id)}>{t('shopify.dlgChoose')}</Button>
    </li>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('shopify.dlgTitle')}</DialogTitle>
          <DialogDescription>
            {row.product_title}{row.variant_title && row.variant_title !== 'Default Title' ? ` · ${row.variant_title}` : ''}
            {row.sku ? ` · SKU ${row.sku}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div>
          <div className="mb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('shopify.dlgSuggestions')}</div>
          {sugLoading ? <Loader2 className="size-4 animate-spin" /> : (suggestions?.length ?? 0) === 0
            ? <p className="text-[13px] text-muted-foreground">{t('shopify.dlgNoSuggestion')}</p>
            : (
              <ul className="max-h-56 overflow-y-auto">
                {suggestions!.map((s) => (
                  <Line key={s.article_id} id={s.article_id} reference={s.reference} designation={s.designation} note={t(REASON_LABEL[s.reason] ?? s.reason)} />
                ))}
              </ul>
            )}
        </div>

        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('shopify.dlgSearch')} className="pl-9" autoFocus />
          </div>
          {term.length < 2 ? <p className="mt-1 text-[12px] text-muted-foreground">{t('shopify.dlgSearchHint')}</p>
            : isFetching ? <Loader2 className="mt-2 size-4 animate-spin" />
            : (
              <ul className="mt-1 max-h-64 overflow-y-auto">
                {(found ?? []).map((a) => <Line key={a.id} id={a.id} reference={a.reference} designation={a.designation} />)}
              </ul>
            )}
        </div>
        <p className="text-[12px] text-muted-foreground">{t('shopify.later')}</p>
      </DialogContent>
    </Dialog>
  );
}
