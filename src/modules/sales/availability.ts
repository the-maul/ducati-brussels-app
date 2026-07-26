/**
 * M6 — Statut de disponibilité des lignes d'un document de vente (dept Ventes, point 2).
 * Pour chaque ligne rattachée à un article, le besoin (quantity) est couvert par le
 * disponible courant (available_qty, triple stock B4) à hauteur de min(dispo, besoin).
 * Les lignes texte/main d'œuvre (sans article_id) sont ignorées du calcul.
 * Un document sans aucune ligne à article n'a pas de statut ('na').
 */
import { PackageCheck, PackageMinus, PackageX, Package, type LucideIcon } from 'lucide-react';
import type { StatusTone } from '@/components/status-badge';

export type AvailabilityStatus = 'disponible' | 'partiel' | 'indisponible' | 'na';

export type AvailabilityLine = { article_id: string | null; quantity: number };

export type DocAvailability = { pct: number; status: AvailabilityStatus };

// Types de documents où la pastille dispo a du sens : devis / réservation (≈ bon de
// commande) / bon de livraison. Le schéma `documents` n'a pas de type BC ni OR (l'OR
// est un objet atelier M8, hors table `documents`) — FAC/TIK/AVO facturent un stock déjà
// mouvementé, la dispo n'y est plus pertinente ('na').
export const AVAILABILITY_DOC_TYPES = ['DEV', 'RES', 'BL'] as const;

export const AVAILABILITY_META: Record<AvailabilityStatus, { tone: StatusTone; icon: LucideIcon }> = {
  disponible: { tone: 'success', icon: PackageCheck },
  partiel: { tone: 'warning', icon: PackageMinus },
  indisponible: { tone: 'danger', icon: PackageX },
  na: { tone: 'neutral', icon: Package },
};

/**
 * Disponibilité d'un ensemble de lignes (document entier ou une seule ligne) à partir
 * du disponible courant par article. `stockMap` : article_id → available_qty.
 * // TODO distinguer "en commande" (attendu en réception) via purchase_lines — pour
 * // l'instant, faute de rapprochement fiable avec les commandes fournisseur en cours,
 * // le filtre "En commande" retombe sur le même critère que "Indisponible" (0 %).
 */
export function computeDocAvailability(lines: AvailabilityLine[], stockMap: Map<string, number>): DocAvailability {
  let need = 0;
  let covered = 0;
  for (const l of lines) {
    if (!l.article_id || l.quantity <= 0) continue;
    const dispo = stockMap.get(l.article_id) ?? 0;
    need += l.quantity;
    covered += Math.min(dispo, l.quantity);
  }
  if (need === 0) return { pct: 0, status: 'na' };
  const pct = Math.max(0, Math.min(100, Math.round((covered / need) * 100)));
  const status: AvailabilityStatus = pct >= 100 ? 'disponible' : pct > 0 ? 'partiel' : 'indisponible';
  return { pct, status };
}
