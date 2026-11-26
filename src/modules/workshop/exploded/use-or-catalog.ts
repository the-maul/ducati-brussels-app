/**
 * M8 — ATE-05 (26/11/2026) : le catalogue Ducati du modele-annee de la moto d'un OR (dessins, lignes,
 * regles et kit), lu une fois et partage par le bouton « Voir sur la vue eclatee » des operations
 * et par le filtre des operations « (si present) » (usePlanOps). Memes cles de cache partout.
 */
import { useQuery } from '@tanstack/react-query';
import { modelYearPartsIndex, orModelYear } from './api';

export function useOrCatalogIndex(orId: string, companyId: string | null, enabled: boolean) {
  const my = useQuery({ queryKey: ['exploded', 'or-my', orId], queryFn: () => orModelYear(orId), staleTime: 300_000, enabled });
  const modelYearId = my.data?.modelYearId ?? null;
  const index = useQuery({
    queryKey: ['exploded', 'op-parts-index', companyId, modelYearId],
    queryFn: () => modelYearPartsIndex(companyId as string, modelYearId as string),
    enabled: enabled && !!modelYearId && !!companyId, staleTime: 3_600_000,
  });
  // Connu : pas de modele-annee (rien a lire), ou catalogue lu (ou en erreur : on garde tout).
  const settled = !enabled || my.isFetched && (!modelYearId || !companyId || index.isFetched);
  return { my, modelYearId, index, settled };
}
