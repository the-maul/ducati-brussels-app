import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, X, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import {
  decideLinks, getCreationPreview, getLinkStats, listReview, refreshLinks, LinksUnavailableError,
  type DecideResult, type ReviewRow,
} from '@/modules/articles/links-api';
import type { LinkStatus } from '@/modules/articles/links-rules';
import { fill, fmtEur, fmtInt, LinkStatusBadge, methodLabel, ScoreBadge } from '@/modules/articles/links-ui';
import { CreateMissingButton, UnlinkedProductsSection, VehicleLinksSection } from '@/modules/articles/links-tools';
import { ArticleThumb } from '@/modules/articles/article-thumb';

export const Route = createFileRoute('/_app/parts/links')({
  head: () => ({ meta: [{ title: 'Rapprochements — Ducati Bruxelles' }] }),
  component: LinksPage,
});

const PAGE = 50;
const ALL = '__tous__';
type Kind = 'all' | 'ducati' | 'shopify_variant';

const SKIP_KEY: Record<string, string> = {
  article_deja_relie: 'links.skipArticleLinked',
  variante_deja_reliee: 'links.skipVariantLinked',
  variante_absente: 'links.skipVariantGone',
};

const FAMILY_KEY: Record<string, string> = {
  moto: 'links.famMoto',
  sans_reference: 'links.famSansReference',
  occasion: 'links.famOccasion',
  article_deja_relie_ailleurs: 'links.famArticleDejaRelieAilleurs',
  piece_ducati: 'links.famPieceDucati',
  accessoire_vetement_ducati: 'links.famAccessoireVetementDucati',
  vetement_98: 'links.famVetement98',
  accessoire_96_97: 'links.famAccessoire9697',
  autre_reference: 'links.famAutreReference',
};

function errText(e: unknown): string {
  return e instanceof LinksUnavailableError ? t('links.unavailable') : ((e as { message?: string } | null)?.message ?? String(e));
}

function decidedToast(r: DecideResult) {
  toast.success(fill(t('links.decided'), { n: r.done }));
  if (r.skipped?.length) {
    const reasons = [...new Set(r.skipped.map((s) => (SKIP_KEY[s.reason] ? t(SKIP_KEY[s.reason]) : s.reason)))].join(', ');
    toast.warning(fill(t('links.skipped'), { n: r.skipped.length, reasons }));
  }
}

