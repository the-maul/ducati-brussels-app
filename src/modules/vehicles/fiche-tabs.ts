/**
 * M3 — Onglets de la fiche moto (lot design des fiches, 20/11/2026, charte §5.7) :
 * Infos · Historique atelier · Documents · Photos · Comptabilité.
 *
 * Avant : 17 blocs empilés (5 800 px) et 3 « Enregistrer » rouges + « Ajouter la prime » rouge.
 * Après : chaque bloc a sa place, rien ne disparaît :
 *   Infos              → propriétaires, propriétaire / détenteur / utilisateur, formulaire de la fiche
 *                        (seul bouton rouge : « Enregistrer », collé en bas)
 *   Historique atelier → OR et km, prochain entretien, plan d'entretien, interventions reportées,
 *                        infos Ducati (garantie, maintenance, bulletins)
 *   Documents          → factures / OR / devis de la moto, documents et photos joints (GED)
 *   Photos             → photos de réception des OR
 *   Comptabilité       → moto à vendre, bilan économique, primes, clients intéressés (motos du
 *                        stock seulement), registre des véhicules à moteur
 * Règles pures (testées) : l'onglet est gardé dans l'adresse (?tab=).
 */
import { isCustomerBike } from './parc';
import type { VehicleStatus } from './api';

export const VEHICLE_TABS = ['infos', 'atelier', 'documents', 'photos', 'comptabilite'] as const;
export type VehicleTab = (typeof VEHICLE_TABS)[number];
export const VEHICLE_DEFAULT_TAB: VehicleTab = 'infos';

export const isVehicleTab = (v: unknown): v is VehicleTab => typeof v === 'string' && (VEHICLE_TABS as readonly string[]).includes(v);
export const parseVehicleTab = (v: unknown): VehicleTab | undefined => (isVehicleTab(v) ? v : undefined);

export const VEHICLE_TAB_LABEL: Record<VehicleTab, string> = {
  infos: 'designFiches.vTabInfos',
  atelier: 'designFiches.vTabWorkshop',
  documents: 'designFiches.vTabDocuments',
  photos: 'designFiches.vTabPhotos',
  comptabilite: 'designFiches.vTabAccounting',
};

/**
 * Blocs « commerce » (bilan économique, primes, moto à vendre, clients intéressés) : seulement
 * pour une moto du stock (en stock, dépôt-vente, en commande, reprise, parc interne, ou vendue par
 * nous avec son article). Jamais pour une moto de client (statut « Vendu » sans article, décision M-12).
 */
export function showCommerceBlocks(v: { status: VehicleStatus; article_id?: string | null }): boolean {
  return !isCustomerBike(v.status, v.article_id ?? null);
}
