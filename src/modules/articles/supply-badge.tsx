/**
 * Pastille « Remplacee » / « Fin de serie » (etat au tarif Ducati, TAR008) : couleur + icone +
 * libelle (charte). Rien pour une piece commandable ou dont l'etat est inconnu.
 * Affichee dans la recherche d'article (OR, check-up, ventes, caisse) et la liste Pieces.
 */
import { Ban, Repeat } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { supplyBadgeOf } from './supply-state';

export function SupplyStateBadge({ availability, className }: { availability: string | null | undefined; className?: string }) {
  const b = supplyBadgeOf(availability);
  if (!b) return null;
  return (
    <span title={b.hint} className={className}>
      <StatusBadge tone={b.tone} icon={b.tone === 'danger' ? Ban : Repeat} label={b.label} />
    </span>
  );
}
