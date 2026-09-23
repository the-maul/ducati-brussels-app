/**
 * Mission 03 / M03 — « Motos à vendre : du stock du DMS au site » (décision M-36 du 23/09).
 *
 * Règles PURES du statut de parc d'une moto — miroir exact des fonctions SQL
 * `vehicle_parc_kind`, `vehicle_needs_article`, `vehicle_parc_publishable` et
 * `vehicle_article_mgmt_type` (migration 20260923150000_m3_motos_parc_article.sql).
 * Toute modification ici doit être reportée là-bas, et inversement (tests/moto-parc.test.ts).
 *
 * Ce qui rend une moto vendable est son STATUT DE PARC, pas un faux client « Italbike Store » :
 *   En stock    → à nous, aucun propriétaire, visible sur le site
 *   Dépôt-vente → propriétaire = client déposant, visible sur le site
 *   Vendue      → propriétaire = acheteur, retirée du site
 *   Moto client → statut « Vendu » SANS article (décision M-12) : jamais sur le site
 */
import type { VehicleStatus } from './api';

/** Statut de parc « métier » de la décision M-36. */
export type ParcKind = 'en_stock' | 'depot_vente' | 'vendue' | 'en_commande' | 'reprise' | 'interne';

const KIND: Record<VehicleStatus, ParcKind> = {
  stock_vn: 'en_stock',
  stock_vo: 'en_stock',
  reserve: 'en_stock',
  demo: 'en_stock',
  depot_vente: 'depot_vente',
  depot_agent: 'depot_vente',
  vendu: 'vendue',
  livre: 'vendue',
  en_commande: 'en_commande',
  repris: 'reprise',
  courtoisie: 'interne',
};

export function parcKind(status: VehicleStatus): ParcKind {
  return KIND[status] ?? 'interne';
}

/** Une moto « En stock » ou « Dépôt-vente » doit avoir un article : c'est lui qui porte le stock (B1, B9). */
export function needsArticle(status: VehicleStatus): boolean {
  const k = parcKind(status);
  return k === 'en_stock' || k === 'depot_vente';
}

/**
 * Le bouton « Publier sur le site » est proposé pour TOUT le parc vendable : « En stock »
 * (y compris « Réservée » et « Démo », qui sont bien à nous) et « Dépôt-vente ».
 * Retour de Simon du 23/09 : « si tu as des motos dans G8 et pas sur Shopify, pas grave, tu
 * permets de les publier » — plus rien n'est grisé à tort. Une moto vendue ou une moto de
 * client ne l'est jamais.
 */
export function canPublish(status: VehicleStatus): boolean {
  return needsArticle(status);
}

/**
 * M-40 — Une moto sans VIN ne peut pas être facturée (dérogation assumée à B9 : la fiche est
 * créée depuis l'annonce du site pour ne rien laisser à faire à la main, mais la vente est
 * bloquée tant que le numéro de châssis n'est pas saisi). Miroir du déclencheur SQL
 * `trg_moto_sans_vin_bloque_la_vente` sur `document_lines`.
 */
export function canInvoice(vin: string | null | undefined): boolean {
  return !!(vin ?? '').trim();
}

/** Une moto de client (décision M-12) : statut « Vendu » et aucun article. */
export function isCustomerBike(status: VehicleStatus, articleId: string | null | undefined): boolean {
  return parcKind(status) === 'vendue' && !articleId;
}

/**
 * Type de gestion de l'article d'après le statut de parc et la référence G8 (B1).
 * Les références reprises de G8 sont parlantes : DEP… = dépôt-vente, OCC… = occasion,
 * nom de modèle (MULTISTRADAV4S…) = moto neuve. Le statut « Réservée » ne dit pas, à lui seul,
 * si la moto est neuve ou d'occasion : c'est la référence qui tranche.
 */
export function articleMgmtType(status: VehicleStatus, reference?: string | null): 'V' | 'O' | 'P' | 'D' {
  const ref = (reference ?? '').trim().toUpperCase();
  if (status === 'depot_vente' || status === 'depot_agent' || ref.startsWith('DEP')) return 'D';
  if (status === 'stock_vo' || status === 'repris' || ref.startsWith('OCC')) return 'O';
  if (status === 'stock_vn' || status === 'demo' || status === 'en_commande' || status === 'reserve') return 'V';
  return 'O';
}

/** Taux de TVA porté par l'article de la moto (B2 : type O = TVA sur marge, taux 0 sur la ligne). */
export function articleVatRate(mgmt: 'V' | 'O' | 'P' | 'D'): number {
  return mgmt === 'O' || mgmt === 'D' ? 0 : 21;
}
