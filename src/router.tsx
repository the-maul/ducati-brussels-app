import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { createMutationCache } from "./lib/mutation-feedback";

/** Duree pendant laquelle une donnee lue est reutilisee sans nouvel appel (navigation, remontage). */
export const QUERY_STALE_MS = 30_000;

export const getRouter = () => {
  // mutationCache : toute écriture produit un toast, sans instrumenter chaque écran.
  // Perf (lot perf 2, 20/11/2026) : valeurs par defaut raisonnables. Avant : donnees perimees
  // tout de suite (staleTime 0), toute la page relue a chaque retour sur l'onglet (59 requetes
  // pour une fiche OR) et 3 nouvelles tentatives sur erreur (7 s d'attente avant le message).
  // Les ecrans qui doivent suivre le direct ont leur propre refetchInterval (cloche, ecran
  // client, Mon atelier, paiement QR) ; chaque enregistrement invalide ses donnees.
  const queryClient = new QueryClient({
    mutationCache: createMutationCache(),
    defaultOptions: {
      queries: { staleTime: QUERY_STALE_MS, refetchOnWindowFocus: false, retry: 1 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Seule la zone de travail defile (AppShell) : sans ce selecteur, une nouvelle page
    // heritait du defilement de la precedente, et Retour ne retrouvait pas la position (UX011).
    scrollToTopSelectors: ['#app-main'],
    defaultPreloadStaleTime: 0,
  });

  return router;
};
