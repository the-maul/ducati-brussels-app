// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Deux cibles d'hébergement (lot Cloudflare, 20/11/2026) :
//   - par défaut : Netlify (production actuelle, inchangée) → `bun run build` ;
//   - DEPLOY_TARGET=cloudflare : Cloudflare Workers → `bun run build:cloudflare`
//     (sortie .output/ : public/ = statiques, server/index.mjs + server/wrangler.json générés).
// Le preset Nitro `cloudflare-module` est celui que Lovable utilisait pour ce même projet ; la
// configuration Wrangler commune est dans wrangler.jsonc (Nitro la fusionne au build).
const cible = process.env.DEPLOY_TARGET === "cloudflare" ? "cloudflare" : "netlify";

// Équivalent Cloudflare des règles de netlify.toml, appliqué aux fichiers statiques
// (Workers Static Assets : ces fichiers ne réveillent pas le serveur et ne sont pas facturés).
const REDIRECTIONS_CLOUDFLARE = [
  // Perf 2 : /favicon.ico servi en statique (image de la marque), sans réveiller le rendu serveur.
  "/favicon.ico /brands/ducati.webp 200",
].join("\n");

const nitroCloudflare = {
  preset: "cloudflare-module",
  cloudflare: { nodeCompat: true, deployConfig: true },
  // En-têtes : Nitro écrit lui-même .output/public/_headers (« /assets/* » gardés un an, noms à
  // empreinte), comme il le fait pour Netlify : rien à ajouter ici.
  // Module plutôt que `hooks.compiled` : un `hooks.compiled` ici remplacerait celui du preset (qui
  // écrit wrangler.json et _headers) au lieu de s'y ajouter.
  modules: [
    (nitro: {
      options: { output: { publicDir: string } };
      hooks: { hook: (name: "compiled", fn: () => Promise<void>) => void };
    }) => {
      nitro.hooks.hook("compiled", async () => {
        const dir = nitro.options.output.publicDir;
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "_redirects"), REDIRECTIONS_CLOUDFLARE + "\n");
      });
    },
  ],
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Hébergement hors Lovable : le plugin de déploiement nitro est désactivé par défaut
  // (« No Lovable context detected »). On le force-active sur la cible choisie (Netlify par défaut).
  // NB : en contexte Lovable (sandbox), la config ré-impose cloudflare-module — déploiement
  // Lovable préservé. Le preset n'agit qu'au build, pas en `vite dev`.
  nitro: cible === "cloudflare" ? nitroCloudflare : { preset: "netlify" },
  // Autorise l'accès via un hôte externe (tunnel Cloudflare/ngrok…) pour les démos client.
  // En dev, Vite bloque par défaut les hôtes inconnus (403) ; on lève ce garde-fou.
  vite: {
    server: { allowedHosts: true },
  },
});
