import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import tokensCss from "../styles/tokens.css?url";
import appCss from "../styles.css?url";
import { reportError } from "../lib/error-reporting";
import { AuthProvider } from "@/lib/auth/auth-context";
import { LocaleProvider, t, useLocale } from "@/lib/i18n";
import { ConfirmProvider } from "@/components/confirm-provider";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t('rootPage.notFoundTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('rootPage.notFoundText')}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('rootPage.goHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ErrorComponentProps plutot qu'un type ecrit a la main : TanStack type `error`
// en `unknown` (une limite d'erreur peut attraper n'importe quoi, pas seulement
// une Error), et la signature locale n'etait donc pas acceptee.
function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t('rootPage.errorTitle')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('rootPage.errorText')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('rootPage.retry')}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t('rootPage.goHome')}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: `${t('app.name')} — DMS` },
      { name: "description", content: t('rootPage.metaDescription') },
      { name: "author", content: t('app.name') },
      { property: "og:title", content: `${t('app.name')} — DMS` },
      { property: "og:description", content: t('rootPage.metaDescription') },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@DucatiBruxelles" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: tokensCss,
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Derniere langue vue par LocaleHeadSync (le composant est re-monte a chaque changement de langue).
let lastHeadLocale: string | null = null;

/**
 * Les titres d'onglet (`head`) sont calcules par le routeur au chargement de la route,
 * hors React : quand l'utilisateur change de langue, on demande au routeur de les
 * recalculer (sinon l'onglet garde l'ancienne langue jusqu'a la prochaine navigation).
 */
function LocaleHeadSync() {
  const locale = useLocale();
  const router = useRouter();
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (lastHeadLocale !== null && lastHeadLocale !== locale) router.invalidate();
    lastHeadLocale = locale;
  }, [locale, router]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Langue de l'utilisateur : re-monte l'arbre sous lui quand elle change (sans rechargement). */}
        <LocaleProvider>
          <LocaleHeadSync />
          {/* useConfirm() jette hors provider : monte ici pour couvrir toutes les routes. */}
          <ConfirmProvider>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            {/* Hôte des toasts : sans lui, tous les toast() de l'app sont muets. */}
            <Toaster />
          </ConfirmProvider>
        </LocaleProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
