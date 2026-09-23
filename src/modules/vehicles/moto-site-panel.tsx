/**
 * Mission 03 / M03 — « Motos à vendre » (décision M-36) : encart de la fiche moto.
 *
 * Montre le STATUT DE PARC (En stock / Dépôt-vente / Vendue / Moto client), l'article V/O/P/D qui
 * porte le stock et le prix, et propose « Publier sur le site » UNIQUEMENT pour En stock et
 * Dépôt-vente. La publication elle-même réutilise le mécanisme Shopify existant (shopify_links,
 * shopify-publish, shopify-push) via l'encart « Sur le site Shopify » de l'article.
 * À la facturation, la moto sort du stock et est retirée du site (déclencheur en base).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bike, Loader2, Package, PlusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { ShopifyPublishPanel } from '@/modules/articles/shopify-publish-panel';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { canPublish, isCustomerBike, parcKind, type ParcKind } from './parc';
import { ensureMotoArticle, getMotoSiteStatus, ParcUnavailableError } from './parc-api';
import type { Vehicle } from './api';

const KIND_TONE: Record<ParcKind, StatusTone> = {
  en_stock: 'success',
  depot_vente: 'info',
  vendue: 'neutral',
  en_commande: 'info',
  reprise: 'warning',
  interne: 'neutral',
};

const fmtEur = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toFixed(2).replace('.', ',')} €`;

export function MotoSitePanel({ companyId, vehicle }: { companyId: string; vehicle: Vehicle }) {
  const { isAdmin, hasRole } = useAuth();
  const admin = isAdmin();
  const canRead = admin || hasRole('vendeur');
  const qc = useQueryClient();

  const kind = parcKind(vehicle.status);
  const clientBike = isCustomerBike(vehicle.status, vehicle.article_id);

  const { data: st, isLoading, error } = useQuery({
    queryKey: ['moto-site-status', vehicle.id],
    queryFn: () => getMotoSiteStatus(companyId, vehicle.id),
    enabled: canRead,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => ensureMotoArticle(vehicle.id),
    onSuccess: () => {
      toast.success(t('motoParc.articleCreated'));
      qc.invalidateQueries({ queryKey: ['moto-site-status', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
    },
    onError: (e) => toast.error(`${t('motoParc.articleErr')} : ${(e as Error)?.message ?? e}`),
  });

  if (!canRead) return null;
  if (error instanceof ParcUnavailableError) {
    return <p className="text-[13px] text-muted-foreground">{t('motoParc.migrationNeeded')}</p>;
  }
  if (isLoading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;

  const article = st?.article ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Bike className="size-4 text-muted-foreground" />
        <StatusBadge tone={KIND_TONE[kind]} label={clientBike ? t('motoParc.kindClient') : t(`motoParc.kind_${kind}`)} />
        <span className="text-[13px] text-muted-foreground">{t(`vehicles.status_${vehicle.status}`)}</span>
      </div>

      {clientBike && (
        <p className="text-[13px] text-muted-foreground">{t('motoParc.clientBikeHint')}</p>
      )}

      {!clientBike && !article && (
        <div className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <p>{st?.needs_article ? t('motoParc.noArticleBlocking') : t('motoParc.noArticle')}</p>
          {admin && st?.needs_article && (
            <Button size="sm" variant="outline" className="mt-2" disabled={create.isPending}
              onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <PlusCircle className="mr-1 size-4" />}
              {t('motoParc.createArticle')}
            </Button>
          )}
        </div>
      )}

      {article && (
        <div className="rounded-md border border-border px-3 py-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Package className="size-4 text-muted-foreground" />
            <Link to="/parts/$articleId" params={{ articleId: article.id }} className="font-medium underline">
              {article.reference}
            </Link>
            <span className="text-muted-foreground">{article.designation ?? '—'}</span>
            <StatusBadge tone="info" label={t(`motoParc.mgmt_${article.mgmt_type}`)} />
            <span className="tabular-nums">{t('motoParc.priceTtc')} : {fmtEur(article.sale_price_ttc)}</span>
            <span className="tabular-nums">{t('motoParc.stock')} : {article.real_qty ?? 0}</span>
          </div>
        </div>
      )}

      {article && canPublish(vehicle.status) && (
        <ShopifyPublishPanel companyId={companyId} articleId={article.id} publishable={article.publishable} />
      )}
      {article && !canPublish(vehicle.status) && (
        <p className="text-[13px] text-muted-foreground">{t('motoParc.notPublishable')}</p>
      )}
    </div>
  );
}
