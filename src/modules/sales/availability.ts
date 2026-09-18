/**
 * M6 — Statut de disponibilité des lignes d'un document de vente (dept Ventes, point 2).
 * Pour chaque ligne rattachée à un article, le besoin (quantity) est couvert par le
 * disponible courant (available_qty, triple stock B4) à hauteur de min(dispo, besoin).
 * Les lignes texte/main d'œuvre (sans article_id) sont ignorées du calcul.
 * Un document sans aucune ligne à article n'a pas de statut ('na').
 */
import { PackageCheck, PackageMinus, PackageX, Package, Truck, ShoppingCart, type LucideIcon } from 'lucide-react';
import type { StatusTone } from '@/components/status-badge';

export type AvailabilityStatus = 'disponible' | 'partiel' | 'indisponible' | 'na';

export type AvailabilityLine = { article_id: string | null; quantity: number; line_type?: string | null };

export type DocAvailability = { pct: number; status: AvailabilityStatus };

// Types de documents où la pastille dispo a du sens : devis / proforma, bon de commande,
// réservation, bon de livraison. L'OR est un objet atelier M8, hors table `documents` —
// FAC/TIK/AVO facturent un stock déjà mouvementé, la dispo n'y est plus pertinente ('na').
export const AVAILABILITY_DOC_TYPES = ['DEV', 'BC', 'RES', 'BL'] as const;

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
    if (l.line_type && l.line_type !== 'article') continue; // main-d'œuvre, texte, vide : pas de stock
    const dispo = stockMap.get(l.article_id) ?? 0;
    need += l.quantity;
    covered += Math.min(dispo, l.quantity);
  }
  if (need === 0) return { pct: 0, status: 'na' };
  const pct = Math.max(0, Math.min(100, Math.round((covered / need) * 100)));
  const status: AvailabilityStatus = pct >= 100 ? 'disponible' : pct > 0 ? 'partiel' : 'indisponible';
  return { pct, status };
}

/* ------------------------------------------------------------------------------------------
 * Disponibilité d'un article dans la recherche d'une ligne de vente (mission 05, carte 2).
 * « Couleur verte = disponible » (vidéo de Domenico, G8). Trois états, calculés sur le triple
 * stock B4 : libre = réel − réservé ; « en commande » = commandes fournisseur CMD validées sans
 * réception reçue (fonction SQL _article_on_order_qty, via part_order_article_search).
 *   - disponible  : le libre couvre la quantité demandée ;
 *   - en commande : le libre + l'en-commande la couvrent ;
 *   - à commander : sinon.
 * Les articles non stockés (M), texte (F) et main-d'œuvre (T) n'ont pas de statut ('na').
 * ---------------------------------------------------------------------------------------- */
export type SaleStockStatus = 'disponible' | 'en_commande' | 'a_commander' | 'na';

export const NON_STOCK_MGMT_TYPES = ['M', 'F', 'T'] as const;

export type SaleStockInput = { mgmt_type: string | null; real_qty: number; reserved_qty: number; on_order_qty: number };

export function saleStockStatus(a: SaleStockInput, need = 1): SaleStockStatus {
  if (a.mgmt_type && (NON_STOCK_MGMT_TYPES as readonly string[]).includes(a.mgmt_type)) return 'na';
  const qty = need > 0 ? need : 1;
  const free = (Number(a.real_qty) || 0) - (Number(a.reserved_qty) || 0);
  if (free >= qty) return 'disponible';
  if (free + (Number(a.on_order_qty) || 0) >= qty) return 'en_commande';
  return 'a_commander';
}

export const SALE_STOCK_META: Record<SaleStockStatus, { tone: StatusTone; icon: LucideIcon; labelKey: string }> = {
  disponible: { tone: 'success', icon: PackageCheck, labelKey: 'availability.stockDisponible' },
  en_commande: { tone: 'info', icon: Truck, labelKey: 'availability.stockEnCommande' },
  a_commander: { tone: 'warning', icon: ShoppingCart, labelKey: 'availability.stockACommander' },
  na: { tone: 'neutral', icon: Package, labelKey: 'availability.statusNa' },
};
