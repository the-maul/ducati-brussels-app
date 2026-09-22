/**
 * Outil « Rapprochements » (décision M-25, un seul catalogue) :
 *  - créer les articles manquants (catalogue Ducati, produits du site) par lots, relançable ;
 *  - produits du site sans article : « Créer l'article » / « Rattacher » (le DMS est la source) ;
 *  - motos du site ↔ fiches véhicule : propositions à valider (une moto n'est jamais un article pièce).
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Check, ImageOff, Link2, Loader2, PackagePlus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { listArticles } from './api';
import { linkShopifyVariant } from './shopify-api';
import {
  createMissingArticles, decideVehicleLinks, listUnlinkedProducts, listVehicleLinks, LinksUnavailableError,
  type CreateMissingResult, type UnlinkedProduct,
} from './links-api';
import { fill, fmtEur, fmtInt, ScoreBadge } from './links-ui';

const card = 'mt-6 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]';
const errText = (e: unknown) => (e instanceof LinksUnavailableError ? t('links.unavailable') : ((e as Error)?.message ?? String(e)));
const LOT = 200;

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['article-links'] });
    qc.invalidateQueries({ queryKey: ['articles'] });
    qc.invalidateQueries({ queryKey: ['shopify-products'] });
  };
}

/** Bouton « Créer les articles manquants » : lots de 200 par sorte jusqu'à épuisement (reste sous 8 s par appel). */
export function CreateMissingButton({ companyId }: { companyId: string }) {
  const invalidate = useInvalidate();
  const [progress, setProgress] = useState<string | null>(null);
  const run = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      const total: Partial<CreateMissingResult> = {};
      for (let i = 0; i < 100; i++) {
        const r = await createMissingArticles(companyId, { scope: 'all', limit: LOT });
        for (const k of ['ducati_parts', 'ducati_products', 'shopify', 'mouvements_stock', 'prix'] as const) total[k] = (total[k] ?? 0) + (r[k] ?? 0);
        setProgress(fill(t('links.createProgress'), { n: fmtInt((total.ducati_parts ?? 0) + (total.ducati_products ?? 0) + (total.shopify ?? 0)) }));
        if (!r.ducati_parts && !r.ducati_products && !r.shopify) break;
      }
      return total;
    },
    onSuccess: (r) => {
      setProgress(null);
      toast.success(fill(t('links.createDone'), {
        ducati: fmtInt((r.ducati_parts ?? 0) + (r.ducati_products ?? 0)), shopify: fmtInt(r.shopify ?? 0), stock: fmtInt(r.mouvements_stock ?? 0),
      }));
      invalidate();
    },
    onError: (e) => { setProgress(null); toast.error(errText(e)); },
  });
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending} title={t('links.createHint')}>
        {run.isPending ? <Loader2 className="animate-spin" /> : <PackagePlus />} {t('links.createBtn')}
      </Button>
      {progress && <span className="text-[12px] tabular-nums text-muted-foreground">{progress}</span>}
    </span>
  );
}

