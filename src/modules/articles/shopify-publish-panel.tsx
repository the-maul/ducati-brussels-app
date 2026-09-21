/**
 * Mission 03 — Publier ou retirer un article du site depuis sa fiche (W-8).
 * État sur le site (couleur + icône + libellé), prix et stock affichés sur le site, boutons
 * « Publier sur le site » / « Retirer du site » / « Mettre à jour sur le site » (administrateurs),
 * derniers envois. Soumis au mode « Synchronisation Shopify » (Arrêtée / Essai / Tous).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, EyeOff, Upload, RefreshCw, Loader2, CircleSlash, Archive, CheckCircle2, Clock, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { getArticleSiteStatus, runPublishAction, type PublishAction, type PublishResult } from './shopify-sync-api';
import { RESULT_BADGE, KIND_LABEL } from './shopify-sync-panel';

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);
}
const fmtEur = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(2).replace('.', ',')} €`);

const ERR_LABEL: Record<string, string> = {
  sync_stopped: 'shopifySync.eSyncStopped',
  not_in_trial: 'shopifySync.eNotInTrial',
  not_publishable: 'shopifySync.eNotPublishable',
  already_linked: 'shopifySync.eAlreadyLinked',
  no_price: 'shopifySync.eNoPrice',
  inactive: 'shopifySync.eInactive',
  not_linked: 'shopifySync.eNotLinked',
};

function resultError(r: PublishResult): string {
  if (r.error === 'sku_exists') return fill(t('shopifySync.eSkuExists'), { title: r.product_title ?? '—' });
  if (r.error && ERR_LABEL[r.error]) return t(ERR_LABEL[r.error]);
  return `${t('shopifySync.eShopify')} : ${r.detail ?? r.error ?? ''}`;
}

export function ShopifyPublishPanel({ companyId, articleId, publishable }: {
  companyId: string; articleId: string; publishable: boolean;
}) {
  const { isAdmin, hasRole } = useAuth();
  const admin = isAdmin();
  const canRead = admin || hasRole('vendeur');
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<PublishAction | null>(null);

  const { data: st, isLoading } = useQuery({
    queryKey: ['article-site-status', articleId],
    queryFn: () => getArticleSiteStatus(companyId, articleId),
    enabled: canRead,
  });

  const act = useMutation({
    mutationFn: (a: PublishAction) => runPublishAction(companyId, articleId, a),
    onSuccess: (r, a) => {
      if (!r?.ok) { toast.error(resultError(r ?? { ok: false })); }
      else if (a === 'publish') toast.success(t('shopifySync.published'));
      else if (a === 'unpublish') toast.success(t('shopifySync.unpublished'));
      else toast.success(fill(t('shopifySync.updated'), { n: r.photos_added ?? 0 }));
      qc.invalidateQueries({ queryKey: ['article-site-status', articleId] });
      qc.invalidateQueries({ queryKey: ['shopify-products', companyId] });
    },
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${(e as Error)?.message ?? e}`),
  });

  if (!canRead) return null;

  const link = st?.link ?? null;
  const status = link?.product_status ?? null;
  const badge: { tone: StatusTone; icon: typeof Globe; label: string } = !link
    ? { tone: 'neutral', icon: CircleSlash, label: 'shopifySync.siteNotLinked' }
    : status === 'ACTIVE' ? { tone: 'success', icon: CheckCircle2, label: 'shopifySync.siteActive' }
    : status === 'ARCHIVED' ? { tone: 'neutral', icon: Archive, label: 'shopifySync.siteArchived' }
    : { tone: 'warning', icon: EyeOff, label: 'shopifySync.siteDraft' };

  const mode = st?.mode ?? 'arrete';
  const blocked = mode === 'arrete' ? 'shopifySync.blockedStopped' : mode === 'essai' && !st?.in_trial ? 'shopifySync.blockedTrial' : null;
  const busy = act.isPending;
  const confirmText = confirm === 'publish' ? 'shopifySync.publishConfirm' : confirm === 'unpublish' ? 'shopifySync.unpublishConfirm' : 'shopifySync.updateConfirm';
  const confirmLabel = confirm === 'publish' ? (link ? 'shopifySync.republish' : 'shopifySync.publish')
    : confirm === 'unpublish' ? 'shopifySync.unpublish' : 'shopifySync.update';

  return (
    <div className="rounded-md border border-border p-3 sm:col-span-2 lg:col-span-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Globe className="size-4 text-muted-foreground" />
        <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('shopifySync.siteTitle')}</span>
        {isLoading ? <Loader2 className="size-4 animate-spin" /> : <StatusBadge tone={badge.tone} icon={badge.icon} label={t(badge.label)} />}
        {st?.queued && <StatusBadge tone="info" icon={Clock} label={t('shopifySync.siteQueued')} />}
      </div>

      {link && (
        <p className="mb-2 text-[13px]">
          {t('shopifySync.sitePrice')} : <span className="tabular-nums">{fmtEur(link.price)}</span>
          {' · '}{t('shopifySync.siteStock')} : <span className="tabular-nums">{link.inventory_quantity ?? '—'}</span>
        </p>
      )}

      {admin && blocked && (
        <p className="mb-2 flex items-center gap-1.5 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><Info className="size-4" />{t(blocked)}</p>
      )}
      {admin && !blocked && !link && !publishable && (
        <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground"><Info className="size-4" />{t('shopifySync.needPublishable')}</p>
      )}

      {admin && (
        <div className="flex flex-wrap gap-2">
          {(!link || status !== 'ACTIVE') && (
            <Button type="button" size="sm" onClick={() => setConfirm('publish')} disabled={busy || !!blocked || (!link && !publishable)}>
              {busy && act.variables === 'publish' ? <Loader2 className="animate-spin" /> : <Upload />}
              {t(link ? 'shopifySync.republish' : 'shopifySync.publish')}
            </Button>
          )}
          {link && (
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirm('update')} disabled={busy || !!blocked}>
              {busy && act.variables === 'update' ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('shopifySync.update')}
            </Button>
          )}
          {link && status === 'ACTIVE' && (
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirm('unpublish')} disabled={busy || !!blocked}>
              {busy && act.variables === 'unpublish' ? <Loader2 className="animate-spin" /> : <EyeOff />} {t('shopifySync.unpublish')}
            </Button>
          )}
        </div>
      )}

      {(st?.log ?? []).length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('shopifySync.siteLog')}</div>
          <ul className="text-[12px]">
            {st!.log.map((l, i) => {
              const b = RESULT_BADGE[l.status] ?? RESULT_BADGE.erreur;
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 py-0.5">
                  <span className="tabular-nums text-muted-foreground">{new Date(l.created_at).toLocaleString('fr-BE')}</span>
                  <span>{t(KIND_LABEL[l.kind] ?? l.kind)}</span>
                  <StatusBadge tone={b.tone} icon={b.icon} label={t(b.label)} />
                  {l.price_sent != null && <span className="tabular-nums">{fmtEur(l.price_sent)}</span>}
                  {l.qty_sent != null && <span className="tabular-nums">· {l.qty_sent}</span>}
                  {l.detail && <span className="text-muted-foreground">{l.detail}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(confirmLabel)}</AlertDialogTitle>
            <AlertDialogDescription>{t(confirmText)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const a = confirm; setConfirm(null); if (a) act.mutate(a); }}>{t(confirmLabel)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
