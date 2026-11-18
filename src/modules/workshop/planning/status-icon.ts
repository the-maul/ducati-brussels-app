/**
 * M8 — Icone de chaque statut de RDV (charte : tout statut = couleur + icone + libelle).
 */
import {
  CalendarCheck, Inbox, LogIn, Wrench, Hourglass, CheckCircle2, BellRing, Receipt, XCircle, Circle,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  demande: Inbox, prevu: CalendarCheck, arrive: LogIn, en_cours: Wrench, attente: Hourglass,
  termine: CheckCircle2, client_informe: BellRing, facture: Receipt, annule: XCircle,
};

export function StatusIcon(status: string): LucideIcon {
  return ICONS[status] ?? Circle;
}
