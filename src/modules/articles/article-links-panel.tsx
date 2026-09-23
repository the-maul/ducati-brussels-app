/**
 * Fiche article — « Article DMS = pivot » (décision M-25) : la référence Ducati de l'article (vue éclatée,
 * prix Ducati pour information, modèles compatibles) et son produit sur le site Shopify (prix, stock,
 * publication), avec les correspondances proposées à accepter ou rejeter (administrateurs).
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, ExternalLink, ImageOff, Link2, Loader2, Store, Unlink, X } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { CatalogPartUsage } from '@/modules/catalog/part-usage';
import {
  decideLinks, linkDucatiReference, listArticleLinks, LinksUnavailableError,
  type ArticleLink, type DucatiPartInfo, type DucatiProductInfo, type ShopifyVariantInfo,
} from './links-api';
import { fill, fmtEur, LinkStatusBadge, methodLabel, ScoreBadge, SourceBadges } from './links-ui';
import { ShopifyPublishPanel } from './shopify-publish-panel';

function useArticleLinks(companyId: string, articleId: string) {
  return useQuery({
    queryKey: ['article-links', 'article', companyId, articleId],
    queryFn: () => listArticleLinks(companyId, articleId),
    retry: false,
  });
}

function useDecide(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: false, error: false },
    mutationFn: ({ id, decision }: { id: string; decision: 'lie' | 'rejete' }) => decideLinks(companyId, [id], decision),
    onSuccess: (r) => {
      if (r.skipped?.length) toast.warning(fill(t('links.skipped'), { n: r.skipped.length, reasons: r.skipped.map((s) => s.reason).join(', ') }));
      else toast.success(fill(t('links.decided'), { n: r.done }));
      qc.invalidateQueries({ queryKey: ['article-links'] });
      qc.invalidateQueries({ queryKey: ['shopify-products'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

const card = 'rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]';

/** Badges de l'en-tête de la fiche : où l'article est référencé (G8, Shopify, Ducati). */
export function ArticleLinkBadges({ companyId, articleId }: { companyId: string; articleId: string }) {
  const q = useArticleLinks(companyId, articleId);
  if (!q.data?.length) return null;
  return <div className="mb-3"><SourceBadges links={q.data} /></div>;
}

const isDucati = (l: ArticleLink) => l.target_kind === 'ducati_part' || l.target_kind === 'ducati_product';