/** Produits du site sans article (alerte) : créer l'article ou le rattacher à un article existant. */
export function UnlinkedProductsSection({ companyId, admin }: { companyId: string; admin: boolean }) {
  const invalidate = useInvalidate();
  const q = useQuery({
    queryKey: ['article-links', 'unlinked', companyId, 'list'],
    queryFn: () => listUnlinkedProducts(companyId, 200, 0),
    retry: false,
  });
  const [attach, setAttach] = useState<UnlinkedProduct | null>(null);
  const create = useMutation({
    meta: { success: false, error: false },
    mutationFn: (v: string) => createMissingArticles(companyId, { scope: 'shopify', variant: v }),
    onSuccess: (r) => {
      if (r.shopify) toast.success(t('links.createdOne'));
      else toast.warning(t('links.createdNone'));
      invalidate();
    },
    onError: (e) => toast.error(errText(e)),
  });
  const rows = q.data ?? [];
  const total = rows[0]?.total_count ?? 0;
  return (
    <section id="site" className={card}>
      <h2 className="font-ui text-[15px] font-bold">{fill(t('links.siteTitle'), { n: fmtInt(total) })}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t('links.alertUnlinkedHint')}</p>
      {q.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {q.error && <p className="text-sm text-muted-foreground">{errText(q.error)}</p>}
      {q.data && !rows.length && <p className="text-sm text-muted-foreground">{t('links.siteNone')}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.shopify_variant_id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
              {r.image_url
                ? <img src={r.image_url} alt="" className="size-9 rounded-[4px] border border-border object-cover" loading="lazy" />
                : <span className="grid size-9 place-items-center rounded-[4px] border border-border text-muted-foreground"><ImageOff className="size-4" /></span>}
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.product_title}{r.variant_title && r.variant_title !== 'Default Title' ? ` — ${r.variant_title}` : ''}</div>
                <div className="text-[12px] tabular-nums text-muted-foreground">
                  {[r.sku ? `SKU ${r.sku}` : t('links.noSku'), fill(t('links.shopPrice'), { price: fmtEur(r.price) }), fill(t('links.shopQty'), { qty: r.qty ?? '—' })].join(' · ')}
                  {r.pending_article_reference && <> · {t('links.pendingArticle')} <span className="font-mono">{r.pending_article_reference}</span></>}
                  {r.candidates > 0 && !r.pending_article_reference && <> · {fill(t('links.siteCandidates'), { n: r.candidates })}</>}
                </div>
              </div>
              {admin && (
                <span className="flex gap-1">
                  {r.pending_article_id ? (
                    <Button asChild size="sm" variant="outline"><Link to="/parts/$articleId" params={{ articleId: r.pending_article_id }}>{t('links.openArticle')}</Link></Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate(r.shopify_variant_id)}>
                      <PackagePlus /> {t('links.createArticle')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setAttach(r)}><Link2 /> {t('links.attach')}</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {attach && <AttachDialog companyId={companyId} product={attach} onClose={() => setAttach(null)} onDone={invalidate} />}
    </section>
  );
}

function AttachDialog({ companyId, product, onClose, onDone }: { companyId: string; product: UnlinkedProduct; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState(product.sku ?? '');
  const search = useQuery({
    queryKey: ['article-links', 'attach-search', companyId, q],
    queryFn: () => listArticles(companyId, { search: q, limit: 20 }),
    enabled: q.trim().length >= 2,
  });
  const link = useMutation({
    meta: { success: false, error: false },
    mutationFn: (articleId: string) => linkShopifyVariant(companyId, product.shopify_variant_id, articleId),
    onSuccess: () => { toast.success(t('links.attached')); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('links.attachTitle')}</DialogTitle>
          <DialogDescription>{product.product_title}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('links.search')} className="pl-9" autoFocus />
        </div>
        <ul className="max-h-72 divide-y divide-border overflow-auto text-[13px]">
          {(search.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1.5">
              <span className="font-mono text-[12px]">{a.reference}</span>
              <span className="flex-1 truncate">{a.designation}</span>
              <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate(a.id)}><Link2 /> {t('links.attach')}</Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Motos du site ↔ fiches véhicule (VIN, modèle) : à valider. */
export function VehicleLinksSection({ companyId, admin }: { companyId: string; admin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['article-links', 'vehicles', companyId], queryFn: () => listVehicleLinks(companyId), retry: false });
  const decide = useMutation({
    meta: { success: false, error: false },
    mutationFn: ({ id, d }: { id: string; d: 'lie' | 'rejete' }) => decideVehicleLinks(companyId, [id], d),
    onSuccess: () => { toast.success(fill(t('links.decided'), { n: 1 })); qc.invalidateQueries({ queryKey: ['article-links', 'vehicles'] }); },
    onError: (e) => toast.error(errText(e)),
  });
  const rows = q.data ?? [];
  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold"><Bike className="size-4" /> {fill(t('links.motoTitle'), { n: fmtInt(rows.length) })}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t('links.motoHint')}</p>
      {q.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {q.error && <p className="text-sm text-muted-foreground">{errText(q.error)}</p>}
      {rows.length > 0 && (
        <ul className="max-h-[480px] divide-y divide-border overflow-auto rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.product_title} <span className="tabular-nums text-muted-foreground">· {fmtEur(r.price)}</span></div>
                <div className="text-[12px] text-muted-foreground">
                  <Link to="/vehicles/$vehicleId" params={{ vehicleId: r.vehicle_id }} className="underline-offset-2 hover:underline">
                    {[r.model, r.model_year, r.color, r.vin].filter(Boolean).join(' · ')}
                  </Link>
                  {' — '}{r.reason}
                </div>
              </div>
              <ScoreBadge score={r.score} />
              {admin && (
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, d: 'lie' })}><Check /> {t('links.accept')}</Button>
                  <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, d: 'rejete' })}><X /> {t('links.reject')}</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
