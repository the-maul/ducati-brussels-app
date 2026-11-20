/**
 * Écrans de secours de la racine (lot chunk-reload, 20/11/2026) :
 * - `RecoveryScreen` : message clair + « Recharger » + lien vers l'accueil (nouvelle version
 *   mise en ligne, fichier de page introuvable) ;
 * - `RoutePending` : roue de chargement d'une page, remplacée par le même message si le
 *   chargement n'aboutit pas (plus de roue sans fin).
 * Le lien d'accueil est un vrai lien (`<a href="/">`, chargement complet) et non un `<Link>` du
 * routeur : après une mise en ligne, une navigation interne redemanderait les anciens fichiers.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { t } from '@/lib/i18n';

/** Au-delà, la roue de chargement laisse place au message « Recharger / accueil ». */
export const PENDING_SLOW_MS = 20_000;

function reloadPage() {
  try {
    window.location.reload();
  } catch {
    // ignoré : le lien d'accueil reste disponible
  }
}

export function RecoveryScreen({ title, text, fullScreen = true }: { title: string; text: string; fullScreen?: boolean }) {
  return (
    <div
      role="alert"
      className={`flex items-center justify-center bg-background px-4 ${fullScreen ? 'min-h-screen' : 'min-h-[50vh]'}`}
    >
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reloadPage}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('rootPage.reload')}
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

/** Composant d'attente par défaut des pages (routeur `defaultPendingComponent`). */
export function RoutePending() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), PENDING_SLOW_MS);
    return () => clearTimeout(id);
  }, []);
  if (slow) {
    return <RecoveryScreen title={t('rootPage.pendingSlowTitle')} text={t('rootPage.pendingSlowText')} fullScreen={false} />;
  }
  return (
    <div className="grid min-h-[50vh] place-items-center" role="status" aria-label={t('rootPage.pendingLoading')}>
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