function LinksPage() {
  const { activeCompanyId, isAdmin, hasRole } = useAuth();
  const admin = isAdmin();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('all');
  const [method, setMethod] = useState<string>('');
  const [status, setStatus] = useState<LinkStatus>('a_valider');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | 'lie' | 'rejete'>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { const id = setTimeout(() => setQ(search), 300); return () => clearTimeout(id); }, [search]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [kind, method, status, q, activeCompanyId]);

  const stats = useQuery({
    queryKey: ['article-links', 'stats', activeCompanyId],
    queryFn: () => getLinkStats(activeCompanyId!),
    enabled: !!activeCompanyId,
    retry: false,
  });
  const rows = useQuery({
    queryKey: ['article-links', 'review', activeCompanyId, kind, method, status, q, page],
    queryFn: () => listReview(activeCompanyId!, {
      kind: kind === 'all' ? null : kind, method: method || null, status, q, limit: PAGE, offset: page * PAGE,
    }),
    enabled: !!activeCompanyId && !stats.error,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const preview = useQuery({
    queryKey: ['article-links', 'creation-preview', activeCompanyId],
    queryFn: () => getCreationPreview(activeCompanyId!, 30),
    enabled: !!activeCompanyId && admin && showCreate,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['article-links'] });
  const refresh = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => refreshLinks(activeCompanyId!),
    onSuccess: (r) => {
      toast.success(fill(t('links.refreshDone'), { new: r.new ?? 0, changed: r.changed ?? 0, removed: r.removed ?? 0 }));
      invalidate();
    },
    onError: (e) => toast.error(errText(e)),
  });
  const decide = useMutation({
    meta: { success: false, error: false },
    mutationFn: ({ ids, decision }: { ids: string[]; decision: 'lie' | 'rejete' }) => decideLinks(activeCompanyId!, ids, decision),
    onSuccess: (r) => {
      decidedToast(r);
      setSelected(new Set());
      invalidate();
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['shopify-products'] });
    },
    onError: (e) => toast.error(errText(e)),
  });

  // Raisons proposées dans le filtre : celles présentes pour l'état choisi, avec leur nombre.
  const methods = useMemo(() => {
    const out = new Map<string, number>();
    for (const [k, c] of Object.entries(stats.data?.by_method ?? {})) {
      const [tk, st, m] = k.split(':');
      if (st !== status) continue;
      if (kind === 'ducati' && tk === 'shopify_variant') continue;
      if (kind === 'shopify_variant' && tk !== 'shopify_variant') continue;
      out.set(m, (out.get(m) ?? 0) + c);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  }, [stats.data, status, kind]);

  const data = rows.data ?? [];
  const total = data[0]?.total_count ?? 0;
  const allOnPage = data.length > 0 && data.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const s = stats.data;

  return (
    <>
      <PageHeader
        title={t('links.title')}
        description={t('links.subtitle')}
        actions={admin && (
          <Button variant="outline" disabled={refresh.isPending || !!stats.error} onClick={() => refresh.mutate()} title={t('links.refreshHint')}>
            {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('links.refresh')}
          </Button>
        )}
      />

      {stats.error && (
        <p className="mb-4 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{errText(stats.error)}</p>
      )}

      {s && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Kpi label={t('links.kpiArticles')} value={s.articles} />
          <Kpi label={t('links.kpiDucati')} value={s.ducati} hint={`${Math.round((s.ducati / Math.max(s.articles, 1)) * 100)} %`} />
          <Kpi label={t('links.kpiShopify')} value={s.shopify} hint={fill(t('links.kpiShopifyVariants'), { linked: fmtInt(s.shopify_variants_linked), total: fmtInt(s.shopify_variants) })} />
          <Kpi label={t('links.kpiBoth')} value={s.both} />
          <Kpi label={t('links.kpiNone')} value={s.none} />
          <Kpi label={t('links.kpiPending')} value={s.pending} onClick={() => setStatus('a_valider')} />
          <Kpi label={t('links.kpiRejected')} value={s.rejected} onClick={() => setStatus('rejete')} />
        </div>
      )}

      {!stats.error && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="relative min-w-[220px] max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('links.search')} className="pl-9" />
            </div>
            <Field label={t('links.filterKind')}>
              <Select value={kind} onValueChange={(v) => { setKind(v as Kind); setMethod(''); }}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('links.kindAll')}</SelectItem>
                  <SelectItem value="ducati">{t('links.kindDucati')}</SelectItem>
                  <SelectItem value="shopify_variant">{t('links.kindShopify')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('links.filterMethod')}>
              <Select value={method || ALL} onValueChange={(v) => setMethod(v === ALL ? '' : v)}>
                <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('links.methodAll')}</SelectItem>
                  {methods.map(([m, c]) => <SelectItem key={m} value={m}>{`${methodLabel(m)} (${fmtInt(c)})`}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('links.filterStatus')}>
              <Select value={status} onValueChange={(v) => setStatus(v as LinkStatus)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a_valider">{t('links.stAValider')}</SelectItem>
                  <SelectItem value="lie">{t('links.stLie')}</SelectItem>
                  <SelectItem value="rejete">{t('links.stRejete')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {admin ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{fill(t('links.selected'), { n: selected.size })}</span>
              <Button size="sm" variant="outline" disabled={!selected.size || decide.isPending || status === 'lie'} onClick={() => setConfirm('lie')}>
                <Check /> {t('links.acceptSelected')}
              </Button>
              <Button size="sm" variant="outline" disabled={!selected.size || decide.isPending || status === 'rejete'} onClick={() => setConfirm('rejete')}>
                <X /> {t('links.rejectSelected')}
              </Button>
            </div>
          ) : (
            <p className="mb-2 text-sm text-muted-foreground">{t('links.adminOnly')}</p>
          )}

          {rows.error && <p className="mb-2 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errText(rows.error)}</p>}

          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted">
                <tr>
                  <Th className="w-8">
                    {admin && (
                      <Checkbox
                        aria-label={t('links.selectAll')} checked={allOnPage}
                        onCheckedChange={(v) => setSelected((cur) => {
                          const n = new Set(cur);
                          for (const r of data) { if (v === true) n.add(r.id); else n.delete(r.id); }
                          return n;
                        })}
                      />
                    )}
                  </Th>
                  <Th>{t('links.colArticle')}</Th>
                  <Th>{t('links.colTarget')}</Th>
                  <Th>{t('links.colReason')}</Th>
                  <Th>{t('links.colScore')}</Th>
                  <Th className="w-40">{t('links.colDecision')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.isLoading && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>
                )}
                {!rows.isLoading && data.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('links.empty')}</td></tr>
                )}
                {data.map((r) => (
                  <ReviewLine
                    key={r.id} r={r} admin={admin} checked={selected.has(r.id)} onToggle={() => toggle(r.id)}
                    busy={decide.isPending} onDecide={(d) => decide.mutate({ ids: [r.id], decision: d })}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE && (
            <div className="mt-2 flex items-center justify-end gap-2 text-sm text-muted-foreground">
              <span className="tabular-nums">{fill(t('links.pageOf'), { from: fmtInt(page * PAGE + 1), to: fmtInt(Math.min(total, (page + 1) * PAGE)), total: fmtInt(total) })}</span>
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft /> {t('links.prev')}</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>{t('links.next')} <ChevronRight /></Button>
            </div>
          )}

          {admin && (
            <section className="mt-6 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-ui text-[15px] font-bold">{t('links.createTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{t('links.createSubtitle')}</p>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                {activeCompanyId && <CreateMissingButton companyId={activeCompanyId} />}
                <Button variant="outline" size="sm" onClick={() => setShowCreate((v) => !v)}>
                  <PackagePlus /> {showCreate ? t('links.createHide') : t('links.createShow')}
                </Button>
                </span>
              </div>
              {showCreate && preview.isLoading && <Loader2 className="mt-3 size-5 animate-spin text-muted-foreground" />}
              {showCreate && preview.error && <p className="mt-3 text-sm text-danger">{errText(preview.error)}</p>}
              {showCreate && preview.data && (
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="font-bold tabular-nums">{t('links.createDucati')} : {fmtInt(preview.data.ducati_parts_without_article)}</p>
                    <p className="text-sm text-muted-foreground">{fill(t('links.createDucatiPrice'), { n: fmtInt(preview.data.ducati_parts_with_price) })}</p>
                    <ul className="mt-2 max-h-64 overflow-auto text-[12px]">
                      {preview.data.ducati_sample.map((p) => (
                        <li key={p.reference} className="flex gap-2 border-b border-border py-1">
                          <Link to="/parts/catalog" search={{ ref: p.reference }} className="font-mono underline-offset-2 hover:underline">{p.reference}</Link>
                          <span className="flex-1 truncate">{p.description}</span>
                          <span className="tabular-nums text-muted-foreground">{fmtEur(p.catalog_price_ht)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-bold tabular-nums">{t('links.createShopify')} : {fmtInt(preview.data.shopify_without_article)}</p>
                    <p className="text-sm text-muted-foreground">{fill(t('links.createShopifyProposed'), { n: fmtInt(preview.data.shopify_proposed) })}</p>
                    <ul className="mt-2 text-[13px]">
                      {Object.entries(preview.data.shopify_by_family).sort((a, b) => b[1] - a[1]).map(([f, c]) => (
                        <li key={f} className="flex justify-between border-b border-border py-1">
                          <span>{FAMILY_KEY[f] ? t(FAMILY_KEY[f]) : f}</span><span className="tabular-nums">{fmtInt(c)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          )}
          {activeCompanyId && (isAdmin() || hasRole('vendeur')) && (
            <>
              <UnlinkedProductsSection companyId={activeCompanyId} admin={admin} />
              <VehicleLinksSection companyId={activeCompanyId} admin={admin} />
            </>
          )}
        </>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fill(t(confirm === 'lie' ? 'links.confirmAcceptTitle' : 'links.confirmRejectTitle'), { n: selected.size })}</AlertDialogTitle>
            <AlertDialogDescription>{t(confirm === 'lie' ? 'links.confirmAcceptBody' : 'links.confirmRejectBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) decide.mutate({ ids: [...selected].slice(0, 500), decision: confirm }); setConfirm(null); }}>
              {t(confirm === 'lie' ? 'links.accept' : 'links.reject')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReviewLine({ r, admin, checked, onToggle, busy, onDecide }: {
  r: ReviewRow; admin: boolean; checked: boolean; onToggle: () => void; busy: boolean; onDecide: (d: 'lie' | 'rejete') => void;
}) {
  const x = r.target_extra ?? {};
  const shop = r.target_kind === 'shopify_variant';
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-3 py-2">{admin && <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={r.article_reference} />}</td>
      <td className="px-3 py-2">
        <Link to="/parts/$articleId" params={{ articleId: r.article_id }} className="font-mono text-[12px] underline-offset-2 hover:underline">{r.article_reference}</Link>
        <div className="font-medium">{r.article_designation}</div>
        <div className="text-[12px] tabular-nums text-muted-foreground">{fill(t('links.articlePrice'), { price: fmtEur(r.article_sale_price_ttc) })}</div>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-2">
          {/* Image de la cible — site Shopify, photo Ducati du produit ou vue éclatée. */}
          <ArticleThumb
            url={x.image_url}
            source={shop ? 'shopify' : r.target_kind === 'ducati_product' ? 'ducati_product' : 'ducati_drawing'}
            alt={r.target_label}
            size={40}
          />
          <div className="min-w-0">
            <div className="text-[12px] text-muted-foreground">{shop ? t('links.kindShopify') : t('links.kindDucati')}</div>
            {shop ? <div className="font-medium">{r.target_label}</div> : (
              <Link to="/parts/catalog" search={{ ref: r.target_ref }} className="font-medium underline-offset-2 hover:underline">{r.target_label}</Link>
            )}
            <div className="text-[12px] tabular-nums text-muted-foreground">
              {shop
                ? [x.sku && `SKU ${x.sku}`, fill(t('links.shopPrice'), { price: fmtEur(x.price) }), fill(t('links.shopQty'), { qty: x.qty ?? '—' }),
                  x.status === 'ACTIVE' ? t('links.shopOnline') : x.status === 'DRAFT' ? t('links.shopDraft') : x.status === 'ARCHIVED' ? t('links.shopArchived') : null]
                  .filter(Boolean).join(' · ')
                : fill(t('links.ducatiPrice'), { price: fmtEur(x.price_ht) })}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="font-bold">{methodLabel(r.method)}</div>
        <div className="text-[12px] text-muted-foreground">{r.reason}</div>
        {r.decision_note && <div className="text-[12px] italic text-muted-foreground">{r.decision_note}</div>}
      </td>
      <td className="px-3 py-2"><ScoreBadge score={r.score} /></td>
      <td className="px-3 py-2">
        {r.status !== 'a_valider' && <div className="mb-1"><LinkStatusBadge status={r.status} /></div>}
        {admin && (
          <div className="flex gap-1">
            {r.status !== 'lie' && <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide('lie')}><Check /> {t('links.accept')}</Button>}
            {r.status !== 'rejete' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide('rejete')}><X /> {t('links.reject')}</Button>}
          </div>
        )}
      </td>
    </tr>
  );
}

function Kpi({ label, value, hint, onClick }: { label: string; value: number; hint?: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="font-data text-xl font-bold tabular-nums">{fmtInt(value)}</div>
      {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
    </>
  );
  const cls = 'rounded-md border border-border bg-card p-3 text-left shadow-[var(--shadow-card)]';
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:bg-accent`}>{body}</button> : <div className={cls}>{body}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
