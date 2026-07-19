/**
 * M7 — Tag de statut de reprise (couleur + icône + libellé, charte §9).
 * Réutilisé : liste des reprises, fiche de reprise, fiche CRM (synchro).
 */
import { StatusBadge } from '@/components/status-badge';
import { REPRISE_STATUS_META, type RepriseStatus } from './reprise-status';
import { t } from '@/lib/i18n';

export function RepriseStatusBadge({ status }: { status: RepriseStatus }) {
  const m = REPRISE_STATUS_META[status];
  return <StatusBadge tone={m.tone} icon={m.icon} label={t(`tradein.rstatus_${status}`)} />;
}