function Candidates({ links, admin, companyId }: { links: ArticleLink[]; admin: boolean; companyId: string }) {
  const decide = useDecide(companyId);
  const pending = links.filter((l) => l.status === 'a_valider');
  const rejected = links.filter((l) => l.status === 'rejete');
  if (!pending.length && !rejected.length) return null;
  return (
    <div className="mt-4 space-y-3">
      {pending.length > 0 && (
        <div>
          <h3 className="mb-1 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('links.candidates')}</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {pending.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                <span className="font-mono">{targetTitle(l)}</span>
                <span className="text-muted-foreground">{methodLabel(l.method)} — {l.reason}</span>
                <ScoreBadge score={l.score} />
                {admin && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: l.id, decision: 'lie' })}><Check /> {t('links.accept')}</Button>
                    <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: l.id, decision: 'rejete' })}><X /> {t('links.reject')}</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rejected.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">{t('links.rejectedHistory')} ({rejected.length})</summary>
          <ul className="mt-1 space-y-1">
            {rejected.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <LinkStatusBadge status="rejete" /><span className="font-mono">{targetTitle(l)}</span>
                <span className="text-muted-foreground">{l.decision_note ?? methodLabel(l.method)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function targetTitle(l: ArticleLink): string {
  if (l.target_kind === 'shopify_variant') {
    const i = l.info as ShopifyVariantInfo | null;
    return i?.title ?? l.target_ref;
  }
  const i = l.info as DucatiPartInfo | DucatiProductInfo | null;
  return i ? `${i.reference}${i.description ? ` — ${i.description}` : ''}` : l.target_ref;
}

function Unavailable({ error }: { error: unknown }) {
  return (
    <p className="text-sm text-muted-foreground">
      {error instanceof LinksUnavailableError ? t('links.unavailable') : t('links.loadErr')}
    </p>
  );
}

/** Carte « Catalogue Ducati » de la fiche : référence reliée, photo / vue éclatée, prix public Ducati (information). */
export function DucatiCard({ companyId, articleId }: { companyId: string; articleId: string }) {
  const { isAdmin } = useAuth();
  const admin = isAdmin();
  const qc = useQueryClient();
  const q = useArticleLinks(companyId, articleId);
  const decideOne = useDecide(companyId);
  const [ref, setRef] = useState('');
  const link = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => linkDucatiReference(companyId, articleId, ref),
    onSuccess: () => { toast.success(t('links.ducatiLinked')); setRef(''); qc.invalidateQueries({ queryKey: ['article-links'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const links = (q.data ?? []).filter(isDucati);
  const linked = links.find((l) => l.status === 'lie');
  const info = linked?.info as (DucatiPartInfo & DucatiProductInfo) | null | undefined;

  return (
      <div className={card}>
        <h2 className="font-ui text-[15px] font-bold">{t('links.ducatiTitle')}</h2>
        {q.isLoading && <Loader2 className="mt-2 size-5 animate-spin text-muted-foreground" />}
        {q.error && <Unavailable error={q.error} />}
        {q.data && !linked && <p className="mt-1 text-sm text-muted-foreground">{t('links.ducatiNone')}</p>}
        {linked && (
          <div className="mt-2 flex flex-wrap gap-4">
            {info?.drawing?.thumbnail_url || info?.drawing?.image_url || info?.image_url ? (
              <img
                src={info?.drawing?.thumbnail_url ?? info?.drawing?.image_url ?? info?.image_url ?? ''}
                alt={info?.drawing?.description ?? info?.description ?? ''}
                className="h-32 w-44 rounded-md border border-border bg-background object-contain" loading="lazy"
              />
            ) : (
              <span className="grid h-32 w-44 place-items-center rounded-md border border-border text-muted-foreground"><ImageOff className="size-5" /></span>
            )}
            <div className="min-w-0 flex-1 space-y-1 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[15px] font-bold">{info?.reference ?? linked.target_ref}</span>
                <LinkStatusBadge status="lie" />
                <span className="text-muted-foreground">{methodLabel(linked.method)} · {linked.is_auto ? t('links.auto') : t('links.manual')}</span>
                {info?.replaced && <StatusBadge tone="warning" icon={Clock} label={t('links.ducatiReplaced')} />}
                {info?.has_tempario && <StatusBadge tone="info" icon={Clock} label={t('links.tempario')} />}
              </div>
              <div className="font-medium">{info?.description}</div>
              <div className="tabular-nums text-muted-foreground">
                {fill(t('links.ducatiPriceInfo'), { ht: fmtEur(info?.price_ht), ttc: fmtEur(info?.price_ttc) })}
              </div>
              {info?.drawing && (
                <div className="text-muted-foreground">{fill(t('links.ducatiDrawing'), { code: info.drawing.code ?? '', description: info.drawing.description ?? '' })}</div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="outline">
                  <Link to="/parts/catalog" search={{ ref: info?.reference ?? linked.target_ref }}><ExternalLink /> {t('links.ducatiOpenDrawing')}</Link>
                </Button>
                {admin && (
                  <Button size="sm" variant="ghost" disabled={decideOne.isPending} onClick={() => decideOne.mutate({ id: linked.id, decision: 'rejete' })}><Unlink /> {t('links.unlink')}</Button>
                )}
              </div>
            </div>
          </div>
        )}
        {q.data && <Candidates links={links} admin={admin} companyId={companyId} />}
        {admin && q.data && (
          <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) link.mutate(); }}>
            <span className="text-[13px] text-muted-foreground">{t('links.ducatiLinkLabel')}</span>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('links.ducatiLinkPlaceholder')} className="h-8 w-48 font-mono" />
            <Button size="sm" variant="outline" type="submit" disabled={!ref.trim() || link.isPending}><Link2 /> {t('links.ducatiLinkBtn')}</Button>
          </form>
        )}
      </div>
  );
}

/**
 * Onglet « Vues éclatées / motos compatibles » : où la référence Ducati reliée apparaît (pièces) ou les motos
 * compatibles (accessoires / vêtements), vue éclatée ouverte en un clic.
 */
export function CompatibilityPanel({ companyId, articleId, articleReference }: { companyId: string; articleId: string; articleReference: string }) {
  const q = useArticleLinks(companyId, articleId);
  const linked = (q.data ?? []).find((l) => isDucati(l) && l.status === 'lie');
  const info = linked?.info as (DucatiPartInfo & DucatiProductInfo & {
    models?: { family: string | null; model: string | null; model_year: number | null }[];
    category?: string | null; gender?: string | null; families?: string[] | null;
    version?: string | null; collection_year?: number | null;
  }) | null | undefined;
  // Les vues éclatées suivent la référence Ducati reliée (qui peut différer de la référence de l'article).
  const usageRef = linked ? (info?.reference ?? linked.target_ref) : articleReference;
  return (
    <div className={card}>
      <h2 className="font-ui text-[15px] font-bold">{t('links.compatTitle')}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t('catalog.usageSubtitle')}</p>
      {linked?.target_kind === 'ducati_product' ? (
        <div className="space-y-3 text-[13px]">
          {/* Accessoires / vêtements : catégorie, genre, collection, familles de motos (mission 06, carte 7) */}
          {(info?.category || info?.gender || info?.collection_year || info?.version) && (
            <p className="text-muted-foreground">
              {[info?.category, info?.gender, info?.version,
                info?.collection_year ? fill(t('links.compatCollection'), { year: info.collection_year }) : null]
                .filter(Boolean).join(' · ')}
            </p>
          )}
          {info?.families?.length ? (
            <div>
              <div className="font-bold">{t('links.compatFamilies')}</div>
              <p>{info.families.join(' · ')}</p>
            </div>
          ) : null}
          {info?.models?.length ? (
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {info.models.map((m, i) => <li key={i}>{[m.family, m.model, m.model_year].filter(Boolean).join(' · ')}</li>)}
            </ul>
          ) : (!info?.families?.length && <p className="text-muted-foreground">{t('links.compatNone')}</p>)}
        </div>
      ) : (
        <CatalogPartUsage key={usageRef} reference={usageRef} />
      )}
    </div>
  );
}

/** Carte « Site Shopify » de la fiche : produit relié (prix site, stock site, en ligne), candidats, « Publier sur le site ». */
export function ShopifyCard({ companyId, articleId, publishable }: { companyId: string; articleId: string; publishable: boolean }) {
  const { isAdmin } = useAuth();
  const admin = isAdmin();
  const q = useArticleLinks(companyId, articleId);
  const decide = useDecide(companyId);
  const links = (q.data ?? []).filter((l) => l.target_kind === 'shopify_variant');
  const linked = links.find((l) => l.status === 'lie');
  const i = linked?.info as ShopifyVariantInfo | null | undefined;
  return (
    <div className={card}>
      <h2 className="font-ui text-[15px] font-bold">{t('links.shopifyTitle')}</h2>
      {q.isLoading && <Loader2 className="mt-2 size-5 animate-spin text-muted-foreground" />}
      {q.error && <Unavailable error={q.error} />}
      {q.data && !linked && <p className="mt-1 text-sm text-muted-foreground">{t('links.shopifyNone')}</p>}
      {linked && (
        <div className="mt-2 flex flex-wrap gap-4">
          {i?.image_url
            ? <img src={i.image_url} alt={i.title ?? ''} className="size-32 rounded-md border border-border object-cover" loading="lazy" />
            : <span className="grid size-32 place-items-center rounded-md border border-border text-muted-foreground"><ImageOff className="size-5" /></span>}
          <div className="min-w-0 flex-1 space-y-1 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-bold">{i?.title ?? linked.target_ref}</span>
              {i?.removed ? <StatusBadge tone="neutral" icon={X} label={t('links.shopifyRemoved')} />
                : i?.status === 'ACTIVE' ? <StatusBadge tone="success" icon={Store} label={t('links.shopOnline')} />
                : i?.status === 'ARCHIVED' ? <StatusBadge tone="neutral" icon={Store} label={t('links.shopArchived')} />
                : <StatusBadge tone="warning" icon={Store} label={t('links.shopDraft')} />}
            </div>
            {i?.variant_title && i.variant_title !== 'Default Title' && <div>{fill(t('links.shopifyVariant'), { v: i.variant_title })}</div>}
            <div className="tabular-nums">
              {[i?.sku && `SKU ${i.sku}`, fill(t('links.shopPrice'), { price: fmtEur(i?.price) }), fill(t('links.shopQty'), { qty: i?.qty ?? '—' })].filter(Boolean).join(' · ')}
            </div>
            <div className="text-muted-foreground">
              {methodLabel(linked.method)} · {linked.is_auto ? t('links.auto') : t('links.manual')}
              {i?.synced_at ? ` · ${fill(t('links.shopifySynced'), { date: new Date(i.synced_at).toLocaleString('fr-BE') })}` : ''}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" variant="outline"><Link to="/parts/shopify"><Store /> {t('links.shopifyOpen')}</Link></Button>
              {admin && (
                <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: linked.id, decision: 'rejete' })}>
                  <Unlink /> {t('links.unlink')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {q.data && <Candidates links={links} admin={admin} companyId={companyId} />}
      <div className="mt-4"><ShopifyPublishPanel companyId={companyId} articleId={articleId} publishable={publishable} /></div>
    </div>
  );
}

/** Tout sur une page : en tête de la fiche article, le catalogue Ducati et le site Shopify côte à côte. */
export function ArticleSourcesSummary({ companyId, articleId, publishable }: { companyId: string; articleId: string; publishable: boolean }) {
  const { isAdmin, hasRole } = useAuth();
  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      <DucatiCard companyId={companyId} articleId={articleId} />
      {(isAdmin() || hasRole('vendeur')) && <ShopifyCard companyId={companyId} articleId={articleId} publishable={publishable} />}
    </div>
  );
}
