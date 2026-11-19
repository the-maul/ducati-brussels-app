/**
 * M8 — Icone de chaque statut de RDV (charte : tout statut = couleur + icone + libelle).
 */
import {
  CalendarCheck, Inbox, CircleParking, Wrench, Hourglass, CheckCircle2, BellRing, Receipt, XCircle, Circle,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  // Q43 : « receptionne » = moto deposee (parking), « travaux commences » = en travail (cle).
  demande: Inbox, prevu: CalendarCheck, arrive: CircleParking, en_cours: Wrench, attente: Hourglass,
  termine: CheckCircle2, client_informe: BellRing, facture: Receipt, annule: XCircle,
};

export function StatusIcon(status: string): LucideIcon {
  return ICONS[status] ?? Circle;
}
