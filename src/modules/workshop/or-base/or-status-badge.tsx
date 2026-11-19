/**
 * M8 — Badge de statut d'OR (couleur + icone + libelle, charte §1), statuts G8 du 18/11/2026.
 */
import { CheckCircle2, Circle, Clock, FileQuestion, Mail, PackageSearch, Wrench, XCircle, type LucideIcon } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { orStatusTone } from './rules';

const ICONS: Record<string, LucideIcon> = {
  a_faire: Circle, attente_devis: FileQuestion, attente_pieces: PackageSearch, en_cours: Wrench,
  pret: CheckCircle2, client_informe: Mail, facture: CheckCircle2, annule: XCircle,
};

export function orStatusLabel(status: string): string {
  const key = `orBase.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

/** `className` : badge agrandi de l'ecran tablette « Mon atelier » (lot F). */
export function OrStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge tone={orStatusTone(status)} icon={ICONS[status] ?? Clock} label={orStatusLabel(status)} className={className} />;
}
