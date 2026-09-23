/**
 * Mission 03 / M03 — « Motos à vendre » (décision M-36) : accès base du statut de parc.
 *
 * Fonctions SQL des migrations 20260923150000 et 20260923151000 :
 *   vehicle_site_status        — encart « Moto à vendre » de la fiche moto (lecture)
 *   vehicle_ensure_article     — crée l'article V/O/P/D de la moto et l'entrée de stock
 *   motos_parc_creer_articles  — met tout le parc en règle (aperçu ou application, administrateurs)
 *   motos_site_rattacher       — rattache les motos du site (aperçu ou application, administrateurs)
 *   vehicles_parc_check        — contrôle de cohérence (lecture seule)
 * Tant que les migrations ne sont pas appliquées, ParcUnavailableError est levée : l'écran affiche
 * « mise à jour de la base à appliquer » au lieu d'une erreur technique.
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingSchema } from '@/modules/articles/api';

// Fonctions récentes, absentes du type généré : appel non typé (lié au client).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any).call(supabase, fn, args) as Promise<{ data: unknown; error: unknown }>;

export class ParcUnavailableError extends Error {
  constructor() { super('parc_unavailable'); }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) {
    if (isMissingSchema(error)) throw new ParcUnavailableError();
    throw error;
  }
  return data as T;
}

export type MotoArticle = {
  id: string; reference: string; designation: string | null;
  mgmt_type: 'V' | 'O' | 'P' | 'D'; publishable: boolean;
  sale_price_ttc: number | null; vat_rate: number | null; real_qty: number | null;
};

export type MotoSiteStatus = {
  parc_kind: 'en_stock' | 'depot_vente' | 'vendue' | 'en_commande' | 'reprise' | 'interne';
  status: string;
  publishable_status: boolean;
  needs_article: boolean;
  article: MotoArticle | null;
  /** État Shopify de l'article (même forme que shopify_article_site_status). */
  site: unknown | null;
};

export const getMotoSiteStatus = (companyId: string, vehicleId: string) =>
  call<MotoSiteStatus | null>('vehicle_site_status', { _company: companyId, _vehicle: vehicleId });

/** Crée l'article de la moto (type déduit du statut de parc) et son entrée de stock. */
export const ensureMotoArticle = (vehicleId: string, mgmt?: 'V' | 'O' | 'P' | 'D') =>
  call<string>('vehicle_ensure_article', { _vehicle: vehicleId, _mgmt: mgmt ?? null, _unit_cost: null, _with_stock: true });

export type ParcArticlesReport = {
  applique: boolean; articles: number; type_V: number; type_O: number; type_P: number; type_D: number;
  sans_cout_de_revient: number; reste_sans_article: number;
};

export const creerArticlesDuParc = (companyId: string, apply: boolean) =>
  call<ParcArticlesReport>('motos_parc_creer_articles', { _company: companyId, _apply: apply, _limit: 500 });

export type MotosSiteReport = {
  applique: boolean;
  motos_du_site: number;
  rapprochement: { new: number; removed: number; auto_linked: number; pending: number; linked: number; motos: number } | null;
  motos_rattachees: number;
  articles_crees: number;
  articles_deja_presents: number;
  liens_produit_article: number;
  motos_rattachees_non_vendables: number;
  restant_a_valider: number;
  liens_lie_en_base: number;
  en_ligne_sans_moto_du_parc: number;
};

export const rattacherMotosDuSite = (companyId: string, apply: boolean) =>
  call<MotosSiteReport>('motos_site_rattacher', { _company: companyId, _apply: apply });

export type ParcAnomaly = {
  anomalie: string; vehicle_id: string; vin: string | null; model: string | null;
  statut: string; detail: string;
};

export const listParcAnomalies = (companyId: string) =>
  call<ParcAnomaly[]>('vehicles_parc_check', { _company: companyId }).then((r) => r ?? []);

export type MotosCreerReport = {
  applique: boolean; motos_creees: number; avec_annee: number; rattachees_au_catalogue: number;
  en_depot_vente: number; neuves: number; reste_en_ligne_sans_fiche: number;
};

/** M-40 : crée la fiche moto + l'article des annonces en ligne qu'aucune moto du parc ne reconnaît. */
export const creerMotosDepuisLeSite = (companyId: string, apply: boolean) =>
  call<MotosCreerReport>('motos_site_creer_fiches', { _company: companyId, _apply: apply, _limit: 200 });

export type PurifierReport = {
  applique: boolean; acceptees: number; rejetees_doublon: number; rejetees_annonce_obsolete: number;
  rejetees_ambigues: number; annonces_obsoletes_a_retirer: number; restant_a_valider: number;
};

/** Purifie les propositions : accepte le sûr, rejette le reste avec sa raison. Objectif zéro en attente. */
export const purifierPropositions = (companyId: string, apply: boolean) =>
  call<PurifierReport>('motos_site_purifier', { _company: companyId, _apply: apply });

export type AnnonceObsolete = {
  shopify_variant_id: string; product_title: string | null; price: number | null;
  shop_status: string | null; image_url: string | null; state: 'obsolete' | 'a_retirer'; reason: string | null;
};

export const listAnnoncesObsoletes = (companyId: string) =>
  call<AnnonceObsolete[]>('motos_site_annonces_obsoletes', { _company: companyId }).then((r) => r ?? []);

/** Marque les annonces obsolètes « à retirer ». N'écrit RIEN sur Shopify (accord de Simon requis). */
export const demanderRetraitAnnonces = (companyId: string) =>
  call<{ annonces_a_retirer: number; shopify_ecrit: boolean }>('motos_site_demander_retrait', { _company: companyId });

export type MotoSiteACreer = {
  shopify_variant_id: string; product_title: string | null; variant_title: string | null;
  sku: string | null; price: number | null; shop_status: string | null;
  image_url: string | null; propositions: number;
};

export const listMotosSiteACreer = (companyId: string, onlineOnly = true) =>
  call<MotoSiteACreer[]>('motos_site_a_creer', { _company: companyId, _en_ligne_seulement: onlineOnly }).then((r) => r ?? []);
