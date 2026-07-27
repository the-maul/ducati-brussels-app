/**
 * M6 — Pastille de disponibilité (couleur + icône + libellé, charte §9).
 * Réutilisée : liste des ventes, fiche document (en-tête + par ligne).
 */
import { StatusBadge } from '@/components/status-badge';
import { AVAILABILITY_META, type AvailabilityStatus } from './availability';
import { t } from '@/lib/i18n';

const LABEL_KEY: Record<AvailabilityStatus, string> = {
  disponible: 'availability.statusDisponible',
  partiel: 'availability.statusPartiel',
  indisponible: 'availability.statusIndisponible',
  na: 'availability.statusNa',
};

export function AvailabilityBadge({ status, pct }: { status: AvailabilityStatus; pct?: number }) {
  const m = AVAILABILITY_META[status];
  const label = t(LABEL_KEY[status]) + (status !== 'na' && pct != null ? ` · ${pct}%` : '');
  return <StatusBadge tone={m.tone} icon={m.icon} label={label} />;
}
