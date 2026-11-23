/**
 * Pièces de l'entretien sans référence fiable (Simon, 23/11/2026) : le DMS n'en invente aucune,
 * il les annonce « à compléter » dans la fenêtre du rendez-vous.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { maintenanceKitStock } from '../parts-popup-api';
import { kitPartsToComplete } from '../parts-popup-rules';

export function KitRefsToComplete({ companyId, vehicleId, reasonCode }: { companyId: string; vehicleId: string; reasonCode: string }) {
  const q = useQuery({
    queryKey: ['kit-refs-to-complete', companyId, vehicleId, reasonCode],
    queryFn: () => maintenanceKitStock(companyId, vehicleId, reasonCode),
    staleTime: 30_000,
  });
  const names = kitPartsToComplete(q.data?.lines ?? []);
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-[13px]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-bold text-warning">{t('dossier.refToComplete')} : </span>{names.join(', ')}
      </span>
      <Link to="/workshop/kits" target="_blank" rel="noopener" className="font-medium text-info underline-offset-2 hover:underline">
        {t('dossier.refCompleteLink')}
      </Link>
    </div>
  );
}
