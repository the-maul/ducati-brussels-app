// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Hébergement hors Lovable : le plugin de déploiement nitro est désactivé par défaut
  // (« No Lovable context detected »). On le force-active sur la cible Netlify (notre hôte).
  // NB : en contexte Lovable (sandbox), la config ré-impose cloudflare-module — déploiement
  // Lovable préservé. Le preset n'agit qu'au build, pas en `vite dev`.
  nitro: { preset: "netlify" },
  // Autorise l'accès via un hôte externe (tunnel Cloudflare/ngrok…) pour les démos client.
  // En dev, Vite bloque par défaut les hôtes inconnus (403) ; on lève ce garde-fou.
  vite: {
    server: { allowedHosts: true },
  },
});
