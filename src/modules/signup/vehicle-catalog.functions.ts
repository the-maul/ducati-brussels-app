/**
 * Marques et modèles de motos toutes marques — lecture PUBLIQUE (retour client du 21/09).
 * Server functions sans connexion requise, exécutées côté serveur avec la clé de service,
 * comme signup.functions.ts : `anon` n'a aucun accès direct aux tables ni aux fonctions SQL
 * (lot sécurité du 19/09). L'inscription en ligne et la borne du comptoir passent par ici.
 *
 * Données : tables `vehicle_brands` / `vehicle_models` (migration 20261005100000).
 * Source vPIC/NHTSA (domaine public) + les marques déjà présentes dans nos fiches moto.
 * motoplanete.com n'est pas recopié (voir l’en-tête de la migration, décision M-49).
 *
 * La saisie libre du client reste possible et n'écrit jamais dans ces tables : la moto
 * déclarée passe par `contact_declared_vehicles`, dont un déclencheur alimente la file
 * « marques à valider » (`vehicle_brand_submissions`). Rien à appeler ici.
 */
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

export type VehicleBrand = { id: string; name: string; modelCount: number };
export type VehicleModel = { id: string; name: string; yearFrom: number | null; yearTo: number | null };

const searchInput = z.object({
  q: z.string().trim().max(60).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/** Marques proposées. Recherche vide → les marques mises en avant, puis les mieux fournies. */
export const searchMotoBrands = createServerFn({ method: 'POST' })
  .inputValidator(searchInput)
  .handler(async ({ data }): Promise<VehicleBrand[]> => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: rows, error } = await supabaseAdmin.rpc('vehicle_brand_search', {
      _q: data.q || undefined,
      _limit: data.limit ?? 48,
    });
    if (error) return [];
    return (rows ?? []).map((r: { id: string; name: string; model_count: number }) => ({
      id: r.id, name: r.name, modelCount: r.model_count ?? 0,
    }));
  });

/** Modèles d'une marque. Recherche vide → tous les modèles connus, par ordre alphabétique. */
export const searchMotoModels = createServerFn({ method: 'POST' })
  .inputValidator(searchInput.extend({ brandId: z.string().uuid() }))
  .handler(async ({ data }): Promise<VehicleModel[]> => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: rows, error } = await supabaseAdmin.rpc('vehicle_model_search', {
      _brand: data.brandId,
      _q: data.q || undefined,
      _limit: data.limit ?? 120,
    });
    if (error) return [];
    return (rows ?? []).map((r: { id: string; name: string; year_from: number | null; year_to: number | null }) => ({
      id: r.id, name: r.name, yearFrom: r.year_from ?? null, yearTo: r.year_to ?? null,
    }));
  });
