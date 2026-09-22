/**
 * Un seul catalogue (décision M-25) : le DMS est la source. Un produit créé directement dans Shopify
 * (sans article du DMS) est signalé en tête de Pièces & Accessoires, avec un lien vers l'outil
 * Rapprochements (« Créer l'article » / « Rattacher »).
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { listUnlinkedProducts } from './links-api';
import { fill, fmtInt } from './links-ui';

export function UnlinkedProductsAlert() {
  const { activeCompanyId, isAdmin, hasRole } = useAuth();
  const allowed = isAdmin() || hasRole('vendeur');
  const q = useQuery({
    queryKey: ['article-links', 'unlinked', activeCompanyId, 'count'],
    queryFn: () => listUnlinkedProducts(activeCompanyId!, 1, 0),
    enabled: !!activeCompanyId && allowed,
    staleTime: 60_000,
    retry: false,
  });
  const n = q.data?.[0]?.total_count ?? 0;
  if (!allowed || !n) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning" role="status">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span className="font-bold tabular-nums">{fill(t('links.alertUnlinked'), { n: fmtInt(n) })}</span>
      <span>{t('links.alertUnlinkedHint')}</span>
      <Link to="/parts/links" hash="site" className="ml-auto font-bold underline underline-offset-2">{t('links.alertOpen')}</Link>
    </div>
  );
}
