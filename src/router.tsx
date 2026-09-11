import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { createMutationCache } from "./lib/mutation-feedback";

export const getRouter = () => {
  // mutationCache : toute écriture produit un toast, sans instrumenter chaque écran.
  const queryClient = new QueryClient({ mutationCache: createMutationCache() });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
